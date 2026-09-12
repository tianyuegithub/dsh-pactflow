import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { resolveCredential } from './credential-refs.mjs'

const key = resolveCredential('DEEPSEEK_API_KEY')
const interactions = process.argv.includes('--interactions')
const autopilot = process.argv.includes('--autopilot') || interactions
const gitea = autopilot ? resolveCredential('PACTFLOW_GITEA_API_TOKEN') : undefined
if (autopilot && !gitea) throw new Error('autopilot acceptance requires the PACTFLOW_GITEA_API_TOKEN credential ref')
if (key === undefined) {
  throw new Error('real Worker E2E requires the DEEPSEEK_API_KEY credential ref')
}
execFileSync('pnpm', [
  'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts',
  interactions ? 'packages/dsh-pactflow/e2e/pactflow-worker-interactions.e2e.spec.ts' : autopilot ? 'packages/dsh-pactflow/e2e/pactflow-autopilot.e2e.spec.ts' : 'packages/dsh-pactflow/e2e/pactflow-real-worker.e2e.spec.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DSH_SNAPSHOT: 'record', DEEPSEEK_API_KEY: key,
    ...(interactions ? { DSH_WORKER_INTERACTIONS_E2E: '1' } : {}),
    ...(autopilot ? { DSH_AUTOPILOT_E2E: '1', PACTFLOW_GITEA_API_TOKEN: gitea } : {}) },
  stdio: 'inherit',
})
