import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import type { PactFlowCleanupRecord, PactFlowReviewGateRecord } from '../src/types.ts'

/**
 * The wait state has to survive a Host restart, or a protected-branch closing
 * would silently forget what it was waiting on and the Need would sit in
 * `closing` with nobody holding the responsibility.
 *
 * Recovery here is projection replay: the state rides the closing cleanup
 * record, so "restores after a restart" and "survives a fold" are the same
 * claim. These cases drive the real service and the real fold rather than a
 * stand-in, and the zod-declaration case exists because an undeclared field is
 * silently stripped — the exact defect close-with-binding-auth had to fix for
 * gitResultSchema, which made closing permanently unable to find its own
 * credentials.
 */

let ctx: Context
let session: ReturnType<Context['sessions']['create']>

const NEED = 'need-gate'

const gate = (overrides: Partial<PactFlowReviewGateRecord> = {}): PactFlowReviewGateRecord => ({
  needId: NEED,
  pullRequestNumber: 7,
  pullRequestUrl: 'https://gitea.example/org/repo/pulls/7',
  headCommit: 'a'.repeat(40),
  baseBranch: 'main',
  needRevision: 1,
  closingInputDigest: 'f'.repeat(64),
  requiredApprovals: 2,
  requiredChecks: ['ci/test'],
  openedAt: 1,
  recheckCount: 3,
  maxRechecks: 40,
  lastCheckedAt: 99,
  lastGap: { missingApprovals: 1, checks: [{ context: 'ci/test', state: 'running' }] },
  ...overrides,
})

const closingCleanup = (reviewGate?: PactFlowReviewGateRecord): PactFlowCleanupRecord => ({
  id: `cleanup-${NEED}-closing`,
  needId: NEED as never,
  target: 'closing:pactflow/integration',
  state: 'pending',
  attempt: 1,
  requiresRelease: true,
  ...(reviewGate === undefined ? {} : { reviewGate }),
} as PactFlowCleanupRecord)

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  session = ctx.sessions.create(SessionId(`review-gate-${String(Date.now())}-${String(Math.random()).slice(2)}`), {
    meta: { agentPreset: 'pactflow' },
  })
  ctx.pactflow.initialize(session.id, { name: 'Gate' })
  ctx.pactflow.createNeed(session.id, { id: NEED, title: 'Need', description: '' })
})

afterEach(async () => { await ctx.fiber.dispose() })

const readGate = () =>
  ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[`cleanup-${NEED}-closing`]?.reviewGate

describe('PactFlow review gate durability', () => {
  it('survives the fold with every field intact', () => {
    const record = gate()
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup(record) })
    expect(readGate()).toEqual(record)
  })

  it('keeps the gap detail the regression check depends on', () => {
    // Detecting "a check went from success to failure" needs the previously
    // observed gap to still be there after a restart.
    session.append('pactflow/cleanup-recorded', {
      v: 1,
      record: closingCleanup(gate({
        lastGap: { missingApprovals: 0, checks: [{ context: 'ci/test', state: 'success' }] },
      })),
    })
    expect(readGate()?.lastGap?.checks[0]).toEqual({ context: 'ci/test', state: 'success' })
  })

  it('restores identically when the log is replayed from scratch', () => {
    const record = gate()
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup(record) })
    const live = ctx.sessionProjections.stateOf(session, 'pactflowDelivery')

    const replayed = ctx.sessionProjections.restore({}, session.events, 0, session).snapshot.values.pactflowDelivery
    expect(replayed?.cleanups[`cleanup-${NEED}-closing`]?.reviewGate).toEqual(record)
    expect(replayed?.cleanups).toEqual(live?.cleanups)
  })

  it('carries a record with no gate without inventing one', () => {
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup() })
    expect(readGate()).toBeUndefined()
  })
})

describe('PactFlow review gate cancellation', () => {
  it('removes the wait state but never closes the PR', () => {
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup(gate()) })
    expect(readGate()).toBeDefined()

    const result = ctx.pactflow.cancelReviewGate(session.id, { needId: NEED })
    expect(result).toEqual({ cancelled: true, pullRequestNumber: 7 })
    expect(readGate()).toBeUndefined()

    // The PR is an object other people can see; the platform does not reach out
    // and close it, and its number stays discoverable in the log.
    const numbers = session.events
      .filter(event => event.type === 'pactflow/cleanup-recorded')
      .map(event => (event.data as { record: PactFlowCleanupRecord }).record.reviewGate?.pullRequestNumber)
    expect(numbers).toContain(7)
  })

  it('keeps the closing cleanup record itself', () => {
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup(gate()) })
    ctx.pactflow.cancelReviewGate(session.id, { needId: NEED })
    const cleanup = ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[`cleanup-${NEED}-closing`]
    expect(cleanup?.target).toBe('closing:pactflow/integration')
    expect(cleanup?.requiresRelease).toBe(true)
  })

  it('reports nothing to cancel when no gate is waiting', () => {
    expect(ctx.pactflow.cancelReviewGate(session.id, { needId: NEED })).toEqual({ cancelled: false })
  })
})

describe('PactFlow review gate is cleared once closing is done with it', () => {
  it('drops the wait state through the same path cancellation uses', () => {
    // Left behind, a later recheck would observe `merged: true` on a PR the Host
    // itself merged and verified, judge it "merged outside the platform, never
    // verified by the Host", and write that accusation against our own work into
    // the durable log — permanently, since nothing reverses it.
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup(gate()) })
    expect(readGate()).toBeDefined()

    Reflect.get(ctx.pactflow, 'clearReviewGate').call(ctx.pactflow, session, NEED)
    expect(readGate()).toBeUndefined()

    // The cleanup record itself survives; only the wait annotation goes.
    const cleanup = ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[`cleanup-${NEED}-closing`]
    expect(cleanup?.target).toBe('closing:pactflow/integration')
  })

  it('is a no-op when there is no wait state to clear', () => {
    session.append('pactflow/cleanup-recorded', { v: 1, record: closingCleanup() })
    const before = session.events.length
    Reflect.get(ctx.pactflow, 'clearReviewGate').call(ctx.pactflow, session, NEED)
    // No event appended: re-recording an unchanged cleanup would bump the log for
    // nothing on every closing.
    expect(session.events.length).toBe(before)
  })

  it('refuses to record a wait state with no closing cleanup to ride on', () => {
    // Returning quietly would leave the caller reporting "waiting for review"
    // while nothing was recorded, and every re-entry would rebuild the record
    // with recheckCount 0 — making the recheck ceiling meaningless.
    expect(() => Reflect.get(ctx.pactflow, 'persistReviewGate').call(ctx.pactflow, session, gate()))
      .toThrow(/cannot be recorded/)
  })
})
