import { createHash } from 'node:crypto'
import type { PactFlowReview } from './types.ts'

export interface PactFlowReviewAuthorization {
  readonly approvalRequestId: string
  readonly needRevision: number
  readonly evidenceDigest: string
  readonly source: 'dsh-approval'
}

export function pactFlowReviewEvidenceDigest(
  sessionId: string,
  needId: string,
  needRevision: number,
  kind: PactFlowReview['kind'],
  decision: PactFlowReview['decision'],
  note: string,
): string {
  const canonical = JSON.stringify({ sessionId, needId, needRevision, kind, decision, note })
  return createHash('sha256').update(canonical).digest('hex')
}
