import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ApprovalService from '@deepseek-ai/dsh-user-approval'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { PactFlowExecutionPlan } from '../src/types.ts'
import type {} from '../lib/index.js'

/** Scheduling/Git unit fixtures explicitly use an unrestricted synthetic parent.
 * Real confined behavior is owned by local-preflight.spec.ts and live Worker E2E. */
export function unconfinedWorkerContextFixture() {
  const policy = { resolve: () => ({ mode: 'danger-full-access' as const }) }
  return { get: (name: string) => name === 'sandboxPolicy' ? policy : undefined }
}

/** Isolated test human-answer boundary; real approval policy/audit and Host recording still run. */
export async function approveExecutionPlanFixture(ctx: Context, sessionId: string, prompt: string,
  execution: PactFlowExecutionPlan['nodes'][number]['execution'], nodeId?: string) {
  if (ctx.get('approval') === undefined) await ctx.plugin(ApprovalService)
  if (ctx.get('userQuestions') === undefined) ctx.provide('userQuestions', {
    ask: async (request: { questions: { id: string; options: { label: string }[] }[] }) => ({
      answers: [{ id: request.questions[0]!.id, selected: [request.questions[0]!.options[0]!.label] }],
    }),
  } as never)
  const session = ctx.sessions.get(sessionId as never)!
  // The worker provider/cluster itself is a declared test boundary in these
  // scheduling suites. Advertise the same explicit synthetic route to the planner.
  ctx.pactflow.executionOptions = async () => [execution]
  if (execution.kind === 'git') {
    const runtime = ctx.get('subagents') as { getProvider(name: string): object | undefined }
    const provider = runtime.getProvider(execution.provider)
    const lookup = runtime.getProvider.bind(runtime)
    runtime.getProvider = name => name === execution.provider ? provider : lookup(name)
  }
  const nodes = Object.values((await ctx.pactflow.snapshot(sessionId)).dag.byId)
  const needId = nodes.find(node => nodeId === undefined || node.id === nodeId)!.needId
  const selected = nodes.filter(node => node.needId === needId)
  const agent = { id: session.id, session } as Agent
  const scope = createScope(ctx, agent)
  Object.assign(agent, { ctx: scope.ctx })
  const lastTurn = session.events.findLast(event => event.type === 'turn/start' || event.type === 'turn/end')
  const opened = lastTurn?.type !== 'turn/start'
  const turn = session.events.filter(event => event.type === 'turn/start').length + 1
  if (opened) session.append('turn/start', { turn })
  try {
    const result = await ctx.pactflow.confirmExecutionPlan(agent, ToolCallId(`fixture-plan-${turn}`), {
      needId, recommendedId: 'fixture', plans: [{
        id: 'fixture', mode: selected.length === 1 ? 'single' : 'split', summary: '测试批准方案', rationale: '隔离测试的显式人工答复替身',
        nodes: selected.map(node => ({ id: node.id, title: node.title, prompt,
          acceptance: ['按本测试断言验证结果'], dependencies: node.dependencies, codeInputs: node.codeInputs ?? [], execution })),
      }],
    }, new AbortController().signal)
    if (!result.approved) throw new Error('Test fixture approval failed')
    return result
  } finally {
    if (opened) session.append('turn/end', { turn, reason: { kind: 'aborted' } })
    await scope.dispose()
  }
}
