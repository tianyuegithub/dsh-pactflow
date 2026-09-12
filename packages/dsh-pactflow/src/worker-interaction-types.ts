/** Versioned client-safe boundary; transport implementations must not add authority. */
export const WORKER_INTERACTION_PROTOCOL = 'dsh-worker-interactions/v1' as const
export interface WorkerQuestion {
  id: string; question: string; header?: string | undefined; detail?: string | undefined
  options?: { label: string; description?: string | undefined }[] | undefined; multiSelect?: boolean | undefined; allowCustom?: boolean | undefined
}
export interface WorkerQuestionAnswer { id: string; selected: string[]; custom?: string | undefined }
export interface WorkerInteractionRequest {
  protocol: typeof WORKER_INTERACTION_PROTOCOL; bootId: string; requestId: string
  kind: 'approval' | 'question'; createdAt: number; expiresAt: number
  title: string; detail: string; toolName?: string | undefined; callId?: string | undefined; questions?: WorkerQuestion[] | undefined
}
export type WorkerInteractionAnswer = { decision: 'approve' | 'reject' } | { answers: WorkerQuestionAnswer[] }
export interface WorkerInteractionRecord {
  id: string; sessionId: string; needId: string; runId: string; podUid: string
  revision: number; expiresAt: number; request: WorkerInteractionRequest; digest: string
  state: 'pending' | 'answered' | 'delivered' | 'cancelled' | 'expired'
  answer?: WorkerInteractionAnswer | undefined; updatedAt: number; reason: string
}
export interface AnswerWorkerInteractionRequest {
  id: string; expectedRevision: number; expectedDigest: string; answer: WorkerInteractionAnswer
}
export type WorkerBridgeMessage =
  | { type: 'hello'; protocol: typeof WORKER_INTERACTION_PROTOCOL; bootId: string }
  | { type: 'request'; request: WorkerInteractionRequest }
  | { type: 'settled'; bootId: string; requestId: string; digest: string }
  | { type: 'withdrawn'; bootId: string; requestId: string; reason: string }
export interface WorkerBridgeAnswer {
  signature: string; runId: string; podUid: string; expiresAt: number
  type: 'answer'; bootId: string; requestId: string; digest: string; answer: WorkerInteractionAnswer
}
