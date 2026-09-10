import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Real multi-process crash-and-restart recovery (authorized B-class run).
//
// The scenario (boot host → dispatch real K3s Job → SIGKILL host → observe the Job
// out-of-band → boot a FRESH host on the SAME DSH_HOME → assert recovery) is driven
// entirely by scripts/crash-restart-runner.mjs and reported as one JSON verdict. This
// file only spawns that script with a literal argv, so no dynamic value ever sits
// beside a CLI flag, and the assertions below are made on the returned evidence.
const enabled = process.env.DSH_K3S_E2E === '1' && process.env.DSH_REAL_CRASH === '1'
const runner = resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'crash-restart-runner.mjs')

interface CrashRestartVerdict {
  ok: boolean
  error?: string
  hostKilled?: boolean
  jobObservableAfterCrash?: boolean
  projectPresent?: boolean
  crashedState?: string
  runId?: string
  recovered?: boolean
  jobNameMatched?: boolean
  branchMatched?: boolean
}

describe.skipIf(!enabled)('PactFlow real crash-and-restart recovery', { timeout: 900_000 }, () => {
  it('survives an abrupt host kill and recovers the non-terminal Run identity from durable facts', () => {
    let verdict: CrashRestartVerdict
    try {
      const stdout = execFileSync(process.execPath, [runner], { encoding: 'utf8', env: { ...process.env } })
      verdict = JSON.parse(stdout.trim().split('\n').at(-1) ?? '{}') as CrashRestartVerdict
    } catch (error) {
      const stdout = (error as { stdout?: string }).stdout ?? ''
      const parsed = stdout.trim().split('\n').at(-1)
      verdict = parsed === undefined || parsed === '' ? { ok: false, error: String(error) } : JSON.parse(parsed) as CrashRestartVerdict
    }

    // A crash-restart run is only meaningful if the host really died and the Job it
    // left behind was really on the cluster — assert those before the recovery claim.
    expect(verdict.error, verdict.error ?? '').toBeUndefined()
    expect(verdict.hostKilled).toBe(true)
    expect(verdict.jobObservableAfterCrash).toBe(true)
    expect(['claimed', 'running', 'blocked']).toContain(verdict.crashedState)

    // The fresh host, on the same DSH_HOME, must surface the exact non-terminal Run.
    expect(verdict.projectPresent).toBe(true)
    expect(verdict.recovered).toBe(true)
    expect(verdict.jobNameMatched).toBe(true)
    expect(verdict.branchMatched).toBe(true)
  })
})
