import { ApprovalRequestId } from '@deepseek-ai/dsh-user-approval'
import type { Session } from '@deepseek-ai/dsh-session'
import { pactFlowReviewEvidenceDigest } from '../src/review-authorization.ts'
import type { PactFlowNeed, PactFlowReview } from '../src/types.ts'

export function recordAuthorizedReview(
  service: { recordReview(sessionId: string, request: {
    readonly needId: string
    readonly needRevision: number
    readonly kind: PactFlowReview['kind']
    readonly decision: PactFlowReview['decision']
    readonly note: string
    readonly approvalRequestId: string
    readonly evidenceDigest: string
    readonly source: 'dsh-approval'
  }): PactFlowReview },
  session: Session,
  need: PactFlowNeed,
  input: Pick<PactFlowReview, 'kind' | 'decision' | 'note'>,
): PactFlowReview {
  const note = input.note.trim()
  const evidenceDigest = pactFlowReviewEvidenceDigest(
    String(session.id), String(need.id), need.revision, input.kind, input.decision, note,
  )
  const approvalRequestId = ApprovalRequestId(`approval-${String(session.events.length)}`)
  session.append('approval/asked', {
    id: approvalRequestId,
    toolName: 'pactflow_record_review',
    reason: `evidence ${evidenceDigest}`,
  })
  session.append('approval/decided', { id: approvalRequestId, outcome: 'allowed-once' })
  return service.recordReview(String(session.id), {
    needId: String(need.id), needRevision: need.revision, ...input, note,
    approvalRequestId: String(approvalRequestId), evidenceDigest, source: 'dsh-approval',
  })
}
