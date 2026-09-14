/**
 * Evidence for the `verification` capability rung, and the reconciliation that
 * decides whether it may be claimed.
 *
 * This rung is the one most easily faked, from both directions:
 *
 * - **Upward.** The Host already runs registered validation commands on every
 *   delivery. Lighting up `verification` because the HOST verified something
 *   would be a claim about the wrong party: the rung describes what the HARNESS
 *   can be made to do, and the Host's own capability is not the Harness's.
 * - **Downward.** Every runner already emits free-form output from a CLI — that
 *   is precisely what `artifact` means. Accepting it here would make this rung
 *   indistinguishable from the one below it.
 *
 * So the evidence is defined narrowly and the Host reconciles it item by item: a
 * stepwise, order-sensitive task bound to a registered profile's identity, with a
 * per-step report. Anything short of a full match is not this rung, and the
 * reasons are named rather than summarised as "not attested".
 */

import type { PactFlowHarnessCapabilityLevel } from './harness-capabilities.ts'

/** One step as registered in a validation profile. */
export interface PactFlowVerificationStepSpec {
  readonly command: string
  readonly args: readonly string[]
}

/** The registered profile a report must be bound to. */
export interface PactFlowVerificationProfile {
  readonly profileId: string
  readonly profileRevision: number
  readonly steps: readonly PactFlowVerificationStepSpec[]
}

/** One step as reported by the runner. */
export interface PactFlowVerificationStepReport extends PactFlowVerificationStepSpec {
  readonly exitCode: number
  readonly durationMs: number
}

/** What the runner claims it executed. */
export interface PactFlowVerificationReport {
  readonly profileId: string
  readonly profileRevision: number
  readonly steps: readonly PactFlowVerificationStepReport[]
}

export interface PactFlowVerificationReconciliation {
  readonly attested: boolean
  /** Every mismatch found, named. Empty exactly when `attested` is true. */
  readonly mismatches: readonly string[]
}

function sameStep(expected: PactFlowVerificationStepSpec, actual: PactFlowVerificationStepSpec): boolean {
  return expected.command === actual.command
    && expected.args.length === actual.args.length
    && expected.args.every((argument, index) => argument === actual.args[index])
}

/**
 * Compare a runner's report against the registered profile, item by item.
 *
 * Every mismatch is collected rather than returned at the first one: an operator
 * reading "not attested" learns nothing, while "step 2 command differs, step 3
 * exited 1" is actionable. A partial match is never a partial claim.
 */
export function reconcileVerificationReport(
  profile: PactFlowVerificationProfile,
  report: PactFlowVerificationReport,
): PactFlowVerificationReconciliation {
  const mismatches: string[] = []
  if (report.profileId !== profile.profileId) {
    mismatches.push(`report is bound to profile "${report.profileId}", the registered profile is "${profile.profileId}"`)
  }
  if (report.profileRevision !== profile.profileRevision) {
    mismatches.push(`report is bound to profile revision ${String(report.profileRevision)}, the registered revision is ${String(profile.profileRevision)}`)
  }
  if (report.steps.length !== profile.steps.length) {
    mismatches.push(`report has ${String(report.steps.length)} step(s), the registered profile has ${String(profile.steps.length)}`)
  }
  const shared = Math.min(report.steps.length, profile.steps.length)
  for (let index = 0; index < shared; index += 1) {
    const expected = profile.steps[index]!
    const actual = report.steps[index]!
    // Position matters: the profile is order-sensitive by construction, so a
    // step reported at the wrong index is a mismatch even if it appears elsewhere.
    if (!sameStep(expected, actual)) {
      mismatches.push(`step ${String(index + 1)} command identity differs from the registered profile`)
    }
    if (actual.exitCode !== 0) {
      mismatches.push(`step ${String(index + 1)} exited ${String(actual.exitCode)}`)
    }
  }
  return { attested: mismatches.length === 0, mismatches }
}

/**
 * The level a probe may claim given what the runner reported.
 *
 * `artifact` is the floor here because reaching this function at all means a CLI
 * ran. `verification` requires a report that fully reconciles — no report, an
 * empty report, or a single free-form command result all stay at `artifact`.
 */
export function attestedLevelFromReport(
  profile: PactFlowVerificationProfile,
  report: PactFlowVerificationReport | undefined,
): PactFlowHarnessCapabilityLevel {
  if (report === undefined || report.steps.length === 0) return 'artifact'
  return reconcileVerificationReport(profile, report).attested ? 'verification' : 'artifact'
}

/**
 * The synthetic profile the probe registers to observe this rung (task 0.4).
 *
 * Two steps, and deliberately order-dependent: step one writes a marker, step two
 * asserts it and removes it. A profile whose steps commute could not distinguish
 * "ran them in order" from "ran them at all", which is the only thing this
 * observation is for. The marker lives under /tmp — writing into the task
 * worktree would surface as a Worker change — and the last step deletes it, so
 * the probe leaves nothing behind.
 */
export const PACTFLOW_VERIFICATION_PROBE_PROFILE = {
  profileId: 'pactflow-probe-verification',
  profileRevision: 1,
  markerPath: '/tmp/pactflow-probe-verification-marker',
  steps: [
    { command: 'sh', args: ['-c', 'printf pactflow-probe > /tmp/pactflow-probe-verification-marker'] },
    {
      command: 'sh',
      args: ['-c', 'test "$(cat /tmp/pactflow-probe-verification-marker)" = pactflow-probe && rm -f /tmp/pactflow-probe-verification-marker'],
    },
  ],
} as const satisfies PactFlowVerificationProfile & { readonly markerPath: string }
