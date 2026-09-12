import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { assertReleaseWebReport } from './release-web-report.mjs'
import { preserveReport } from './evidence-store.mjs'
import { resolveCredential } from './credential-refs.mjs'

const root = resolve(import.meta.dirname, '..')

// The credential refs the real suites read from their own process environment
// (never argv). The gate must inject these into the child env it launches:
// checking that a ref merely EXISTS in the store is not enough — the suites
// would still fail at `beforeAll` with "requires <NAME>", which vitest reports
// as a skipped test and thereby breaks the zero-skip pass condition.
const REQUIRED_CREDENTIALS = ['DEEPSEEK_API_KEY', 'PACTFLOW_GITEA_API_TOKEN']

/** The credential values to hand the child process, resolved env-first then store. */
export function gateCredentialEnvironment() {
  const environment = {}
  for (const name of REQUIRED_CREDENTIALS) {
    const value = resolveCredential(name)
    if (value !== undefined) environment[name] = value
  }
  return environment
}

function kubectlReachable() {
  try {
    execFileSync('kubectl', ['get', 'namespace', 'pactflow', '-o', 'name'], { stdio: 'pipe', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

/**
 * 网页零跳过收口前置检查：逐项列出**外部**前置（真实世界是否可用），任一缺失即拒绝（不触碰真实环境）。
 *
 * These are only the things the gate cannot supply itself: a reachable cluster
 * and the real-suite credentials. The suite switches and record mode ARE
 * supplied by {@link realWebGateEnvironment}, so they are deliberately NOT
 * prerequisites here — requiring the caller to arm what the gate arms itself
 * would be a false rejection. The arming set's completeness is instead enforced
 * offline by `tests/real-web-gate-prerequisites.spec.ts`, which derives the
 * required switches from the suites themselves.
 */
export function checkWebGatePrerequisites() {
  const missing = []
  if (!/^.+@sha256:[a-f0-9]{64}$/.test(process.env.PACTFLOW_RELAY_IMAGE ?? '')) missing.push('PACTFLOW_RELAY_IMAGE immutable acceptance image')
  if (!kubectlReachable()) missing.push('DSH_K3S_E2E environment (kubectl cannot reach namespace pactflow)')
  if (resolveCredential('PACTFLOW_GITEA_API_TOKEN') === undefined) missing.push('PACTFLOW_GITEA_API_TOKEN credential ref')
  if (resolveCredential('DEEPSEEK_API_KEY') === undefined) missing.push('DEEPSEEK_API_KEY credential ref (record-mode model suites)')
  return missing
}

/**
 * The env every zero-skip run needs, in one place: a second entry point
 * (`check:release`) reuses it so both gates arm the suites identically. Modelled
 * as a function because resolving credential refs reads the store.
 */
export function realWebGateEnvironment() {
  return Object.freeze({
    DSH_K3S_E2E: '1',
    DSH_GITEA_E2E: '1',
    DSH_SNAPSHOT: 'record',
    DSH_REAL_CRASH: '1',
    DSH_REAL_APPROVAL: '1',
    DSH_AUTOPILOT_E2E: '1',
    DSH_WORKER_INTERACTIONS_E2E: '1',
    ...gateCredentialEnvironment(),
  })
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
      env: { ...process.env, ...realWebGateEnvironment() },
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