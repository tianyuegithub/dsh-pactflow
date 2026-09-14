import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { pactflowDeliveryProjection } from '../src/domain.ts'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope, scopeTarget } from '@deepseek-ai/dsh-scope'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'
import { PactFlowAutopilotDriver } from '../src/host/autopilot-driver.ts'
import type { PactFlowAutopilotRecord, PactFlowSnapshot } from '../src/types.ts'

const limits = { maxDurationMs: 60_000, maxModelSteps: 20, maxWorkerStarts: 2, maxConcurrency: 1, maxStalledTurns: 2 }
async function harness() {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-autopilot-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const { workspace } = createGitFixture(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService, { infrastructure: { clusters: [], registries: [], templates: [], workerPools: [],
    gitProviders: [{ id: 'gitea', displayName: 'Test', kind: 'gitea', baseUrl: 'http://127.0.0.1:1', tokenCredentialRef: 'TEST_REF' }] } })
  // Unit suite owns scheduling explicitly; it does not start a background model.
  Reflect.get(ctx.pactflow, 'autopilotDriver').dispose()
  await ctx.plugin(JsonlSessionPersistence, { root: join(root, 'sessions'), compression: 'none' })
  ctx.provide('credentials', { describe: async () => ({ configured: true, source: 'memory', writable: true }) } as never)
  const session = ctx.sessions.create(SessionId('autopilot-test'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
  const project = ctx.pactflow.initialize(session.id, { name: 'Autopilot' })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Fix one feature', description: 'Implement, test, commit and merge only this feature.' })
  ctx.pactflow.createNeed(session.id, { id: 'other', title: 'Unrelated', description: '' })
  ctx.provide('workspaceRegistry', { list: () => [{ id: 'workspace', path: workspace, title: 'Repo', sessionIds: [session.id] }],
    get: () => ({ id: 'workspace', path: workspace, title: 'Repo', sessionIds: [session.id] }) } as never)
  await ctx.pactflow.saveValidationProfiles({ workspaceId: 'workspace', expectedRevision: 0,
    profiles: [{ id: 'check', displayName: 'Git status', command: 'git', args: ['status', '--short'], timeoutMs: 5000 }] })
  await ctx.pactflow.bindGit(session.id, { expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
    validationProfileIds: ['check'], giteaBaseUrl: 'http://127.0.0.1:1', giteaOwner: 'owner', giteaRepo: 'repo', giteaTokenCredentialRef: 'TEST_REF' })
  const provider = { capabilities: { cwd: true } }
  ctx.provide('subagents', { getProvider: () => provider, list: () => ['spawn'] } as never)
  const agent = { id: session.id, session, status: 'idle', followup: vi.fn(), cancel: vi.fn() } as unknown as Agent
  Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
  ctx.provide('agents', { get: () => agent, roots: () => [agent] } as never)
  const start = async () => {
    const preview = await ctx.pactflow.autopilotPreview(session.id, 'need')
    return await ctx.pactflow.startAutopilot(session.id, { needId: 'need', expectedNeedRevision: preview.needRevision,
      expectedScopeDigest: preview.scopeDigest, limits, confirm: 'start-scoped-autopilot' })
  }
  const plan = { needId: 'need', recommendedId: 'one', plans: [{ id: 'one', mode: 'single', summary: 'Complete feature', rationale: 'One bounded delivery',
    nodes: [{ id: 'delivery', title: 'Delivery', prompt: 'Implement and test the scoped feature and commit.', acceptance: ['Run registered checks'],
      dependencies: [], codeInputs: [], execution: { kind: 'git', provider: 'spawn' } }] }] }
  const finish = async () => {
    await ctx.fiber.dispose()
    if (previous === undefined) delete process.env.DSH_HOME; else process.env.DSH_HOME = previous
    await rm(root, { recursive: true, force: true })
  }
  return { ctx, root, session, agent, start, plan, finish }
}

describe('scoped autopilot authority', () => {
  it('previews real Git and profiles, chooses under policy without fabricating human audit, and stops authority', async () => {
    const h = await harness()
    try {
      const record = await h.start()
      const choice = await h.ctx.pactflow.confirmExecutionPlan(h.agent, ToolCallId('plan'), h.plan, new AbortController().signal)
      expect(choice.review?.source).toBe('autopilot-policy')
      expect(choice.review?.autopilotId).toBe(record.id)
      expect(h.session.events.some(event => event.type === 'approval/asked' || event.type === 'approval/decided')).toBe(false)
      await expect(h.ctx.pactflow.assertExecutionPlan(h.session, 'delivery', h.plan.plans[0]!.nodes[0]!.prompt, { kind: 'git', provider: 'spawn' })).resolves.toMatchObject({ kind: 'git' })
      const stopped = await h.ctx.pactflow.controlAutopilot(h.session.id, 'need', record.revision, 'stop')
      expect(stopped.state).toBe('stopped')
      await expect(h.ctx.pactflow.assertExecutionPlan(h.session, 'delivery', h.plan.plans[0]!.nodes[0]!.prompt, { kind: 'git', provider: 'spawn' })).rejects.toThrow()
      await expect(h.ctx.pactflow.controlAutopilot(h.session.id, 'need', stopped.revision, 'resume')).rejects.toThrow(/已结束/)
    } finally { await h.finish() }
  })

  it('does not grant another Need and never approves empty or failed verification', async () => {
    const h = await harness()
    try {
      await h.start()
      await expect(h.ctx.pactflow.tryAutopilotReview(h.session.id, { needId: 'other', expectedRevision: 1, kind: 'requirement', decision: 'approved', note: 'Not authorized' })).rejects.toThrow(/不属于/)
      const review = await h.ctx.pactflow.tryAutopilotReview(h.session.id, { needId: 'need', expectedRevision: 1, kind: 'requirement', decision: 'approved', note: 'Scope reviewed against the authorized requirement.' })
      expect(review?.source).toBe('autopilot-policy')
      await expect(h.ctx.pactflow.tryAutopilotReview(h.session.id, { needId: 'need', expectedRevision: 1, kind: 'verification', decision: 'approved', note: 'Claim success without results' })).rejects.toThrow(/实际成功/)
    } finally { await h.finish() }
  })

  it('enforces start budget and prevents a second concurrent claim', async () => {
    const h = await harness()
    try {
      await h.start()
      h.ctx.pactflow.createNode(h.session.id, { id: 'one', needId: 'need', title: 'One', dependencies: [] })
      h.ctx.pactflow.createNode(h.session.id, { id: 'two', needId: 'need', title: 'Two', dependencies: [] })
      h.ctx.pactflow.claimNode(h.session.id, { nodeId: 'one', expectedRevision: 1, provider: 'test', leaseDurationMs: 10_000 })
      expect(() => h.ctx.pactflow.claimNode(h.session.id, { nodeId: 'two', expectedRevision: 1, provider: 'test', leaseDurationMs: 10_000 })).toThrow(/并发/)
    } finally { await h.finish() }
  })

  it('rejects stale preview and reads authorization from real persisted session events', async () => {
    const h = await harness()
    try {
      await expect(h.ctx.pactflow.startAutopilot(h.session.id, { needId: 'need', expectedNeedRevision: 1, expectedScopeDigest: '0'.repeat(64), limits, confirm: 'start-scoped-autopilot' })).rejects.toThrow(/过期/)
      const record = await h.start()
      await h.ctx.sessions.flush(h.session)
      const stored = await h.ctx.sessionPersistence.load(h.session.id)
      const restored = h.ctx.sessionProjections.restore({}, stored.events, 0, stored.meta).snapshot.values
      expect(restored.pactflowDelivery?.autopilots?.need).toEqual(record)
    } finally { await h.finish() }
  })

  it('rejects stale controls and counts planner model calls before entry', async () => {
    const h = await harness()
    try {
      const record = await h.start()
      for (let i = 0; i < limits.maxModelSteps; i++) {
        const decision = await h.ctx.waterfall(scopeTarget(h.agent, h.agent), 'agent/pre-step', {
          agent: h.agent, messages: [], turn: 1, step: i + 1, signal: new AbortController().signal,
        }, async () => ({ kind: 'enter' as const, messages: [] }))
        expect(decision.kind).toBe('enter')
      }
      const denied = await h.ctx.waterfall(scopeTarget(h.agent, h.agent), 'agent/pre-step', {
        agent: h.agent, messages: [], turn: 1, step: 21, signal: new AbortController().signal,
      }, async () => ({ kind: 'enter' as const, messages: [] }))
      expect(denied.kind).toBe('reject')
      const current = (await h.ctx.pactflow.snapshot(h.session.id)).delivery.autopilots!.need!
      expect(current.modelSteps).toBe(20); expect(current.state).toBe('blocked')
      await expect(h.ctx.pactflow.controlAutopilot(h.session.id, 'need', record.revision, 'stop')).rejects.toThrow(/变化/)
      await expect(h.ctx.pactflow.controlAutopilot(h.session.id, 'need', current.revision, 'resume')).rejects.toThrow(/耗尽/)
    } finally { await h.finish() }
  })

  it('pauses when a real user message enters and leaves its model turn available', async () => {
    const h = await harness()
    try {
      await h.start()
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '暂停，我来处理' }] })
      const decision = await h.ctx.waterfall(scopeTarget(h.agent, h.agent), 'agent/pre-step', {
        agent: h.agent, messages: [message], turn: 1, step: 1, signal: new AbortController().signal,
      }, async () => ({ kind: 'enter' as const, messages: [] }))
      expect(decision.kind).toBe('enter')
      const record = (await h.ctx.pactflow.snapshot(h.session.id)).delivery.autopilots!.need!
      expect(record.state).toBe('paused'); expect(record.modelSteps).toBe(0)
      expect(record.reason).toMatch(/人工接管/)
    } finally { await h.finish() }
  })

  it('rejects changed execution scope before any closing request', async () => {
    const h = await harness()
    try {
      await h.start()
      const verify = vi.spyOn(Reflect.get(h.ctx.pactflow, 'gitea'), 'verify')
      await h.ctx.pactflow.saveValidationProfiles({ workspaceId: 'workspace', expectedRevision: 1,
        profiles: [{ id: 'check', displayName: 'Changed', command: 'git', args: ['status', '--porcelain'], timeoutMs: 5000 }] })
      await expect(h.ctx.pactflow.closeGitNeed(h.session.id, { needId: 'need', expectedRevision: 1 })).rejects.toThrow(/配置发生变化/)
      expect(verify).not.toHaveBeenCalled()
    } finally { await h.finish() }
  })

  it.each([false, true])('cancels only recovered jobs for this Need and preserves cancellation failure (%s)', async failure => {
    const h = await harness()
    try {
      const record = await h.start()
      const node = h.ctx.pactflow.createNode(h.session.id, { id: 'job', needId: 'need', title: 'Job', dependencies: [] })
      const ownController = new AbortController(); const otherController = new AbortController(); const secondController = new AbortController()
      const own = { id: 'own', nodeId: node.id, state: 'running', claimId: 'claim', k3s: { jobName: 'own-job', jobUid: 'own-uid' } }
      const secondNode = h.ctx.pactflow.createNode(h.session.id, { id: 'second-job', needId: 'need', title: 'Second job', dependencies: [] })
      const second = { ...own, id: 'second', nodeId: secondNode.id, k3s: { jobName: 'second-job', jobUid: 'second-uid' } }
      const other = { ...own, id: 'other-run', nodeId: 'other-node', k3s: { jobName: 'other-job', jobUid: 'other-uid' } }
      vi.spyOn(h.ctx.pactflow as never, 'runState').mockReturnValue({ own, second, other } as never)
      vi.spyOn(h.ctx.pactflow as never, 'dagState').mockReturnValue({ [node.id]: node, [secondNode.id]: secondNode, 'other-node': { needId: 'other' } } as never)
      const controllers = Reflect.get(h.ctx.pactflow, 'recoveryControllers') as Map<string, AbortController>
      controllers.set(`${h.session.id}:own`, ownController); controllers.set(`${h.session.id}:other-run`, otherController); controllers.set(`${h.session.id}:second`, secondController)
      const cancelRun = vi.fn(async (spec: { jobUid: string }) => { if (failure && spec.jobUid === 'own-uid') throw new Error('UID cancellation unconfirmed') })
      vi.spyOn(h.ctx.pactflow as never, 'workerForRun').mockReturnValue({ cancelRun } as never)
      const settle = vi.spyOn(h.ctx.pactflow as never, 'settleRunInSession').mockReturnValue(undefined as never)
      const stop = h.ctx.pactflow.controlAutopilot(h.session.id, 'need', record.revision, 'stop')
      if (failure) await expect(stop).rejects.toThrow(/unconfirmed/)
      else await expect(stop).resolves.toMatchObject({ state: 'stopped' })
      expect(ownController.signal.aborted).toBe(!failure); expect(otherController.signal.aborted).toBe(false)
      expect(cancelRun).toHaveBeenCalledTimes(2)
      expect(cancelRun).toHaveBeenNthCalledWith(1, own.k3s); expect(cancelRun).toHaveBeenNthCalledWith(2, second.k3s)
      expect(secondController.signal.aborted).toBe(true)
      expect(settle).toHaveBeenCalledWith(h.session, expect.objectContaining({ runId: 'second', state: 'cancelled' }))
      if (failure) {
        expect(settle).not.toHaveBeenCalledWith(h.session, expect.objectContaining({ runId: 'own' }))
        const current = h.ctx.sessionProjections.stateOf(h.session, 'pactflowDelivery')!.autopilots!.need!
        expect(current.reason).toMatch(/取消未完成/)
      } else expect(settle).toHaveBeenCalledWith(h.session, expect.objectContaining({ runId: 'own', state: 'cancelled' }))
    } finally { vi.restoreAllMocks(); await h.finish() }
  })

  it('preserves the stopped grant and refuses budget rewriting in persisted control events', async () => {
    const h = await harness()
    try {
      const record = await h.start()
      const state = h.ctx.sessionProjections.stateOf(h.session, 'pactflowDelivery')!
      const event = h.session.events.findLast(event => event.type === 'pactflow/autopilot-updated')!
      // Exercise the actual projection reducer: raw session.append is not the
      // registered external producer and cannot prove its replay contract.
      expect(() => pactflowDeliveryProjection.apply(state as never, { ...event, data: { v: 1, record: {
        ...record, revision: record.revision + 1, limits: { ...record.limits, maxWorkerStarts: 100 },
      } } } as never)).toThrow(/cannot be rewritten/)
      const paused = await h.ctx.pactflow.controlAutopilot(h.session.id, 'need', record.revision, 'pause')
      const resumed = await h.ctx.pactflow.controlAutopilot(h.session.id, 'need', paused.revision, 'resume')
      expect(resumed.id).toBe(record.id); expect(resumed.limits).toEqual(record.limits)
      const stopped = await h.ctx.pactflow.controlAutopilot(h.session.id, 'need', resumed.revision, 'stop')
      await expect(h.ctx.pactflow.controlAutopilot(h.session.id, 'need', stopped.revision, 'pause')).rejects.toThrow(/已结束/)
    } finally { await h.finish() }
  })
})

describe('autopilot host continuation', () => {
  it('blocks the latest persisted wake revision when disk flush fails without calling the model', async () => {
    const h = await harness()
    try {
      await h.start()
      const driver = new PactFlowAutopilotDriver({ sessions: () => [h.session], agent: () => h.agent,
        snapshot: () => Reflect.get(h.ctx.pactflow, 'snapshotOfLive').call(h.ctx.pactflow, h.session) as PactFlowSnapshot,
        check: async () => {}, flush: async () => { throw new Error('disk flush failed') },
        update: (session, record, changes) => Reflect.get(h.ctx.pactflow, 'updateAutopilot').call(h.ctx.pactflow, session, record, changes),
        block: (session, record, reason) => Reflect.get(h.ctx.pactflow, 'blockAutopilotInSession').call(h.ctx.pactflow, session, record, reason),
        boundedError: error => String(error),
        reviewGate: () => undefined,
        recheckReviewGate: async () => {},
      })
      await driver.tick(); await driver.tick()
      const record = (await h.ctx.pactflow.snapshot(h.session.id)).delivery.autopilots!.need!
      expect(record.state).toBe('blocked'); expect(record.reason).toMatch(/disk flush failed/)
      expect(record.wakeCount).toBe(1); expect(h.agent.followup).not.toHaveBeenCalled()
      driver.dispose()
    } finally { await h.finish() }
  })

  it('deduplicates wakeups, continues after a completed turn and blocks no-progress', async () => {
    const h = await harness()
    try {
      const initial = await h.start()
      const driver = new PactFlowAutopilotDriver({ sessions: () => [h.session], agent: () => h.agent,
        snapshot: () => Reflect.get(h.ctx.pactflow, 'snapshotOfLive').call(h.ctx.pactflow, h.session) as PactFlowSnapshot,
        check: async () => {},
        flush: async session => { await h.ctx.sessions.flush(session) },
        update: (session, record, changes) => Reflect.get(h.ctx.pactflow, 'updateAutopilot').call(h.ctx.pactflow, session, record, changes),
        block: (session, record, reason) => Reflect.get(h.ctx.pactflow, 'blockAutopilotInSession').call(h.ctx.pactflow, session, record, reason),
        boundedError: error => String(error),
        reviewGate: () => undefined,
        recheckReviewGate: async () => {},
      })
      await Promise.all([driver.tick(), driver.tick()]); await driver.tick()
      expect(h.agent.followup).toHaveBeenCalledTimes(1)
      const consume = () => {
        const message = vi.mocked(h.agent.followup).mock.calls.at(-1)![0]
        h.session.append('user/message', message, { surfaceOp: 'append' })
      }
      consume(); await driver.tick()
      expect(h.agent.followup).toHaveBeenCalledTimes(2)
      consume(); await driver.tick()
      const record = (await h.ctx.pactflow.snapshot(h.session.id)).delivery.autopilots!.need!
      expect(record.state).toBe('blocked'); expect(record.reason).toMatch(/没有可验证进展/)
      expect(record.id).toBe(initial.id)
      driver.dispose()
    } finally { await h.finish() }
  })
})
