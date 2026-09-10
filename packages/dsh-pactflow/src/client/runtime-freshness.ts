/**
 * Tracks how fresh runtime data (capacity and workspace configuration) is.
 *
 * That data lives outside the Session event log, so a pure configuration change
 * may not move any projection. The overlay therefore requeries on a bounded
 * interval, and this tracker decides when a requery is due and whether the
 * currently displayed values may be stale.
 */
export interface PactFlowFreshnessState {
  /** True when the last attempt failed: displayed values may be outdated. */
  readonly stale: boolean
  /** Epoch ms of the last successful read, or null when there has never been one. */
  readonly lastSuccessAt: number | null
}

export interface PactFlowFreshnessTracker {
  readonly intervalMs: number
  /** Whether a bounded-interval requery is due at `at` (defaults to now). */
  shouldRequery(at?: number): boolean
  /** Record a successful read: clear stale and remember the time. */
  onSuccess(at?: number): void
  /** Record a failed read: mark stale, keep the last success time. */
  onFailure(): void
  state(): PactFlowFreshnessState
}

export const PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS = 20_000

export function createFreshnessTracker(options: {
  readonly intervalMs?: number
  readonly now?: () => number
} = {}): PactFlowFreshnessTracker {
  const intervalMs = options.intervalMs ?? PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS
  const now = options.now ?? (() => Date.now())
  let lastSuccessAt: number | null = null
  let lastAttemptAt: number | null = null
  let stale = false
  return {
    intervalMs,
    shouldRequery(at = now()): boolean {
      if (lastAttemptAt === null) return true
      return at - lastAttemptAt >= intervalMs
    },
    onSuccess(at = now()): void {
      lastSuccessAt = at
      lastAttemptAt = at
      stale = false
    },
    onFailure(): void {
      lastAttemptAt = now()
      stale = true
    },
    state(): PactFlowFreshnessState {
      return { stale, lastSuccessAt }
    },
  }
}
