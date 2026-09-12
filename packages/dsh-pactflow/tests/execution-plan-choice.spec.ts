import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { createScope } from '@deepseek-ai/dsh-scope'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { executionPlanRequestSchema } from '../src/execution-plan.ts'

const route = { kind: 'k3s' as const, templateId: 'claude', agentProfileId: 'claude-main' }
const node = { id: 'delivery', title: '完整交付', prompt: '修复、测试、整理证据并提交任务分支',
  acceptance: ['测试通过并保留证据'], dependencies: [], codeInputs: [], execution: route }
const request = { needId: 'need', recommendedId: 'single', plans: [
  { id: 'single', mode: 'single', summary: '一个节点完成交付', rationale: '同一上下文避免交接', nodes: [node] },
  { id: 'split', mode: 'split', summary: '两个独立交付', rationale: '独立模块允许并行', nodes: [node, { ...node, id: 'second' }] },
] }
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore); await ctx.plugin(SessionProjectionRegistry); await ctx.plugin(PactFlowService)
  await ctx.plugin(ApprovalService)
  const session = ctx.sessions.create(SessionId('plan-choice'), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Plan' })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: 'scope' })
  vi.spyOn(ctx.pactflow, 'executionOptions').mockResolvedValue([route])
  const agent = { id: session.id, session } as Agent
  Object.assign(agent, { ctx: createScope(ctx, agent).ctx })
  const ask = vi.fn(async (input: { questions: { id: string; options: { label: string }[] }[] }) => ({
    answers: [{ id: input.questions[0]!.id, selected: [input.questions[0]!.options[0]!.label] }],
  }))
  ctx.provide('userQuestions', { ask } as never)
  session.append('turn/start', { turn: 1 })
  const confirm = (value: unknown = request, signal = new AbortController().signal) => ctx.pactflow.confirmExecutionPlan(agent, ToolCallId('plan-call'), value, signal)
  const check = (prompt = node.prompt, execution = route) => ctx.pactflow.assertExecutionPlan(session, node.id, prompt, execution)
  return { ctx, session, ask, confirm, check }
}
describe('execution plan choice', () => {
  it('blocks until the human answers, creates only the selected nodes and preserves native audit', async () => {
    const { ctx, session, ask, confirm, check } = await harness()
    try {
      let answer!: () => void
      ask.mockImplementationOnce(async input => {
        await new Promise<void>(resolve => { answer = resolve })
        return { answers: [{ id: input.questions[0]!.id, selected: [input.questions[0]!.options[0]!.label] }] }
      })
      const pending = confirm()
      await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())
      expect((await ctx.pactflow.snapshot(session.id)).dag.byId).toEqual({})
      expect(session.events.filter(e => e.type === 'approval/decided')).toHaveLength(0)
      answer()
      expect((await pending).approved).toBe(true)
      expect(Object.keys((await ctx.pactflow.snapshot(session.id)).dag.byId)).toEqual(['delivery'])
      await expect(check()).resolves.toEqual(route)
      expect(session.events.filter(e => e.type === 'approval/asked')).toHaveLength(1)
      expect(session.events.filter(e => e.type === 'approval/decided')).toHaveLength(1)
      const restored = ctx.sessionProjections.restore({}, session.events, 0, session.header).snapshot.values
      expect(Object.values(restored.pactflowDelivery!.reviews)[0]!.executionPlan?.plan.id).toBe('single')
      await expect(check('改变任务指令')).rejects.toThrow(/重新确认/)
      await expect(check(node.prompt, { ...route, templateId: 'different' })).rejects.toThrow(/未注册/)
      ctx.pactflow.createNode(session.id, { id: 'extra', needId: 'need', title: 'Extra', dependencies: [] })
      await expect(check()).rejects.toThrow(/重新确认/)
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['custom', 'cancel', 'wrong-id', 'multiple', 'policy'] as const)('does not authorize %s', async mode => {
    const { ctx, session, ask, confirm } = await harness()
    try {
      if (mode === 'policy') ctx.approval.config.policy = 'never'
      else ask.mockImplementationOnce(async input => {
        if (mode === 'cancel') throw new Error('cancelled')
        const q = input.questions[0]!
        return { answers: [{ id: mode === 'wrong-id' ? 'forged' : q.id,
          selected: mode === 'multiple' ? q.options.slice(0, 2).map(v => v.label) : [q.options[0]!.label],
          ...(mode === 'custom' ? { custom: '请先修改' } : {}),
        }] }
      })
      expect((await confirm()).approved).toBe(false)
      expect((await ctx.pactflow.snapshot(session.id)).dag.byId).toEqual({})
      expect(session.events.filter(e => e.type === 'pactflow/review-recorded')).toHaveLength(0)
      if (mode === 'policy') expect(ask).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects graph changes during the question', async () => {
    const { ctx, session, ask, confirm } = await harness()
    try {
      ask.mockImplementationOnce(async input => {
        ctx.pactflow.createNode(session.id, { id: 'foreign', needId: 'need', title: 'New', dependencies: [] })
        return { answers: [{ id: input.questions[0]!.id, selected: [input.questions[0]!.options[0]!.label] }] }
      })
      await expect(confirm()).rejects.toThrow(/changed while awaiting/)
      expect(session.events.filter(e => e.type === 'pactflow/review-recorded')).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('binds the actual pool/model and rejects unregistered routes before asking', async () => {
    const { ctx, ask, confirm, check } = await harness()
    try {
      const actual = { ...route, workerPoolId: 'project-pool', modelConnectionId: 'actual-model' }
      vi.mocked(ctx.pactflow.executionOptions).mockResolvedValue([actual])
      const result = await confirm()
      expect(result.review?.executionPlan?.plan.nodes[0]?.execution).toEqual(actual)
      expect(ask.mock.calls[0]![0]).toMatchObject({ questions: [{ detail: expect.stringContaining('project-pool') }] })
      await expect(check()).resolves.toEqual(actual)
      vi.mocked(ctx.pactflow.executionOptions).mockResolvedValue([])
      await expect(confirm()).rejects.toThrow(/未注册/)
      expect(ask).toHaveBeenCalledTimes(1)
    } finally { await ctx.fiber.dispose() }
  })

  it('invalidates a local provider replaced under the same registered name', async () => {
    const { ctx, session, confirm } = await harness()
    try {
      const execution = { kind: 'git' as const, provider: 'local-fixture' }
      let provider = { capabilities: { cwd: true } }
      ctx.provide('subagents', { getProvider: () => provider, list: () => [execution.provider] } as never)
      vi.mocked(ctx.pactflow.executionOptions).mockResolvedValue([execution])
      await confirm({ ...request, plans: [{ ...request.plans[0], nodes: [{ ...node, execution }] }] })
      await expect(ctx.pactflow.assertExecutionPlan(session, node.id, node.prompt, execution)).resolves.toEqual(execution)
      provider = { capabilities: { cwd: true } }
      await expect(ctx.pactflow.assertExecutionPlan(session, node.id, node.prompt, execution)).rejects.toThrow(/重新确认/)
    } finally { await ctx.fiber.dispose() }
  })

  it('does not turn a late answer after cancellation into nodes or approval', async () => {
    const { ctx, session, ask, confirm } = await harness()
    try {
      let answer!: () => void
      ask.mockImplementationOnce(async input => {
        await new Promise<void>(resolve => { answer = resolve })
        return { answers: [{ id: input.questions[0]!.id, selected: [input.questions[0]!.options[0]!.label] }] }
      })
      const controller = new AbortController()
      const pending = confirm(request, controller.signal)
      await vi.waitFor(() => expect(ask).toHaveBeenCalledOnce())
      controller.abort()
      expect((await pending).approved).toBe(false)
      answer(); await new Promise(resolve => setTimeout(resolve, 0))
      expect((await ctx.pactflow.snapshot(session.id)).dag.byId).toEqual({})
      expect(session.events.filter(event => event.type === 'pactflow/review-recorded')).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps approval through phase progress and an unchanged failed-run retry', async () => {
    const { ctx, session, ask, confirm, check } = await harness()
    try {
      await confirm()
      ctx.pactflow.transitionNeed(session.id, { needId: 'need', expectedRevision: 1, to: 'discussion' })
      const owned = ctx.pactflow.claimNode(session.id, { nodeId: node.id, expectedRevision: 1, provider: 'local', leaseDurationMs: 10000 })
      const failed = ctx.pactflow.settleRun(session.id, { runId: owned.run.id, claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision, state: 'failed', outcome: 'isolated failure' })
      ctx.pactflow.retryNode(session.id, { nodeId: node.id, expectedRevision: failed.node.revision })
      await expect(check()).resolves.toEqual(route)
      expect(ask).toHaveBeenCalledTimes(1)
    } finally { await ctx.fiber.dispose() }
  })

  it('supports split choice and blocks an unapproved direct cluster dispatch before preflight', async () => {
    const { ctx, session, ask, confirm } = await harness()
    try {
      ctx.pactflow.createNode(session.id, { id: node.id, needId: 'need', title: node.title, dependencies: [] })
      await expect(ctx.pactflow.dispatchK3sNode(session.id, { nodeId: node.id, expectedRevision: 1, templateId: 'claude', prompt: node.prompt, leaseDurationMs: 10000 })).rejects.toThrow(/confirm_execution_plan/)
      ask.mockImplementationOnce(async input => ({ answers: [{ id: input.questions[0]!.id, selected: [input.questions[0]!.options[1]!.label] }] }))
      expect((await confirm()).approved).toBe(true)
      expect(Object.keys((await ctx.pactflow.snapshot(session.id)).dag.byId)).toEqual(['delivery', 'second'])
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects cycles and a misleading single-node label before any question', () => {
    expect(() => executionPlanRequestSchema.parse({ ...request, plans: [{ ...request.plans[0], nodes: [node, node] }] })).toThrow()
    expect(() => executionPlanRequestSchema.parse({ ...request, plans: [{ ...request.plans[0], nodes: [{ ...node, dependencies: ['delivery'] }] }] })).toThrow()
  })
})
