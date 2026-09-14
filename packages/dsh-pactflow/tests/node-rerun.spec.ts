import { approveExecutionPlanFixture, unconfinedWorkerContextFixture } from './execution-plan-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'
import { recordAuthorizedReview } from './review-fixture.ts'
import type { PactFlowNode } from '../src/types.ts'

/**
 * Re-running a node that already succeeded.
 *
 * `succeeded` used to be a dead end: only `failed` and `cancelled` could return
 * to `ready`. So once a dependency produced a new commit, every successor was
 * stuck — either still reading as succeeded while carrying an input that is now
 * wrong, or duplicated as a second node with the same meaning, which forks both
 * the history and the approval chain.
 *
 * This deliberately weakens "terminal revival is rejected", and the architecture
 * wording was amended to say so. Three things bound the weakening: the owner
 * authorizes explicitly (no automatic path, autopilot included), every
 * historical Run survives, and successors are marked, never cascaded.
 *
 * Real Git and real dispatch throughout — code inputs only exist on a Run that
 * actually ran, so a hand-built fixture would be testing a shape rather than the
 * behaviour.
 */

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

let root: string
let ctx: Context
let session: ReturnType<Context['sessions']['create']>
let priorDshHome: string | undefined

const NEED = 'need'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pactflow-rerun-'))
  priorDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, '.dsh')
  const { workspace } = createGitFixture(root)
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  session = ctx.sessions.create(SessionId('rerun'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
  const initialized = ctx.pactflow.initialize(session.id, { name: 'Rerun' })
  await ctx.pactflow.bindGit(session.id, { expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main' })
  ctx.pactflow.createNeed(session.id, { id: NEED, title: 'Need', description: '' })

  const parent = { id: session.id, session, ctx: unconfinedWorkerContextFixture() }
  ctx.provide('agents', { get: () => parent } as never)
  let sequence = 0
  ctx.provide('subagents', {
    getProvider: () => ({ capabilities: { cwd: true } }),
    start: (_p: string, request: { cwd?: string }) => {
      sequence += 1
      git(['-C', request.cwd!, 'config', 'user.name', 'Worker'])
      git(['-C', request.cwd!, 'config', 'user.email', 'worker@example.invalid'])
      git(['-C', request.cwd!, 'commit', '--allow-empty', '-m', `task ${String(sequence)}`])
      return Promise.resolve({
        id: SessionId(`child-${String(sequence)}`), localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
        dispose: () => Promise.resolve(),
      })
    },
  } as never)
})

afterEach(async () => {
  await ctx.fiber.dispose()
  if (priorDshHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = priorDshHome
  await rm(root, { recursive: true, force: true })
})

const node = (id: string) => ctx.pactflow.dag(session.id).byId[id] as PactFlowNode

const runsOf = (nodeId: string) =>
  Object.values((Reflect.get(ctx.pactflow, 'runState').call(ctx.pactflow, session) as Record<string, { nodeId: string; attempt: number; state: string; git?: { codeInputs?: readonly { dependency?: string; branch: string; commit: string }[] } }>))
    .filter(run => run.nodeId === nodeId)

const currentNeed = () => ctx.sessionProjections.stateOf(session, 'pactflowNeeds')!.byId[NEED]!

const REVIEW_BEFORE: Readonly<Partial<Record<string, 'requirement' | 'design' | 'plan' | 'verification'>>> = {
  confirmed: 'requirement', planning: 'design', executing: 'plan', closing: 'verification',
}

/** Walk the Need to a phase, recording the human review each gate requires. */
function advanceTo(target: 'closing'): void {
  for (const to of ['discussion', 'confirmed', 'design', 'planning', 'executing', 'code_review', 'verification', 'closing'] as const) {
    const gate = REVIEW_BEFORE[to]
    if (gate !== undefined) {
      recordAuthorizedReview(ctx.pactflow as never, session, currentNeed(), {
        kind: gate, decision: 'approved', note: `${gate} approved`,
      })
    }
    Reflect.get(ctx.pactflow, 'transitionNeedInSession').call(ctx.pactflow, session, {
      needId: NEED, expectedRevision: currentNeed().revision, to,
    })
    if (to === target) return
  }
}

const createNode = (id: string, extra: Record<string, unknown> = {}) =>
  ctx.pactflow.createNode(session.id, { id, needId: NEED, title: id.toUpperCase(), dependencies: [], ...extra })

async function dispatch(id: string): Promise<void> {
  await approveExecutionPlanFixture(ctx, session.id, id.toUpperCase(), { kind: 'git', provider: 'spawn' }, id)
  const result = await ctx.pactflow.dispatchGitNode(session.id, {
    nodeId: id, expectedRevision: node(id).revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: id.toUpperCase(),
  })
  expect(result.run.state).toBe('succeeded')
}

/** A -> B, where B consumed A's commit as a code input. */
async function chain(): Promise<void> {
  createNode('a')
  createNode('b', { dependencies: ['a'], codeInputs: ['a'] })
  await dispatch('a')
  await dispatch('b')
}

const rerun = (id: string) => ctx.pactflow.rerunNode(session.id, { nodeId: id, expectedRevision: node(id).revision })

describe('PactFlow rerun authorization at the fold', () => {
  it('rejects leaving succeeded without authorization carried in the event', async () => {
    createNode('a')
    await dispatch('a')
    const current = node('a')
    // The bare event — what any caller could append — must still be refused, and
    // refused in the fold so replay reaches the same verdict as the live write.
    session.append('pactflow/node-updated', {
      v: 1, node: { ...current, state: 'ready', revision: current.revision + 1, updatedAt: Date.now() },
    })
    expect(() => ctx.pactflow.dag(session.id)).toThrow(/without owner authorization/)
  })

  it('rejects authorization that does not match the state it claims to authorize', async () => {
    createNode('a')
    await dispatch('a')
    const current = node('a')
    session.append('pactflow/node-updated', {
      v: 1,
      node: { ...current, state: 'ready', revision: current.revision + 1, updatedAt: Date.now() },
      rerunAuthorization: {
        authorizedAt: Date.now(), fromRevision: current.revision + 99, priorState: 'succeeded', staleInputs: [],
      },
    })
    expect(() => ctx.pactflow.dag(session.id)).toThrow(/does not match the state it authorized/)
  })

  it('folds a rerun identically when the log is replayed', async () => {
    createNode('a')
    await dispatch('a')
    rerun('a')
    const live = ctx.pactflow.dag(session.id)
    const replayed = ctx.sessionProjections.restore({}, session.events, 0, session).snapshot.values.pactflowDag
    expect(replayed?.byId).toEqual(live.byId)
  })
})

describe('PactFlow rerun entry point', () => {
  it('returns the node to ready and keeps every historical Run', async () => {
    createNode('a')
    await dispatch('a')
    const before = runsOf('a')
    const previous = node('a')

    const result = rerun('a')
    expect(result.state).toBe('ready')
    expect(result.revision).toBe(previous.revision + 1)

    const after = runsOf('a')
    expect(after).toHaveLength(before.length)
    expect(after.every(run => run.state === 'succeeded')).toBe(true)
  })

  it('advances the attempt instead of reusing the old one', async () => {
    createNode('a')
    await dispatch('a')
    const before = runsOf('a').map(run => run.attempt)
    rerun('a')
    await dispatch('a')
    const after = runsOf('a')
    expect(after).toHaveLength(before.length + 1)
    expect(Math.max(...after.map(run => run.attempt))).toBe(Math.max(...before) + 1)
  })

  it('refuses a revision that is not current', async () => {
    createNode('a')
    await dispatch('a')
    expect(() => ctx.pactflow.rerunNode(session.id, { nodeId: 'a', expectedRevision: 1 })).toThrow()
  })

  it('points a node that never succeeded at retryNode instead of silently doing its job', () => {
    createNode('a')
    expect(() => ctx.pactflow.rerunNode(session.id, { nodeId: 'a', expectedRevision: node('a').revision }))
      .toThrow(/use retryNode/)
  })
})

describe('PactFlow rerun fail-closed conditions', () => {
  it('refuses while the node still owns an active Run', async () => {
    createNode('a')
    await dispatch('a')
    rerun('a')
    ctx.pactflow.claimNode(session.id, {
      nodeId: 'a', expectedRevision: node('a').revision, provider: 'spawn', leaseDurationMs: 60_000,
    })
    // The node is `claimed` now, so the succeeded precondition speaks first; the
    // active-Run refusal is what the preview reports for this same situation.
    expect(ctx.pactflow.rerunPreview(session.id, { nodeId: 'a' }).refusal).toMatch(/still owns an active Run/)
  })

  it('refuses once the Need reached closing', async () => {
    createNode('a')
    await dispatch('a')
    advanceTo('closing')
    expect(() => ctx.pactflow.rerunNode(session.id, { nodeId: 'a', expectedRevision: node('a').revision }))
      .toThrow(/is in closing/)
  })

  it('refuses an archived node', async () => {
    createNode('a')
    await dispatch('a')
    const current = node('a')
    session.append('pactflow/node-updated', {
      v: 1, node: { ...current, state: 'archived', revision: current.revision + 1, updatedAt: Date.now() },
      rerunAuthorization: {
        authorizedAt: Date.now(), fromRevision: current.revision, priorState: 'succeeded', staleInputs: [],
      },
    })
    expect(() => ctx.pactflow.rerunNode(session.id, { nodeId: 'a', expectedRevision: node('a').revision }))
      .toThrow(/not succeeded/)
  })

  it('names what it found rather than reporting a generic state error', async () => {
    createNode('a')
    await dispatch('a')
    advanceTo('closing')
    expect(ctx.pactflow.rerunPreview(session.id, { nodeId: 'a' }).refusal).toMatch(/is in closing/)
  })
})

describe('PactFlow rerun stale code inputs', () => {
  it('reports the four fields the owner needs to decide', async () => {
    await chain()
    const consumed = runsOf('b')[0]!.git!.codeInputs!.find(input => input.dependency === 'a')!

    rerun('a')
    await dispatch('a')

    const preview = ctx.pactflow.rerunPreview(session.id, { nodeId: 'b' })
    expect(preview.staleInputs).toHaveLength(1)
    const stale = preview.staleInputs[0]!
    expect(stale.dependency).toBe('a')
    expect(stale.branch).toBe(consumed.branch)
    expect(stale.recorded).toBe(consumed.commit)
    expect(stale.latest).not.toBe(consumed.commit)
  })

  it('reports nothing stale while the upstream has not moved', async () => {
    await chain()
    expect(ctx.pactflow.rerunPreview(session.id, { nodeId: 'b' }).staleInputs).toEqual([])
  })

  it('is the production path the detector never had before', async () => {
    // The detector shipped behind a Remote no client and no Agent tool calls,
    // and the situation it reports had no action available anyway.
    await chain()
    rerun('a')
    await dispatch('a')
    expect(ctx.pactflow.rerunPreview(session.id, { nodeId: 'b' }).staleInputs).toHaveLength(1)
    expect(ctx.pactflow.staleCodeInputs(session.id, 'b')).toHaveLength(1)
  })
})

describe('PactFlow rerun marks successors without cascading', () => {
  it('marks the successor and names the commit change', async () => {
    await chain()
    const consumed = runsOf('b')[0]!.git!.codeInputs!.find(input => input.dependency === 'a')!
    rerun('a')
    await dispatch('a')

    const marker = node('b').staleCodeInputs
    expect(marker).toHaveLength(1)
    expect(marker![0]).toMatchObject({ dependency: 'a', recorded: consumed.commit })
    expect(marker![0]!.latest).not.toBe(consumed.commit)
  })

  it('leaves the successor succeeded and starts no Run for it', async () => {
    await chain()
    const runsBefore = runsOf('b').length
    rerun('a')
    await dispatch('a')

    expect(node('b').state).toBe('succeeded')
    expect(runsOf('b')).toHaveLength(runsBefore)
  })

  it('lets a successor that was running while its input moved still record its result', async () => {
    // The dangerous shape: a Run pins the node revision it claimed
    // (`settleRunInSession` refuses a result whose nodeRevision no longer
    // matches). Marking a RUNNING successor immediately would bump its revision
    // and make its own result impossible to record — the node stranded
    // mid-flight by a marker that is only informational.
    createNode('a')
    createNode('b', { dependencies: ['a'], codeInputs: ['a'] })
    await dispatch('a')
    await dispatch('b')

    // Put b back in flight: authorize a rerun, then claim it. It now has a
    // prior Run carrying a's old commit as a code input, and a pinned revision.
    rerun('b')
    const claimed = ctx.pactflow.claimNode(session.id, {
      nodeId: 'b', expectedRevision: node('b').revision, provider: 'spawn', leaseDurationMs: 60_000,
    })
    const pinned = node('b').revision
    expect(node('b').state).toBe('claimed')

    // The upstream moves while b is claimed.
    rerun('a')
    await dispatch('a')

    // b's revision must be untouched, or its result can never land.
    expect(node('b').revision).toBe(pinned)

    // And the precondition its result depends on still holds: settleRunInSession
    // refuses when `currentNode.revision !== currentRun.nodeRevision`, so this
    // equality IS the difference between a recordable result and a node stranded
    // mid-flight.
    const pinnedRun = runsOf('b').find(run => run.id === claimed.run.id)!
    expect((pinnedRun as { nodeRevision: number }).nodeRevision).toBe(node('b').revision)
  })

  it('clears the marker when the successor is itself re-run', async () => {
    await chain()
    rerun('a')
    await dispatch('a')
    expect(node('b').staleCodeInputs).toBeDefined()
    expect(rerun('b').staleCodeInputs).toBeUndefined()
  })
})

describe('PactFlow rerun is not reachable from the model', () => {
  const agentSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'agent', 'index.ts'), 'utf8')

  it('exposes no rerun entry on the Agent tool surface', () => {
    expect(agentSource).not.toContain('rerunNode')
    expect(agentSource).not.toContain('rerunPreview')
  })

  it('cannot re-run an existing node through plan confirmation, by construction', async () => {
    // The structural argument, exercised rather than asserted from source text:
    // `validateExecutionPlan` REQUIRES a plan to carry every existing node of the
    // Need, and `materializePlanReview`'s `create` returns early for a node that
    // already exists. So plan confirmation creates nodes and never re-runs one —
    // which is why autopilot cannot authorize a rerun even though it may
    // auto-select a plan.
    //
    // An earlier guard checked "does this plan mention a succeeded node" and
    // refused. Because plans are REQUIRED to include existing nodes, it fired on
    // every plan once anything had succeeded, stalling all multi-round planning
    // to defend against something this path cannot do.
    createNode('a')
    await dispatch('a')
    const before = node('a')
    const runsBefore = runsOf('a').length

    // Approving a plan that names the already-succeeded node leaves it untouched.
    await approveExecutionPlanFixture(ctx, session.id, 'A', { kind: 'git', provider: 'spawn' }, 'a')

    const after = node('a')
    expect(after.state).toBe('succeeded')
    expect(after.revision).toBe(before.revision)
    expect(runsOf('a')).toHaveLength(runsBefore)
  })
})
