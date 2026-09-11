import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveCredential } from './credential-refs.mjs'

// The real-approval acceptance drives a LIVE model turn that blocks on the
// native DSH approval panel, so it shares the real Worker suite's credential
// lane: record mode with the stored DEEPSEEK_API_KEY. The approver decision
// itself is made in the browser by whoever runs this (runbook §9.1); this
// script only provisions the model and enables the scenario.
const key = resolveCredential('DEEPSEEK_API_KEY')
if (key === undefined) {
  throw new Error('real approval E2E requires the DEEPSEEK_API_KEY credential ref')
}
execFileSync('pnpm', [
  'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts',
  'packages/dsh-pactflow/e2e/pactflow-real-approval.e2e.spec.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DSH_SNAPSHOT: 'record', DSH_REAL_APPROVAL: '1', DEEPSEEK_API_KEY: key },
  stdio: 'inherit',
})
