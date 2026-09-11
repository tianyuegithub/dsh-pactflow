import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveCredential } from './credential-refs.mjs'

const key = resolveCredential('DEEPSEEK_API_KEY')
if (key === undefined) {
  throw new Error('real Worker E2E requires the DEEPSEEK_API_KEY credential ref')
}
execFileSync('pnpm', [
  'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts',
  'packages/dsh-pactflow/e2e/pactflow-real-worker.e2e.spec.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DSH_SNAPSHOT: 'record', DEEPSEEK_API_KEY: key },
  stdio: 'inherit',
})
