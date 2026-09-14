import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

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
  execFileSync('pnpm', [
    'exec', 'vitest', 'run',
    'packages/dsh-pactflow/tests/artifact-handoff.real.spec.ts',
    'packages/dsh-pactflow/tests/artifact-store.real.spec.ts',
  ], {
    cwd: resolve(import.meta.dirname, '..'),
    env: { ...process.env },
    stdio: 'inherit',
  })
}
