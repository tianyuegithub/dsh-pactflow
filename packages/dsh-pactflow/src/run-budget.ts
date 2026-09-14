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

/**
 * Token and model-call usage for one run — measured, or explicitly absent.
 *
 * Only the `dsh` executor's adapter is written in this repository, so only it can
 * be made to report usage; a third-party Harness's termination document has no
 * such field. Recording that absence as `0` would be a lie in both directions: it
 * reads as "this run cost nothing", and it lets a budget comparison return a
 * verdict about a quantity nobody measured. So absence is its own state, and a
 * genuine zero stays distinguishable from it.
 */
export type PactFlowRunUsage =
  | { readonly available: false }
  | {
    readonly available: true
    readonly inputTokens: number
    readonly outputTokens: number
    readonly modelCalls: number
  }

/** Usage ceilings. Opt-in: an absent ceiling judges nothing. */
export interface PactFlowUsageBudget {
  readonly maxModelCalls?: number
  readonly maxTotalTokens?: number
}

/**
 * Verdict for a dimension that may not have been measured at all.
 *
 * `judged` separates "within budget" from "no budget was applied", which the
 * plain exhausted/not-exhausted pair cannot express. Without it, an unavailable
 * figure and a comfortable one are the same value, and "the budget passed" would
 * be reported for a run nobody measured.
 */
export type PactFlowUsageVerdict =
  | { readonly exhausted: false; readonly judged: boolean }
  | {
    readonly exhausted: true
    readonly judged: true
    readonly reason: 'model-calls' | 'total-tokens'
    readonly detail: string
  }

function countOf(value: unknown): number | undefined {
  // A string, a float or a negative number is not a count. Coercing one would
  // manufacture a figure nobody measured — the same defect as recording absence
  // as zero, arriving by a different route.
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined
}

/**
 * Read usage out of an executor's termination document. Anything short of all
 * three counts being present and well-formed is reported as unavailable: a
 * partial section tells us nothing trustworthy about the run's cost.
 */
export function parseRunUsage(document: unknown): PactFlowRunUsage {
  if (typeof document !== 'object' || document === null) return { available: false }
  const source = document as Record<string, unknown>
  const inputTokens = countOf(source.inputTokens)
  const outputTokens = countOf(source.outputTokens)
  const modelCalls = countOf(source.modelCalls)
  if (inputTokens === undefined || outputTokens === undefined || modelCalls === undefined) {
    return { available: false }
  }
  return { available: true, inputTokens, outputTokens, modelCalls }
}

/**
 * Compare measured usage against its ceilings.
 *
 * Never judges an unavailable figure, and never judges a dimension with no
 * configured ceiling. This dimension is additive: attempts, duration and
 * `maxOutputBytes` each remain the single authority for their own dimension, and
 * a usage figure MUST NOT change what any of them decides.
 */
export function evaluateUsageBudget(budget: PactFlowUsageBudget, usage: PactFlowRunUsage): PactFlowUsageVerdict {
  if (!usage.available) return { exhausted: false, judged: false }
  const checks: readonly {
    readonly reason: 'model-calls' | 'total-tokens'
    readonly limit: number | undefined
    readonly actual: number
    readonly unit: string
  }[] = [
    { reason: 'model-calls', limit: budget.maxModelCalls, actual: usage.modelCalls, unit: 'model call(s)' },
    { reason: 'total-tokens', limit: budget.maxTotalTokens, actual: usage.inputTokens + usage.outputTokens, unit: 'token(s)' },
  ]
  let judged = false
  for (const check of checks) {
    if (check.limit === undefined) continue
    if (!Number.isSafeInteger(check.limit) || check.limit < 0) {
      throw new Error('PactFlow usage budget must be a non-negative integer')
    }
    judged = true
    if (check.actual > check.limit) {
      return {
        exhausted: true,
        judged: true,
        reason: check.reason,
        detail: `run used ${String(check.actual)} ${check.unit}, the budget is ${String(check.limit)}`,
      }
    }
  }
  return { exhausted: false, judged }
}

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
  // Back the cut off to a UTF-8 character boundary. Slicing mid-character and
  // decoding yields U+FFFD — three bytes where the fragment was one or two — so
  // the "bounded" result came back OVER the budget it was meant to enforce, and
  // the channel assertion downstream then refused the payload entirely.
  let keep = Math.max(0, maxOutputBytes - markerBytes)
  while (keep > 0 && (bytes[keep]! & 0b1100_0000) === 0b1000_0000) keep -= 1
  const text = `${new TextDecoder().decode(bytes.slice(0, keep))}${marker}`
  return { text, truncated: true, originalBytes: bytes.length }
}
