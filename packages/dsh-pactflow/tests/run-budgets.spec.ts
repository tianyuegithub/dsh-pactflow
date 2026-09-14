import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import {
  PACTFLOW_DEFAULT_RUN_BUDGET,
  boundOutputToBudget,
  evaluateAttemptBudget,
} from '../src/run-budget.ts'

describe('PactFlow run budgets', () => {
  it('admits an attempt within the budget', () => {
    expect(evaluateAttemptBudget(3, 1)).toEqual({ exhausted: false })
    expect(evaluateAttemptBudget(3, 3)).toEqual({ exhausted: false })
  })

  it('rejects an attempt beyond the budget with an explicit reason', () => {
    const verdict = evaluateAttemptBudget(3, 4)
    expect(verdict.exhausted).toBe(true)
    if (verdict.exhausted) {
      expect(verdict.reason).toBe('attempts')
      expect(verdict.detail).toContain('4')
      expect(verdict.detail).toContain('3')
    }
  })

  it('bounds output and records that the budget was hit', () => {
    const small = boundOutputToBudget('short', 64)
    expect(small).toMatchObject({ truncated: false })
    expect(small.text).toBe('short')

    const big = boundOutputToBudget('x'.repeat(200), 64)
    expect(big.truncated).toBe(true)
    expect(big.originalBytes).toBe(200)
    // The bounded text stays within budget and states why it was cut.
    expect(new TextEncoder().encode(big.text).length).toBeLessThanOrEqual(64)
    expect(big.text).toContain('truncated')
  })

  it('stays within budget when the cut lands inside a multi-byte character', () => {
    // Slicing bytes and decoding replaces a split character with U+FFFD, which is
    // three bytes where the fragment was one or two — so the result came back
    // OVER budget. Downstream, `assertWithinChannelLimit('event-payload', …)` then
    // throws inside settleRunInSession, replacing the original failure and leaving
    // the Run unable to reach a terminal state at all. Nearly every error message
    // in this repository is Chinese, so this was the common case, not the edge.
    for (let characters = 1_500; characters < 1_700; characters += 1) {
      const bounded = boundOutputToBudget('中'.repeat(characters), 4_096)
      expect(new TextEncoder().encode(bounded.text).length, `${String(characters)} characters`)
        .toBeLessThanOrEqual(4_096)
    }
  })

  it('never emits a replacement character in place of a character it cut', () => {
    const bounded = boundOutputToBudget(`${'中'.repeat(40)}尾`, 64)
    expect(bounded.truncated).toBe(true)
    expect(bounded.text).not.toContain('\uFFFD')
    expect(new TextEncoder().encode(bounded.text).length).toBeLessThanOrEqual(64)
  })

  it('keeps the marker even when the budget leaves room for nothing else', () => {
    const bounded = boundOutputToBudget('中'.repeat(100), 8)
    expect(bounded.truncated).toBe(true)
    expect(bounded.text).toContain('truncated')
  })

  it('exposes a bounded default budget', () => {
    expect(PACTFLOW_DEFAULT_RUN_BUDGET.maxAttempts).toBeGreaterThan(0)
    expect(PACTFLOW_DEFAULT_RUN_BUDGET.maxAttempts).toBeLessThanOrEqual(50)
    expect(PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes).toBeGreaterThan(0)
  })
})

describe('PactFlow output budget enforcement', () => {
  it('applies the run output budget to a bound outcome (budget is authoritative)', () => {
    // Prototype-only instance: `boundedOutcome` must fall back to the default
    // budget, then honour an instance budget when one is present.
    const service = Object.create(PactFlowService.prototype) as PactFlowService
    const bounded = (value: unknown): string => Reflect.get(service, 'boundedOutcome').call(service, value)
    const long = bounded('x'.repeat(10_000))
    expect(new TextEncoder().encode(long).length).toBeLessThanOrEqual(PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes)
    expect(long).toContain('truncated')

    Reflect.set(service, 'runBudget', { maxAttempts: 5, maxOutputBytes: 128 })
    const tight = bounded('y'.repeat(10_000))
    expect(new TextEncoder().encode(tight).length).toBeLessThanOrEqual(128)
    expect(tight).toContain('truncated')
  })
})

describe('PactFlow retry budget enforcement', () => {
  it('refuses to retry a node beyond its attempt budget', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    // A tight budget: one attempt allowed, so the first retry is refused.
    Reflect.set(ctx.pactflow, 'runBudget', { maxAttempts: 1, maxOutputBytes: 1_024 })
    const session = ctx.sessions.create(SessionId('budget-project'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Budget' })
    ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
    const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
    const claimed = ctx.pactflow.claimNode(session.id, {
      nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000,
    })
    const failed = ctx.pactflow.settleRun(session.id, {
      runId: claimed.run.id, claimId: claimed.run.claimId,
      expectedNodeRevision: claimed.node.revision, state: 'failed', outcome: 'worker failed',
    })
    // A11: exhaustion now PAUSES the node durably instead of refusing with an
    // identical error on every future attempt; resuming is a human decision.
    const paused = ctx.pactflow.retryNode(session.id, { nodeId: node.id, expectedRevision: failed.node.revision })
    expect(paused.state).toBe('paused')
    expect(() => ctx.pactflow.retryNode(session.id, { nodeId: node.id, expectedRevision: paused.revision }))
      .toThrow(/paused.*waiting for human resume/)
    expect(() => ctx.pactflow.claimNode(session.id, {
      nodeId: node.id, expectedRevision: paused.revision, provider: 'spawn', leaseDurationMs: 60_000,
    })).toThrow(/paused.*waiting for human resume/)
  })
})
