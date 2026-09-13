import { redactWorkerText, redactWorkerArguments } from './redact.ts'
import { assertWithinChannelLimit } from '../artifact-store.ts'
import { readFile } from 'node:fs/promises'
import z from '@deepseek-ai/schemastery'
import type { AskUserQuestionRequest } from '@deepseek-ai/dsh-user-questions'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-user-questions'
import { DshWorkerInteractionBridge } from './bridge.ts'
import type { WorkerQuestion } from '../worker-interaction-types.ts'
declare module '@deepseek-ai/cordis' { interface Context { pactflowWorkerStartup: { task: string } } }
export const inject = ['userQuestions', 'approval']
export const Config = z.object({ questionApi: z.union(['provider-v1', 'waterfall-v1'] as const).required() })
/** Image-owned extension; no model tool can manufacture the Host's response. */
export async function apply(ctx: Context, config: { questionApi: 'provider-v1' | 'waterfall-v1' }): Promise<void> {
  const bridge = new DshWorkerInteractionBridge(undefined, undefined, {
    publicKey: await readFile('/opt/dsh-pactflow/interaction-public-key.pem', 'utf8'),
    runId: process.env.PACTFLOW_RUN_ID ?? '', podUid: process.env.PACTFLOW_POD_UID ?? '',
  })
  await bridge.listen()
  ctx.effect(() => () => bridge.close())
  const secrets = Object.entries(process.env).filter(([name, value]) => /TOKEN|SECRET|PASSWORD|API_KEY/.test(name) && value && value.length >= 8).map(([, value]) => value!)
  const clean = (text: string) => redactWorkerText(text, secrets)
  ctx.on('approval/request', async request => {
    const call = request.agent.session.events.findLast(event => event.type === 'tool/call' && event.data.callId === request.callId)
    const args = call?.type === 'tool/call' ? call.data.arguments : ''
    const detail = `${clean(request.reason ?? '执行器请求操作审批')}\n${redactWorkerArguments(args, secrets)}`
    // Interaction channel gate: reject oversized payloads locally BEFORE they
    // enter the bridge, with an explicit code instead of a silent degrade.
    assertWithinChannelLimit('interaction-request', Buffer.byteLength(detail, 'utf8'), 16000)
    const answer = await bridge.ask({ kind: 'approval', title: `操作审批：${request.toolName}`, toolName: request.toolName,
      ...(request.callId ? { callId: String(request.callId) } : {}), detail: clean(detail) }, request.signal)
    return 'decision' in answer && answer.decision === 'approve' ? 'allowed-once' : 'rejected'
  }, { prepend: true })
  const askQuestion = async (request: AskUserQuestionRequest) => {
    const questions = request.questions.map(q => JSON.parse(clean(JSON.stringify({ id: q.id, question: q.question, allowCustom: true,
      ...(q.header === undefined ? {} : { header: q.header }), ...(q.detail === undefined ? {} : { detail: q.detail }),
      ...(q.options === undefined ? {} : { options: q.options }), ...(q.multiSelect === undefined ? {} : { multiSelect: q.multiSelect }) }))) as WorkerQuestion)
    const answer = await bridge.ask({ kind: 'question', title: '执行器需要你的选择', detail: '', questions }, request.signal)
    if (!('answers' in answer)) throw new Error('远程问题答复无效')
    return { answers: answer.answers.map(item => ({ id: item.id, selected: item.selected, ...(item.custom === undefined ? {} : { custom: item.custom }) })) }
  }
  if (config.questionApi === 'provider-v1') {
    const questions = ctx.userQuestions as unknown as { registerProvider?: (provider: { ask: typeof askQuestion }) => () => void }
    if (typeof questions.registerProvider !== 'function') throw new Error('Configured DSH question provider API is unavailable')
    ctx.effect(() => questions.registerProvider!({ ask: askQuestion }))
  } else if (config.questionApi === 'waterfall-v1') ctx.on('user-questions/request', askQuestion, { prepend: true })
  else throw new Error('Unknown DSH question adapter version')
  if (process.env.PROMPT_PATH) ctx.provide('pactflowWorkerStartup', { task: await readFile(process.env.PROMPT_PATH, 'utf8') })
}
