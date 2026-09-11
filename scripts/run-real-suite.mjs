import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const suiteKey = process.argv[2]

const suites = {
  'probe-ledger': {
    file: 'packages/dsh-pactflow/e2e/pactflow-real-probe-ledger.e2e.spec.ts',
    env: { DSH_K3S_E2E: '1' },
  },
  'crash-restart': {
    file: 'packages/dsh-pactflow/e2e/pactflow-real-crash-restart.e2e.spec.ts',
    env: { DSH_K3S_E2E: '1', DSH_REAL_CRASH: '1' },
  },
  // The real-approval acceptance needs the model credential lane, so it owns a
  // dedicated runner (`scripts/run-real-approval-e2e.mjs`) instead of this
  // generic key-less dispatcher — a key-less entry here would silently skip.
  'todo-webapp': {
    file: 'packages/dsh-pactflow/e2e/pactflow-real-todo-webapp.e2e.spec.ts',
    env: { DSH_K3S_E2E: '1' },
  },
}

const suite = suites[suiteKey]
if (!suite) {
  process.stderr.write(`usage: node scripts/run-real-suite.mjs <${Object.keys(suites).join('|')}>\n`)
  process.exitCode = 1
} else {
  execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', suite.file], {
    cwd: root,
    env: { ...process.env, ...suite.env },
    stdio: 'inherit',
  })
}