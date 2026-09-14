import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_VERIFICATION_PROBE_PROFILE,
  attestedLevelFromReport,
  reconcileVerificationReport,
} from '../src/harness-verification.ts'

/**
 * `verification` is the rung most easily faked, from both directions.
 *
 * Upward: the Host itself runs registered validation commands on every delivery.
 * It would be trivial — and wrong — to light up `verification` because the HOST
 * verified something. The level is a claim about what the HARNESS can do; the
 * Host's own capability is not the Harness's.
 *
 * Downward: every runner already produces free-form output from a CLI, which is
 * exactly what `artifact` means. Accepting that as verification evidence would
 * make the rung indistinguishable from the one below it.
 *
 * So the evidence is defined narrowly: a stepwise, order-sensitive task bound to
 * a registered profile's identity, with a per-step report the Host reconciles
 * item by item. Anything else is not this rung.
 */

const registered = {
  profileId: 'pactflow-probe-verification',
  profileRevision: 1,
  steps: [
    { command: 'sh', args: ['-c', 'printf ok > /tmp/pf-probe-marker'] },
    { command: 'sh', args: ['-c', 'test "$(cat /tmp/pf-probe-marker)" = ok && rm -f /tmp/pf-probe-marker'] },
  ],
}

const goodReport = {
  profileId: 'pactflow-probe-verification',
  profileRevision: 1,
  steps: [
    { command: 'sh', args: ['-c', 'printf ok > /tmp/pf-probe-marker'], exitCode: 0, durationMs: 3 },
    { command: 'sh', args: ['-c', 'test "$(cat /tmp/pf-probe-marker)" = ok && rm -f /tmp/pf-probe-marker'], exitCode: 0, durationMs: 4 },
  ],
}

describe('PactFlow verification report reconciliation', () => {
  it('attests only when identity, count, order and every step match', () => {
    const outcome = reconcileVerificationReport(registered, goodReport)
    expect(outcome).toEqual({ attested: true, mismatches: [] })
  })

  it('refuses a report whose steps are in the wrong order, and names the step', () => {
    // Order is the whole point of the synthetic profile: step 2 only passes
    // because step 1 ran first. A runner that reports them swapped either did not
    // run them in order, or is not reporting what it actually ran.
    const outcome = reconcileVerificationReport(registered, {
      ...goodReport, steps: [goodReport.steps[1]!, goodReport.steps[0]!],
    })
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.join('\n')).toMatch(/step 1/)
  })

  it('refuses a report that is missing a step, and names the count', () => {
    const outcome = reconcileVerificationReport(registered, { ...goodReport, steps: [goodReport.steps[0]!] })
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.join('\n')).toContain('1')
    expect(outcome.mismatches.join('\n')).toContain('2')
  })

  it('refuses a report with an extra step', () => {
    const outcome = reconcileVerificationReport(registered, {
      ...goodReport,
      steps: [...goodReport.steps, { command: 'sh', args: ['-c', 'true'], exitCode: 0, durationMs: 1 }],
    })
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.length).toBeGreaterThan(0)
  })

  it('refuses a report bound to a different profile identity or revision', () => {
    expect(reconcileVerificationReport(registered, { ...goodReport, profileId: 'something-else' }).attested).toBe(false)
    expect(reconcileVerificationReport(registered, { ...goodReport, profileRevision: 2 }).attested).toBe(false)
  })

  it('refuses a report where a step failed', () => {
    const outcome = reconcileVerificationReport(registered, {
      ...goodReport,
      steps: [goodReport.steps[0]!, { ...goodReport.steps[1]!, exitCode: 1 }],
    })
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.join('\n')).toMatch(/exit/i)
  })

  it('names every mismatch rather than stopping at the first', () => {
    const outcome = reconcileVerificationReport(registered, {
      profileId: 'wrong', profileRevision: 9,
      steps: [{ command: 'echo', args: ['hi'], exitCode: 1, durationMs: 1 }],
    })
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.length).toBeGreaterThanOrEqual(2)
  })
})

describe('PactFlow verification cannot be impersonated from either direction', () => {
  it('does not claim verification when the runner reported no stepwise report', () => {
    // Upward impersonation: the Host ran its own validation commands. That says
    // nothing about the Harness. A "the Host verified, so count it" implementation
    // would return 'verification' here — this is the case that catches it.
    expect(attestedLevelFromReport(registered, undefined)).toBe('artifact')
    expect(attestedLevelFromReport(registered, { profileId: registered.profileId, profileRevision: 1, steps: [] }))
      .toBe('artifact')
  })

  it('does not claim verification from a single free-form command result', () => {
    // Downward impersonation: every runner emits CLI output already; that is what
    // `artifact` means. A "it ran a command, light it up" implementation would
    // return 'verification' here.
    expect(attestedLevelFromReport(registered, {
      profileId: registered.profileId, profileRevision: 1,
      steps: [{ command: 'sh', args: ['-c', 'echo done'], exitCode: 0, durationMs: 1 }],
    })).toBe('artifact')
  })

  it('claims verification only for a reconciled stepwise report', () => {
    expect(attestedLevelFromReport(registered, goodReport)).toBe('verification')
  })
})

describe('PactFlow synthetic verification probe profile', () => {
  it('has at least two steps and is order-sensitive', () => {
    // One step cannot demonstrate ordering, and a profile whose steps commute
    // cannot distinguish "ran them in order" from "ran them at all".
    expect(PACTFLOW_VERIFICATION_PROBE_PROFILE.steps.length).toBeGreaterThanOrEqual(2)
    const [first, second] = PACTFLOW_VERIFICATION_PROBE_PROFILE.steps
    const marker = PACTFLOW_VERIFICATION_PROBE_PROFILE.markerPath
    // Step 1 writes the marker; step 2 asserts it. Swapping them must fail.
    expect(first!.args.join(' ')).toContain(marker)
    expect(second!.args.join(' ')).toContain(marker)
  })

  it('removes its own marker so the probe leaves nothing behind', () => {
    const last = PACTFLOW_VERIFICATION_PROBE_PROFILE.steps.at(-1)!
    expect(last.args.join(' ')).toMatch(/rm\b/)
    expect(last.args.join(' ')).toContain(PACTFLOW_VERIFICATION_PROBE_PROFILE.markerPath)
  })

  it('writes its marker somewhere ephemeral, never into the task worktree', () => {
    // A probe that wrote into the workspace would show up as a Worker change.
    expect(PACTFLOW_VERIFICATION_PROBE_PROFILE.markerPath.startsWith('/tmp/')).toBe(true)
  })

  it('carries an identity the report must be bound to', () => {
    expect(PACTFLOW_VERIFICATION_PROBE_PROFILE.profileId.length).toBeGreaterThan(0)
    expect(Number.isSafeInteger(PACTFLOW_VERIFICATION_PROBE_PROFILE.profileRevision)).toBe(true)
  })
})
