import { describe, expect, it } from 'vitest'
// @ts-expect-error -- plain ESM worker module, no types by design
import { parseMountedProfile, runVerificationProfile } from '../worker/dsh/verification.mjs'
import { reconcileVerificationReport } from '../src/harness-verification.ts'

/**
 * The runner half of the `verification` rung, checked against the Host half that
 * will reconcile it. Both sides in one file on purpose: the contract is the
 * agreement between them, and each alone can be self-consistently wrong.
 */

const profile = {
  profileId: 'pactflow-probe-verification',
  profileRevision: 1,
  steps: [
    { command: process.execPath, args: ['-e', 'process.exit(0)'] },
    { command: process.execPath, args: ['-e', 'process.exit(0)'] },
  ],
}

describe('PactFlow worker verification protocol', () => {
  it('reports every step in order, and the Host reconciles it', async () => {
    const report = await runVerificationProfile(profile)
    expect(report.steps).toHaveLength(2)
    expect(report.steps.every((step: { exitCode: number }) => step.exitCode === 0)).toBe(true)
    expect(report.steps.every((step: { durationMs: number }) => Number.isFinite(step.durationMs))).toBe(true)
    // The agreement: what the runner produces is exactly what the Host attests on.
    expect(reconcileVerificationReport(profile, report)).toEqual({ attested: true, mismatches: [] })
  })

  it('runs every step even after one fails, rather than truncating the report', async () => {
    // A truncated report and an out-of-order one are the same evidence to the
    // reconciliation, so stopping early would hand it something it cannot judge.
    const failing = {
      ...profile,
      steps: [
        { command: process.execPath, args: ['-e', 'process.exit(3)'] },
        { command: process.execPath, args: ['-e', 'process.exit(0)'] },
      ],
    }
    const report = await runVerificationProfile(failing)
    expect(report.steps).toHaveLength(2)
    expect(report.steps[0].exitCode).toBe(3)
    // And the Host refuses it, naming the step.
    const outcome = reconcileVerificationReport(failing, report)
    expect(outcome.attested).toBe(false)
    expect(outcome.mismatches.join('\n')).toMatch(/step 1 exited 3/)
  })

  it('reports the commands it actually spawned, not the ones declared', async () => {
    const report = await runVerificationProfile(profile)
    // Identical here because nothing went wrong — the assertion is that the
    // report is built from the spawn, so a divergence would show up.
    expect(report.steps[0].command).toBe(process.execPath)
    expect(report.steps[0].args).toEqual(['-e', 'process.exit(0)'])
  })

  it('gives a spawn failure an exit code rather than omitting the step', async () => {
    const missing = {
      ...profile,
      steps: [{ command: '/nonexistent/pactflow-probe-binary', args: [] }],
    }
    const report = await runVerificationProfile(missing)
    expect(report.steps).toHaveLength(1)
    expect(report.steps[0].exitCode).toBeGreaterThan(0)
  })

  it('gives a timed-out step an exit code rather than hanging or omitting it', async () => {
    const slow = {
      ...profile,
      steps: [{ command: process.execPath, args: ['-e', 'setTimeout(() => {}, 60000)'] }],
    }
    const report = await runVerificationProfile(slow, { stepTimeoutMs: 150 })
    expect(report.steps).toHaveLength(1)
    expect(report.steps[0].exitCode).toBeGreaterThan(0)
  }, 20_000)

  it.each([
    ['no profile at all', undefined],
    ['an empty step list', { profileId: 'p', profileRevision: 1, steps: [] }],
    ['a missing identity', { profileRevision: 1, steps: [{ command: 'true', args: [] }] }],
    ['a malformed step', { profileId: 'p', profileRevision: 1, steps: [{ command: 'true' }] }],
  ] as const)('reports nothing at all for %s', async (_label, input) => {
    // Reporting against a profile nobody registered would bind the report to an
    // identity that does not exist; the Host then attests at most `artifact`.
    expect(await runVerificationProfile(input)).toBeUndefined()
  })
})

describe('PactFlow mounted profile parsing', () => {
  it('reads a mounted profile', () => {
    expect(parseMountedProfile(JSON.stringify(profile))).toMatchObject({ profileId: profile.profileId })
  })

  it.each([['nothing', undefined], ['an empty string', ''], ['invalid JSON', '{oops']] as const)(
    'reports %s as no profile rather than throwing', (_label, raw) => {
      expect(parseMountedProfile(raw)).toBeUndefined()
    })
})
