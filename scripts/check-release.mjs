import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertReleaseWebReport } from './release-web-report.mjs'
import { preserveReport } from './evidence-store.mjs'
import { resolveProfileRuntime } from './profile-runtime.mjs'

resolveProfileRuntime({ source: process.env.DSH_SOURCE, cliEntry: process.env.DSH_CLI_ENTRY })

const root = resolve(import.meta.dirname, '..')
const e2eRoot = join(root, 'packages/dsh-pactflow/e2e')
const requiredFiles = readdirSync(e2eRoot, { recursive: true })
  .filter(file => typeof file === 'string' && file.endsWith('.spec.ts')).map(file => join(e2eRoot, file))
const evidenceDirectory = mkdtempSync(join(tmpdir(), 'pactflow-release-gate-'))
const reportPath = join(evidenceDirectory, 'web-results.json')
const run = (name, args = []) => execFileSync('pnpm', ['run', name, ...args], { cwd: root, stdio: 'inherit' })

try {
  run('check')
  run('test:web', ['--reporter=json', `--outputFile=${reportPath}`])
  assertReleaseWebReport(JSON.parse(readFileSync(reportPath, 'utf8')), requiredFiles)
  run('verify:profile')
} finally {
  // 唯一证据先保全到持久目录，再清理临时目录（失败报告同样保留）。
  preserveReport(reportPath, 'check-release')
  rmSync(evidenceDirectory, { recursive: true, force: true })
}
