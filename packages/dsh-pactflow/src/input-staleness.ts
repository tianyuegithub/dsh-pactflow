/**
 * Code-input staleness.
 *
 * A successor task runs from an immutable snapshot of its predecessors' commits. If
 * a predecessor later produces a new successful commit, the successor's recorded
 * input is no longer the predecessor's current result. This is *reported*, never
 * silently repaired: the historical fact (the successor ran on v1) is preserved and
 * the staleness is surfaced so a human can decide to re-run or accept.
 */

export interface PactFlowRecordedCodeInput {
  /** Dependency node id the input came from. */
  readonly dependency: string
  readonly branch: string
  readonly commit: string
}

export interface PactFlowStaleCodeInput {
  readonly dependency: string
  readonly branch: string
  readonly recorded: string
  readonly latest: string
}

/**
 * Compare the code inputs a successor actually consumed against each dependency's
 * current latest successful commit. Order-independent and deterministic. A
 * dependency with no known latest commit is not reported (nothing to compare).
 */
export function staleCodeInputs(
  recorded: readonly PactFlowRecordedCodeInput[],
  latestByDependency: ReadonlyMap<string, string>,
): readonly PactFlowStaleCodeInput[] {
  const stale: PactFlowStaleCodeInput[] = []
  for (const input of recorded) {
    const latest = latestByDependency.get(input.dependency)
    if (latest === undefined) continue
    if (latest !== input.commit) {
      stale.push({ dependency: input.dependency, branch: input.branch, recorded: input.commit, latest })
    }
  }
  return stale.sort((left, right) =>
    left.dependency < right.dependency ? -1 : left.dependency > right.dependency ? 1
      : left.branch.localeCompare(right.branch))
}
