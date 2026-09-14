import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

// Real-path acceptance for the STORAGE lane of artifact-ref-handoff tasks 5.1
// and 7.1: put -> ref -> resolve with hash/byte verification, the per-channel
// oversize gate, orphan reconciliation, and the mark-never-delete ledger.
//
// It does NOT complete 5.1 or 7.1. The cluster lane — worker put inside a
// dispatched run, ref handed back through the result document, per-run artifact
// Secret recycling, and a UI store binding driving a long task on real model
// quota — needs a live K3s cluster and a human, and is not claimed here.
//
// A missing variable makes the suite skip, and a skipped suite is NOT a pass,
// so refuse to run rather than hand back a green-looking report (the same trap
// noted in run-real-suite.mjs about key-less entries silently skipping).
const REQUIRED = [
  'PACTFLOW_REAL_ARTIFACT_ENDPOINT',
  'PACTFLOW_REAL_ARTIFACT_BUCKET',
  'PACTFLOW_REAL_ARTIFACT_ACCESS_KEY',
  'PACTFLOW_REAL_ARTIFACT_SECRET_KEY',
]

const missing = REQUIRED.filter(name => process.env[name] === undefined || process.env[name] === '')
if (missing.length > 0) {
  process.stderr.write(`PactFlow real artifact acceptance is not armed; missing: ${missing.join(', ')}\n`)
  process.stderr.write('A skipped suite is not a pass. Export every variable above, then re-run.\n')
  process.exitCode = 1
} else {
  const root = resolve(import.meta.dirname, '..')
  const reportDir = mkdtempSync(join(tmpdir(), 'pactflow-real-artifact-'))
  const reportFile = join(reportDir, 'report.json')
  let failed = false
  try {
    execFileSync('pnpm', [
      'exec', 'vitest', 'run',
      // Serial, matching the repository's unit-test convention: these suites
      // share one bucket and must not race each other.
      '--maxWorkers=1',
      // An empty match is a configuration error, not a pass.
      '--passWithNoTests=false',
      '--reporter=json', '--outputFile', reportFile,
      'packages/dsh-pactflow/tests/artifact-store.real.spec.ts',
      'packages/dsh-pactflow/tests/artifact-handoff.real.spec.ts',
    ], { cwd: root, env: { ...process.env }, stdio: 'inherit' })
  } catch {
    failed = true
  }

  // Arming the variables is necessary but not sufficient: a renamed spec file, a
  // future gating variable this list does not know about, or a describe-level
  // skip all leave vitest exiting 0 with nothing executed. Read the report and
  // demand actually-executed, actually-passing cases.
  let report
  try {
    report = JSON.parse(readFileSync(reportFile, 'utf8'))
  } catch {
    process.stderr.write('PactFlow real artifact acceptance produced no machine-readable report; treating as failure.\n')
    process.exitCode = 1
  } finally {
    rmSync(reportDir, { recursive: true, force: true })
  }

  if (report !== undefined) {
    const passed = Number(report.numPassedTests ?? 0)
    const pending = Number(report.numPendingTests ?? 0)
    const todo = Number(report.numTodoTests ?? 0)
    const failures = Number(report.numFailedTests ?? 0) + Number(report.numFailedTestSuites ?? 0)
    if (failures > 0 || failed) {
      process.stderr.write(`PactFlow real artifact acceptance failed: ${String(failures)} failing case(s)/suite(s).\n`)
      process.exitCode = 1
    } else if (passed === 0) {
      process.stderr.write('PactFlow real artifact acceptance executed zero cases. A skipped suite is not a pass.\n')
      process.exitCode = 1
    } else if (pending > 0 || todo > 0) {
      process.stderr.write(`PactFlow real artifact acceptance left ${String(pending + todo)} case(s) skipped. A skipped case is not a pass.\n`)
      process.exitCode = 1
    } else {
      process.stdout.write(`PactFlow real artifact acceptance: ${String(passed)} case(s) executed and passed, 0 skipped.\n`)
    }
  }
}
