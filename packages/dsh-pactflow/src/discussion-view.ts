import type {
  PactFlowCollaborationProjection,
  PactFlowDiscussionEntry,
  PactFlowDiscussionView,
} from './types.ts'

/**
 * Shape the discussion for display and for a model's context.
 *
 * Two things happen here and nowhere else: voided entries are dropped, and every
 * surviving entry is stamped with its provenance. A comment is data the model may
 * read, never an instruction it should follow — and an `agent` comment is
 * something the model itself wrote a turn ago, which without a marker reads back
 * as independent corroboration.
 *
 * This lives outside `domain.ts` so the client can share the one implementation:
 * domain.ts carries the zod schemas and the whole event fold, none of which
 * belongs in the browser bundle.
 */
export function pactFlowDiscussionView(
  state: PactFlowCollaborationProjection | undefined,
): PactFlowDiscussionView {
  const recent: Record<string, readonly PactFlowDiscussionEntry[]> = {}
  for (const [needId, entries] of Object.entries(state?.recent ?? {})) {
    const visible = entries
      .filter(entry => !entry.voided)
      .map((entry): PactFlowDiscussionEntry => ({ ...entry, source: 'pactflow-comment' }))
    if (visible.length > 0) recent[needId] = visible
  }
  return { counters: state?.counters ?? {}, recent }
}
