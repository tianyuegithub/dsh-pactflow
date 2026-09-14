/**
 * The `verification` capability rung, runner side.
 *
 * The Host reconciles what this reports against the profile it registered —
 * identity, revision, step count, per-step command identity by position, and
 * per-step exit code. So the report has to describe what was ACTUALLY run, in the
 * order it was actually run, with nothing filled in.
 *
 * Two temptations are refused here on purpose, because the Host's reconciliation
 * cannot tell the difference and would happily attest a lie:
 *
 *  - Do not skip a step whose predecessor failed and report it as "not reached".
 *    The profile is order-sensitive by construction (step two only passes because
 *    step one ran), so a truncated report and an out-of-order one are the same
 *    evidence. Run every step, report every outcome.
 *  - Do not report the profile's declared commands. Report the ones this process
 *    spawned. They are the same only when nothing went wrong, and the case that
 *    matters is the one where something did.
 */
import { spawn } from 'node:child_process'

/** Run one step and report what actually happened, never what was supposed to. */
function runStep(step, timeoutMs) {
  return new Promise(resolve => {
    const startedAt = Date.now()
    const child = spawn(step.command, step.args, { stdio: ['ignore', 'ignore', 'ignore'] })
    let settled = false
    const finish = exitCode => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({
        command: step.command, args: [...step.args],
        exitCode, durationMs: Date.now() - startedAt,
      })
    }
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL') } catch { /* already gone */ }
      // A timeout is a non-zero outcome, not a missing one: reporting it as absent
      // would let the Host reconcile a step that never finished.
      finish(124)
    }, timeoutMs)
    child.once('exit', code => { finish(code ?? 1) })
    // Spawn failure (missing binary, EACCES) is also an outcome with an exit code.
    child.once('error', () => { finish(127) })
  })
}

/**
 * Execute a registered verification profile and produce the stepwise report.
 *
 * Returns `undefined` when no profile was mounted — the Host then attests at most
 * `artifact`, which is correct: nothing here observed a verification.
 */
export async function runVerificationProfile(profile, { stepTimeoutMs = 60_000 } = {}) {
  if (profile === undefined || profile === null) return undefined
  if (typeof profile.profileId !== 'string' || profile.profileId === ''
    || !Number.isSafeInteger(profile.profileRevision)
    || !Array.isArray(profile.steps) || profile.steps.length === 0) {
    // A malformed profile is not something to partially honour: reporting against
    // it would bind the report to an identity nobody registered.
    return undefined
  }
  const steps = []
  for (const step of profile.steps) {
    if (typeof step?.command !== 'string' || !Array.isArray(step.args)) return undefined
    // Every step runs, including after a failure — see the header: a truncated
    // report and an out-of-order one are indistinguishable to the reconciliation.
    steps.push(await runStep(step, stepTimeoutMs))
  }
  return { profileId: profile.profileId, profileRevision: profile.profileRevision, steps }
}

/** Read the profile the Host mounted for this run, if it mounted one. */
export function parseMountedProfile(raw) {
  if (typeof raw !== 'string' || raw.trim() === '') return undefined
  try { return JSON.parse(raw) } catch { return undefined }
}
