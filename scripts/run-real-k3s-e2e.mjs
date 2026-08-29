import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

execFileSync('pnpm', [
  'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts',
  'packages/dsh-pactflow/e2e/pactflow-k3s-worker.e2e.spec.ts',
  'packages/dsh-pactflow/e2e/pactflow-harness-probes.e2e.spec.ts',
  'packages/dsh-pactflow/e2e/pactflow-k3s-harness-tasks.e2e.spec.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DSH_K3S_E2E: '1' },
  stdio: 'inherit',
})
