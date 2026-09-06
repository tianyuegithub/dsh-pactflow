import { createHash } from 'node:crypto'
import type { PactFlowReview } from './types.ts'

export interface PactFlowReviewAuthorization {
  readonly approvalRequestId: string
  readonly needRevision: number
  readonly evidenceDigest: string
  readonly source: 'dsh-approval'
}

/** Validate before the note can enter either the approval audit or the review log. */
export function pactFlowReviewNote(value: string): string {
  const note = value.trim()
  if (note.length === 0) throw new Error('PactFlow review note must be non-empty')
  if (new TextEncoder().encode(note).length > 8_192 || /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(note)) {
    throw new Error('PactFlow review note contains a credential-like value or is too large')
  }
  return note
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
