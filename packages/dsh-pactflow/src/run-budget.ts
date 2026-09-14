/**
 * Run budgets: bounded, explicitly-reported limits on how far one piece of work
 * may go. A budget never silently degrades a result; when one is hit the reason is
 * recorded so a human (or the Host) can see why the run stopped.
 */

export interface PactFlowRunBudget {
  /** Maximum attempts a single node may consume (attempts beyond this are refused). */
  readonly maxAttempts: number
  /** Maximum bytes of captured output/log text kept for one observation. */
  readonly maxOutputBytes: number
  /**
   * Maximum comments an agent may leave on one subject (Need, node or Run).
   * Comments are log-only and cannot be deleted, so an unbounded agent is an
   * unbounded, unclearable pile. Humans are not subject to this budget: the cap
   * exists to bound what a model writes, not what a person decides to say.
   */
  readonly maxAgentCommentsPerSubject: number
}

export const PACTFLOW_DEFAULT_RUN_BUDGET: PactFlowRunBudget = {
  maxAttempts: 5,
  // Matches the long-standing outcome/log cap so wiring the budget in does not
  // silently enlarge stored text.
  maxOutputBytes: 4_096,
  maxAgentCommentsPerSubject: 20,
}

export type PactFlowBudgetVerdict =
  | { readonly exhausted: false }
  | { readonly exhausted: true; readonly reason: 'attempts' | 'output-bytes' | 'agent-comments'; readonly detail: string }

/** Whether the next attempt is still within budget. */
export function evaluateAttemptBudget(maxAttempts: number, nextAttempt: number): PactFlowBudgetVerdict {
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) throw new Error('PactFlow attempts budget must be a positive integer')
  if (!Number.isSafeInteger(nextAttempt) || nextAttempt < 1) throw new Error('PactFlow attempt number must be a positive integer')
  if (nextAttempt <= maxAttempts) return { exhausted: false }
  return {
    exhausted: true,
    reason: 'attempts',
    detail: `attempt ${String(nextAttempt)} exceeds the budget of ${String(maxAttempts)} attempts`,
  }
}

/**
 * Whether one more agent comment on this subject is still within budget. The
 * caller passes the count already recorded for that exact subject; `human`
 * authors never reach here.
 */
export function evaluateAgentCommentBudget(maxAgentComments: number, recorded: number): PactFlowBudgetVerdict {
  if (!Number.isSafeInteger(maxAgentComments) || maxAgentComments < 1) {
    throw new Error('PactFlow agent comment budget must be a positive integer')
  }
  if (!Number.isSafeInteger(recorded) || recorded < 0) {
    throw new Error('PactFlow recorded agent comment count must be a non-negative integer')
  }
  if (recorded < maxAgentComments) return { exhausted: false }
  return {
    exhausted: true,
    reason: 'agent-comments',
    detail: `subject already holds ${String(recorded)} agent comment(s), the budget is ${String(maxAgentComments)}`,
  }
}

export interface PactFlowBoundedOutput {
  readonly text: string
  readonly truncated: boolean
  readonly originalBytes: number
}

/**
 * Keep at most `maxOutputBytes` of UTF-8 text. Truncation is explicit: the kept
 * text carries a marker with the original size instead of being silently cut.
 */
export function boundOutputToBudget(value: string, maxOutputBytes: number): PactFlowBoundedOutput {
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1) throw new Error('PactFlow output budget must be a positive integer')
  const bytes = new TextEncoder().encode(value)
  if (bytes.length <= maxOutputBytes) return { text: value, truncated: false, originalBytes: bytes.length }
  const marker = `\n[truncated: kept budget bytes of ${String(bytes.length)} total]`
  const markerBytes = new TextEncoder().encode(marker).length
  const keep = Math.max(0, maxOutputBytes - markerBytes)
  const text = `${new TextDecoder().decode(bytes.slice(0, keep))}${marker}`
  return { text, truncated: true, originalBytes: bytes.length }
}
