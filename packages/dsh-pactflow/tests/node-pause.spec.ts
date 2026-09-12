import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { pactFlowDagStateCopy } from '../src/client/dag-graph-model.ts'

// A11: exhausting the retry budget PAUSES the node durably (visible, named
// refusal on dispatch/retry) instead of throwing the same error forever.
// Resuming is an explicit human decision that lands in the auditable history.
async function harness(maxAttempts: number) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  // The plugin reads its run budget from settings; the default budget is larger
  // than what a unit test wants to walk, so drive the private budget for the test.
  const configured = Reflect.get(ctx.pactflow, 'runBudget') as { maxAttempts: number }
  configured.maxAttempts = maxAttempts
  return { ctx, configured }
}

function projectWithNode(ctx: Awaited<ReturnType<typeof harness>>['ctx'], sessionId: string) {
  const session = ctx.sessions.create(SessionId(sessionId), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Pause' })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
  return { session, node }
}

function failOnce(ctx: Awaited<ReturnType<typeof harness>>['ctx'], session: { id: string }, nodeId: string, revision: number) {
  const claimed = ctx.pactflow.claimNode(session.id, { nodeId, expectedRevision: revision, provider: 'local', leaseDurationMs: 60_000 })
  return ctx.pactflow.settleRun(session.id, {
    runId: claimed.run.id, claimId: claimed.run.claimId, expectedNodeRevision: claimed.node.revision,
    state: 'failed', outcome: 'worker failed',
  })
}

describe('PactFlow budget pause state', () => {
  it('pauses the node durably when the retry budget is exhausted', async () => {
    const { ctx } = await harness(2)
    try {
      const { session, node } = projectWithNode(ctx, 'pause-walk')
      failOnce(ctx, session, 'node', node.revision)
      const firstRetry = ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: node.revision + 2 })
      expect(firstRetry.state).toBe('ready')
      failOnce(ctx, session, 'node', firstRetry.revision)
      // Budget (2 attempts) is now exhausted: retrying pauses instead of throwing.
      const paused = ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: firstRetry.revision + 2 })
      expect(paused.state).toBe('paused')
      const snapshot = await ctx.pactflow.snapshot(session.id)
      expect(snapshot.dag.byId['node']?.state).toBe('paused')
      // The durable log carries the paused state as an auditable node transition.
      const lastNodeUpdate = session.events.filter(event => event.type === 'pactflow/node-updated').at(-1)
      expect(JSON.stringify(lastNodeUpdate)).toContain('"state":"paused"')
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses dispatch and retry on a paused node, naming the human-resume wait', async () => {
    const { ctx } = await harness(1)
    try {
      const { session, node } = projectWithNode(ctx, 'pause-refuse')
      failOnce(ctx, session, 'node', node.revision)
      const paused = ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: node.revision + 2 })
      expect(paused.state).toBe('paused')
      expect(() => ctx.pactflow.claimNode(session.id, { nodeId: 'node', expectedRevision: paused.revision,
        provider: 'local', leaseDurationMs: 60_000 })).toThrow(/paused.*waiting for human resume/)
      expect(() => ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: paused.revision }))
        .toThrow(/paused.*waiting for human resume/)
    } finally { await ctx.fiber.dispose() }
  })

  it('resumes a paused node only through the explicit remote, back to ready or pending', async () => {
    const { ctx } = await harness(2)
    try {
      const { session, node } = projectWithNode(ctx, 'pause-resume')
      failOnce(ctx, session, 'node', node.revision)
      const retried = ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: node.revision + 2 })
      expect(retried.state).toBe('ready')
      // Resuming a node that is not paused is refused.
      expect(() => ctx.pactflow.resumeNode(session.id, { nodeId: 'node', expectedRevision: retried.revision }))
        .toThrow(/is not paused/)
      // Walk it to paused, then resume explicitly.
      failOnce(ctx, session, 'node', retried.revision)
      const paused = ctx.pactflow.retryNode(session.id, { nodeId: 'node', expectedRevision: retried.revision + 2 })
      expect(paused.state).toBe('paused')
      const resumed = ctx.pactflow.resumeNode(session.id, { nodeId: 'node', expectedRevision: paused.revision })
      expect(resumed.state).toBe('ready')
      const snapshot = await ctx.pactflow.snapshot(session.id)
      expect(snapshot.dag.byId['node']?.state).toBe('ready')
    } finally { await ctx.fiber.dispose() }
  })

  it('renders the paused state in the DAG copy table (no missing entry)', () => {
    expect(pactFlowDagStateCopy('paused')).toEqual({ label: '已暂停（等待人工恢复）', tone: 'warning' })
  })
})
