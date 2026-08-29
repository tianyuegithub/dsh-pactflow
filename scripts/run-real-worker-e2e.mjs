import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

const credentialFile = resolve(process.env.DSH_CREDENTIAL_FILE ?? resolve(homedir(), '.dsh/.credentials.yaml'))
const document = yaml.load(readFileSync(credentialFile, 'utf8'))
const key = document?.refs?.DEEPSEEK_API_KEY
if (typeof key !== 'string' || key.length === 0) {
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
