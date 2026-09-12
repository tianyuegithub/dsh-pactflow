import { z } from 'zod'
import { executionDigest } from './execution-plan.ts'
import { WORKER_INTERACTION_PROTOCOL, type WorkerInteractionRequest, type WorkerInteractionAnswer, type WorkerInteractionRecord } from './worker-interaction-types.ts'
const id = z.string().min(1).max(160)
const text = z.string().max(16000)
const question = z.object({ id, question: text.min(1), header: z.string().max(160).optional(), detail: text.optional(),
  options: z.array(z.object({ label: z.string().min(1).max(1000), description: text.optional() }).strict()).max(20).optional(), multiSelect: z.boolean().optional(), allowCustom: z.boolean().optional() }).strict()
export const workerInteractionRequestSchema = z.object({ protocol: z.literal(WORKER_INTERACTION_PROTOCOL), bootId: id, requestId: id,
  kind: z.enum(['approval', 'question']), createdAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
  title: z.string().min(1).max(500), detail: text, toolName: z.string().max(256).optional(), callId: id.optional(),
  questions: z.array(question).min(1).max(5).optional(),
}).strict().superRefine((value, ctx) => {
  if (value.expiresAt <= value.createdAt || value.expiresAt - value.createdAt > 900000) ctx.addIssue({ code: 'custom', message: 'Invalid interaction deadline' })
  if ((value.kind === 'question') !== (value.questions !== undefined)) ctx.addIssue({ code: 'custom', message: 'Question payload does not match kind' })
  if (value.questions && new Set(value.questions.map(q => q.id)).size !== value.questions.length) ctx.addIssue({ code: 'custom', message: 'Duplicate question id' })
  for (const q of value.questions ?? []) if (new Set(q.options?.map(o => o.label)).size !== (q.options?.length ?? 0)) ctx.addIssue({ code: 'custom', message: 'Duplicate option label' })
})
export const workerInteractionAnswerSchema = z.union([
  z.object({ decision: z.enum(['approve', 'reject']) }).strict(),
  z.object({ answers: z.array(z.object({ id, selected: z.array(z.string().max(1000)).max(20), custom: text.optional() }).strict()).min(1).max(5) }).strict(),
])
export const workerInteractionRecordSchema = z.object({ id: z.string().min(1).max(600), sessionId: id, needId: id, runId: id, podUid: id,
  revision: z.number().int().positive(), expiresAt: z.number().int().nonnegative(), request: workerInteractionRequestSchema, digest: z.string().regex(/^[a-f0-9]{64}$/),
  state: z.enum(['pending', 'answered', 'delivered', 'cancelled', 'expired']), answer: workerInteractionAnswerSchema.optional(),
  updatedAt: z.number().int().nonnegative(), reason: z.string().max(4096),
}).strict()
export function validateWorkerAnswer(request: WorkerInteractionRequest, input: unknown): WorkerInteractionAnswer {
  const answer = workerInteractionAnswerSchema.parse(input)
  if (request.kind === 'approval') {
    if (!('decision' in answer)) throw new Error('审批必须明确批准一次或拒绝')
  } else {
    if (!('answers' in answer) || answer.answers.length !== request.questions!.length) throw new Error('请回答全部问题')
    const seen = new Set<string>()
    for (const item of answer.answers) {
      const q = request.questions!.find(q => q.id === item.id)
      if (!q || seen.has(item.id)) throw new Error('问题身份不匹配')
      seen.add(item.id)
      if (new Set(item.selected).size !== item.selected.length || (!q.multiSelect && item.selected.length > 1)
        || item.selected.some(value => !q.options?.some(option => option.label === value))) throw new Error('答案选项无效')
      if (q.allowCustom === false && item.custom !== undefined) throw new Error('该问题不接受自定义答案')
      if (item.selected.length === 0 && !item.custom?.trim()) throw new Error('答案不能为空')
    }
  }
  return answer
}
export function applyWorkerInteraction(prior: WorkerInteractionRecord | undefined, next: WorkerInteractionRecord): WorkerInteractionRecord {
  workerInteractionRecordSchema.parse(next)
  if (next.digest !== executionDigest(next.request)) throw new Error('Worker interaction digest mismatch')
  if (!prior) {
    if (next.revision !== 1 || next.state !== 'pending' || next.answer !== undefined) throw new Error('Interaction must start pending')
    return next
  }
  if (next.revision !== prior.revision + 1 || next.id !== prior.id || next.sessionId !== prior.sessionId || next.needId !== prior.needId
    || next.expiresAt !== prior.expiresAt || next.runId !== prior.runId || next.podUid !== prior.podUid || next.digest !== prior.digest) throw new Error('Interaction identity is immutable')
  const allowed = prior.state === 'pending' ? ['answered', 'cancelled', 'expired'] : prior.state === 'answered' ? ['delivered', 'cancelled', 'expired'] : []
  if (!allowed.includes(next.state)) throw new Error('Interaction transition is invalid')
  if (prior.answer === undefined && next.state !== 'answered' && next.answer !== undefined) throw new Error('Only a user decision may add an answer')
  if (next.state === 'answered') validateWorkerAnswer(next.request, next.answer)
  if (prior.answer && JSON.stringify(next.answer) !== JSON.stringify(prior.answer)) throw new Error('Interaction answer is immutable')
  return next
}
