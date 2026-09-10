import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'
import yaml from 'js-yaml'
import { assertReleaseWebReport } from './release-web-report.mjs'
import { preserveReport } from './evidence-store.mjs'

const root = resolve(import.meta.dirname, '..')

function kubectlReachable() {
  try {
    execFileSync('kubectl', ['get', 'namespace', 'pactflow', '-o', 'name'], { stdio: 'pipe', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function giteaTokenRefPresent() {
  try {
    const credentialFile = resolve(process.env.DSH_CREDENTIAL_FILE ?? resolve(homedir(), '.dsh/.credentials.yaml'))
    const document = yaml.load(readFileSync(credentialFile, 'utf8'))
    const token = document?.refs?.PACTFLOW_GITEA_API_TOKEN ?? document?.PACTFLOW_GITEA_API_TOKEN
    return typeof token === 'string' && token.length > 0
  } catch {
    return false
  }
}

/** 网页零跳过收口前置检查：逐项列出缺失，任一缺失即拒绝（不触碰真实环境）。 */
export function checkWebGatePrerequisites() {
  const missing = []
  if (!kubectlReachable()) missing.push('DSH_K3S_E2E environment (kubectl cannot reach namespace pactflow)')
  if (!giteaTokenRefPresent()) missing.push('PACTFLOW_GITEA_API_TOKEN credential ref')
  if (process.env.DSH_SNAPSHOT !== 'record') missing.push('DSH_SNAPSHOT=record (real worker suites must run in record mode)')
  return missing
}

export function runRealWebGate() {
  const missing = checkWebGatePrerequisites()
  if (missing.length > 0) {
    throw new Error(`real web gate: missing prerequisites:\n- ${missing.join('\n- ')}`)
  }
  const e2eRoot = join(root, 'packages/dsh-pactflow/e2e')

  const requiredFiles = readdirSync(e2eRoot, { recursive: true })
    .filter(file => typeof file === 'string' && file.endsWith('.spec.ts')).map(file => join(e2eRoot, file))
  const evidenceDirectory = mkdtempSync(join(tmpdir(), 'pactflow-real-web-gate-'))
  const reportPath = join(evidenceDirectory, 'web-results.json')
  try {
    execFileSync('pnpm', ['run', 'test:web', '--reporter=json', `--outputFile=${reportPath}`], {
      cwd: root,
      env: {
        ...process.env,
        DSH_K3S_E2E: '1',
        DSH_GITEA_E2E: '1',
        DSH_SNAPSHOT: 'record',
      },
      stdio: 'inherit',
    })
    assertReleaseWebReport(JSON.parse(readFileSync(reportPath, 'utf8')), requiredFiles)
  } finally {
    // 唯一证据先保全到持久目录，再清理临时目录（失败报告同样保留）。
    preserveReport(reportPath, 'real-web-gate')
    rmSync(evidenceDirectory, { recursive: true, force: true })
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  const dryRun = process.argv.includes('--dry-run')
  if (dryRun) {
    const missing = checkWebGatePrerequisites()
    if (missing.length > 0) {
      process.stderr.write(`[real-web-gate] dry-run rejected, missing prerequisites:\n- ${missing.join('\n- ')}\n`)
      process.exitCode = 1
    } else {
      process.stdout.write('[real-web-gate] dry-run: all prerequisites present; gate would run test:web with real env injection\n')
    }
  } else {
    try {
      runRealWebGate()
    } catch (error) {
      process.stderr.write(`[real-web-gate] failed\n${error instanceof Error ? error.message : String(error)}\n`)
      process.exitCode = 1
    }
  }
}