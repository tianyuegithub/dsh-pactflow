import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

const credentialFile = resolve(process.env.DSH_CREDENTIAL_FILE ?? resolve(homedir(), '.dsh/.credentials.yaml'))
const document = yaml.load(readFileSync(credentialFile, 'utf8'))
const token = document?.refs?.PACTFLOW_GITEA_API_TOKEN
if (typeof token !== 'string' || token.length === 0) {
  throw new Error('real Gitea E2E requires the PACTFLOW_GITEA_API_TOKEN credential ref')
}
execFileSync('pnpm', [
  'exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts',
  'packages/dsh-pactflow/e2e/pactflow-gitea-closing.e2e.spec.ts',
], {
  cwd: resolve(import.meta.dirname, '..'),
  env: { ...process.env, DSH_GITEA_E2E: '1', PACTFLOW_GITEA_API_TOKEN: token },
  stdio: 'inherit',
})
