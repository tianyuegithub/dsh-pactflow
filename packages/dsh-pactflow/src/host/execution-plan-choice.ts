import type { Agent } from '@deepseek-ai/dsh-agent'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { ApprovalService, ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import type { UserQuestionService } from '@deepseek-ai/dsh-user-questions'
import type { PactFlowExecutionPlan, PactFlowReview } from '../types.ts'
import { executionDigest, executionPlanMarkdown, executionPlanRequestSchema } from '../execution-plan.ts'

export interface ExecutionPlanChoiceHost {
  readonly approval: ApprovalService | undefined
  readonly questions: UserQuestionService | undefined
  scopeDigest(): Promise<string>
  graphDigest(): string
  validate(plan: PactFlowExecutionPlan): void
  commit(plan: PactFlowExecutionPlan, scopeDigest: string, proposalDigest: string, approvalId: string): PactFlowReview
}

/** Native approval owns policy/audit; only this request uses the choice presentation. */
export async function confirmExecutionPlanChoice(
  host: ExecutionPlanChoiceHost, agent: Agent, callId: ToolCallId, input: unknown, signal: AbortSignal,
): Promise<{ readonly approved: boolean; readonly review?: PactFlowReview; readonly feedback?: string }> {
  const request = executionPlanRequestSchema.parse(input)
  const plans = request.plans as readonly PactFlowExecutionPlan[]
  plans.forEach(plan => host.validate(plan))
  const scopeDigest = await host.scopeDigest()
  const graphDigest = host.graphDigest()
  const proposalDigest = executionDigest({ sessionId: agent.session.id, scopeDigest, graphDigest, request })
  if (host.approval === undefined || host.questions === undefined) throw new Error('PactFlow execution plan requires native approval and userQuestions services')
  const ordered = [...plans].sort((a, b) => Number(b.id === request.recommendedId) - Number(a.id === request.recommendedId))
  const options = ordered.map(plan => ({
    label: `批准${plan.mode === 'single' ? '单节点方案' : `拆分方案（${plan.nodes.length} 个节点）`}：${plan.summary} [${plan.id}]${plan.id === request.recommendedId ? ' (Recommended)' : ''}`,
    description: plan.rationale,
  }))
  if (new Set(options.map(option => option.label)).size !== options.length) throw new Error('Execution plan choice labels must be unique')
  const detail = ordered.map(executionPlanMarkdown).join('\n\n---\n\n')
  const approvalRequest = { agent, callId, toolName: 'pactflow_confirm_execution_plan', signal,
    reason: `确认执行方案；提交选择即批准具体方案。\n方案摘要：${proposalDigest}\n${detail}` }
  let selected: PactFlowExecutionPlan | undefined
  let feedback: string | undefined
  const dispose = agent.ctx.on('approval/request', async (received, next): Promise<ApprovalOutcome> => {
    if (received !== approvalRequest) return next()
    const answer = await host.questions!.ask({ agent, signal, questions: [{
      id: proposalDigest, header: '执行方案确认',
      question: '请选择本次执行方案；提交选择即批准，取消或补充意见不会启动执行。',
      detail, options: [...options, { label: '继续调整方案', description: '返回讨论，不启动执行代理。' }],
      multiSelect: false,
    }] })
    if (signal.aborted) return 'cancelled'
    if (answer.answers.length !== 1) return 'rejected'
    const item = answer.answers[0]!
    if (item.id !== proposalDigest || item.custom !== undefined || item.selected.length !== 1) {
      feedback = item.custom
      return 'rejected'
    }
    const index = options.findIndex(option => option.label === item.selected[0])
    if (index < 0) return 'rejected'
    selected = ordered[index]
    return 'allowed-once'
  }, { prepend: true })
  let outcome: ApprovalOutcome
  try { outcome = await host.approval.request(approvalRequest) } finally { dispose() }
  if (outcome !== 'allowed-once' || selected === undefined || signal.aborted) {
    return { approved: false, ...(feedback === undefined ? {} : { feedback }) }
  }
  if (scopeDigest !== await host.scopeDigest() || graphDigest !== host.graphDigest()) throw new Error('PactFlow execution plan changed while awaiting confirmation; confirm the current plan again')
  signal.throwIfAborted()
  const asked = agent.session.events.findLast(event => event.type === 'approval/asked'
    && event.data.callId === callId && event.data.toolName === approvalRequest.toolName
    && event.data.reason === approvalRequest.reason)
  if (asked === undefined || asked.type !== 'approval/asked') throw new Error('PactFlow execution plan approval audit is missing')
  return { approved: true, review: host.commit(selected, scopeDigest, proposalDigest, String(asked.data.id)) }
}
