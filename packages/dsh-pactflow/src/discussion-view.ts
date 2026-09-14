import type {
  PactFlowCollaborationProjection,
  PactFlowCommentCounters,
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
  const subjects = new Set<string>()
  for (const [needId, entries] of Object.entries(state?.recent ?? {})) {
    const visible = entries
      .filter(entry => !entry.voided)
      .map((entry): PactFlowDiscussionEntry => ({ ...entry, source: 'pactflow-comment' }))
    if (visible.length === 0) continue
    recent[needId] = visible
    for (const entry of visible) subjects.add(subjectKeyOf(entry))
  }
  // Counters are keyed per SUBJECT, and Runs are unbounded — a project that has
  // commented on 300 Runs would otherwise ship 300 counter keys into every model
  // snapshot forever, none of them ever reclaimed. Carry only the subjects whose
  // comments are actually visible here, so this view stays proportional to what
  // it shows rather than to everything ever commented on.
  const counters: Record<string, PactFlowCommentCounters> = {}
  for (const [key, value] of Object.entries(state?.counters ?? {})) {
    if (subjects.has(key)) counters[key] = value
  }
  return { counters, recent }
}

/** Mirror of the host-side subject key, kept here so the client shares one rule. */
function subjectKeyOf(entry: Pick<PactFlowDiscussionEntry, 'needId' | 'nodeId' | 'runId'>): string {
  if (entry.nodeId !== undefined) return `node:${entry.nodeId}`
  if (entry.runId !== undefined) return `run:${entry.runId}`
  return `need:${entry.needId}`
}
