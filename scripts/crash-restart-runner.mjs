/**
 * Real multi-process crash-restart orchestrator (authorized B-class run).
 *
 * Runs the whole scenario out-of-process and prints ONE JSON verdict line to stdout
 * (progress goes to stderr):
 *   1. boot a real Host subprocess that dispatches a real K3s Job;
 *   2. SIGKILL that host (abrupt death, no graceful flush);
 *   3. confirm the Job it left behind is still observable on the cluster;
 *   4. boot a FRESH host against the SAME DSH_HOME and read what recovery surfaced;
 *   5. clean up the Job/ConfigMap/branch it created.
 *
 * The test file only spawns this script with a literal argv, so no dynamic value
 * ever sits beside a CLI flag.
 */
import { execFileSync, spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const repoRoot = resolve(import.meta.dirname, '..')
const driver = join(repoRoot, 'scripts', 'crash-restart-driver.mjs')
const OBJECT_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/

const log = message => process.stderr.write(`[crash-restart] ${message}\n`)
const names = value => { if (!OBJECT_NAME.test(String(value))) throw new Error(`unsafe object name: ${String(value)}`); return String(value) }
// A git ref legitimately contains `/`, which OBJECT_NAME (a Kubernetes object-name
// validator) rejects. Using `names()` here threw before the delete, and the old
// `catch {}` hid it — so the task branch was never cleaned up. The argv element is
// passed literally with `--`, so validating the ref shape is enough.
const REF_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/
const refName = value => {
  const name = String(value)
  if (!REF_NAME.test(name) || name.includes('..') || name.endsWith('.') || name.endsWith('/') || name.endsWith('.lock')) {
    throw new Error(`unsafe ref name: ${name}`)
  }
  return name
}

function kubectlDelete(kind, name) {
  // Foreground cascade so dependent Pods are gone before this returns; Background
  // would leave terminating Pods behind after the Job object disappears.
  execFileSync('kubectl',
    ['-n', 'pactflow', 'delete', kind, '--ignore-not-found=true', '--wait=true', '--cascade=foreground', '--', names(name)],
    { stdio: 'ignore' })
  // A SIGKILLed host can leave Pods whose Job deletion does not fully reclaim them;
  // delete any Pod still labelled for this Job by its label selector.
  if (kind === 'job') {
    let listed = ''
    try {
      listed = execFileSync('kubectl',
        ['-n', 'pactflow', 'get', 'pods', '-l', `job-name=${names(name)}`, '-o', 'name'],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    } catch { return }
    for (const entry of listed.split('\n').map(line => line.trim()).filter(Boolean)) {
      const pod = entry.replace(/^pod\//, '')
      try {
        execFileSync('kubectl', ['-n', 'pactflow', 'delete', 'pod', '--ignore-not-found=true', '--wait=false', '--', names(pod)], { stdio: 'ignore' })
      } catch { /* best effort */ }
    }
  }
}
function kubectlExists(kind, name) {
  try { execFileSync('kubectl', ['-n', 'pactflow', 'get', kind, '-o', 'name', '--', names(name)], { stdio: 'ignore' }); return true } catch { return false }
}
function refAbsent(workspace, name, environment) {
  return execFileSync('git', ['-C', workspace, 'ls-remote', '--heads', 'origin', `refs/heads/${name}`],
    { encoding: 'utf8', env: environment }).trim() === ''
}

/**
 * Delete the task branch and prove it STAYS deleted. The crashed Job's container may
 * still be finishing its push, so an absent reading must be confirmed again after a
 * settle gap; otherwise a late push re-creates the ref after we report success and
 * quietly pollutes the acceptance repository. Returns whether it ended absent.
 */
function gitDeleteBranch(workspace, branch) {
  const name = refName(branch)
  const environment = { ...process.env, GIT_TERMINAL_PROMPT: '0' }
  for (let attempt = 0; attempt < 6; attempt += 1) {
    try { execFileSync('git', ['-C', workspace, 'push', 'origin', '--delete', '--', name], { stdio: 'ignore', env: environment }) } catch { /* retried below */ }
    if (refAbsent(workspace, name, environment)) {
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 2_000)
      if (refAbsent(workspace, name, environment)) return true
      continue
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000)
  }
  log(`WARNING: could not delete remote branch ${name} after retries; delete it manually`)
  return false
}
function waitForFile(path, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolveWait, reject) => {
    const tick = () => {
      if (existsSync(path)) return resolveWait()
      if (Date.now() > deadline) return reject(new Error(`timed out waiting for ${path}`))
      setTimeout(tick, 500)
    }
    tick()
  })
}

const root = await mkdtemp(join(tmpdir(), 'pactflow-crash-orchestrator-'))
const workspace = join(root, 'workspace')
const dshHome = join(root, '.dsh')
const statePath = join(root, 'crash-state.json')
const resumePath = join(root, 'resume-state.json')
let crashed
let host

// Defaults for the acceptance environment; overridable by env for other clusters.
const DEFAULTS = {
  repo: 'ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git',
  image: '192.168.31.200:8080/datavdl/pactflow-worker@sha256:3342bb490d91ff8e39255e4b0e477967f4ccd9c7fb4380a1ec13cc654debdcea',
  modelSecret: 'pactflow-legacy-codex-deepseek-v4flash',
  gitSecret: 'pactflow-git-zeromai-demo-v2',
}

const env = {
  ...process.env,
  DSH_HOME: dshHome,
  PACTFLOW_CRASH_ROOT: join(dshHome, 'sessions'),
  PACTFLOW_CRASH_STATE: statePath,
  PACTFLOW_CRASH_WORKSPACE: workspace,
  PACTFLOW_CRASH_REPO: process.env.PACTFLOW_CRASH_REPO ?? DEFAULTS.repo,
  PACTFLOW_CRASH_IMAGE: process.env.PACTFLOW_CRASH_IMAGE ?? DEFAULTS.image,
  PACTFLOW_CRASH_MODEL_SECRET: process.env.PACTFLOW_CRASH_MODEL_SECRET ?? DEFAULTS.modelSecret,
  PACTFLOW_CRASH_GIT_SECRET: process.env.PACTFLOW_CRASH_GIT_SECRET ?? DEFAULTS.gitSecret,
  GIT_TERMINAL_PROMPT: '0',
}

let verdict
let branchCleaned = true
try {
  const repository = env.PACTFLOW_CRASH_REPO
  log('cloning acceptance repository')
  execFileSync('git', ['clone', '--branch', 'main', repository, workspace], { stdio: 'ignore', env })
  execFileSync('git', ['-C', workspace, 'config', 'user.name', 'PactFlow Host'])
  execFileSync('git', ['-C', workspace, 'config', 'user.email', 'pactflow-host@example.invalid'])

  log('booting host subprocess and dispatching a real K3s Job')
  host = spawn(process.execPath, [driver, 'start'], { env, stdio: ['ignore', 'ignore', 'inherit'] })
  await waitForFile(statePath, 300_000)
  crashed = JSON.parse(readFileSync(statePath, 'utf8'))

  log(`SIGKILL host pid ${crashed.pid}`)
  process.kill(crashed.pid, 'SIGKILL')
  await new Promise(res => setTimeout(res, 2_000))
  let alive = true
  try { process.kill(crashed.pid, 0) } catch { alive = false }

  const jobSurvived = kubectlExists('job', crashed.jobName)
  log(`job ${crashed.jobName} observable after crash: ${jobSurvived}`)

  log('booting a fresh host against the same DSH_HOME')
  execFileSync(process.execPath, [driver, 'resume'],
    { env: { ...env, PACTFLOW_CRASH_STATE: resumePath }, stdio: ['ignore', 'inherit', 'inherit'] })
  const resumed = JSON.parse(readFileSync(resumePath, 'utf8'))
  const recovered = (resumed.nonTerminal ?? []).find(run => run.id === crashed.runId)

  verdict = {
    ok: true,
    hostKilled: alive === false,
    jobObservableAfterCrash: jobSurvived,
    projectPresent: resumed.projectPresent === true,
    crashedState: crashed.state,
    runId: crashed.runId,
    jobNameMatched: recovered?.jobName === crashed.jobName,
    branchMatched: recovered?.branch === crashed.branch,
    recovered: recovered !== undefined,
  }
} catch (error) {
  verdict = { ok: false, error: String(error?.message ?? error) }
} finally {
  try { if (crashed?.jobName !== undefined) kubectlDelete('job', crashed.jobName) } catch { /* best effort */ }
  try { if (crashed?.configMapName !== undefined) kubectlDelete('configmap', crashed.configMapName) } catch { /* best effort */ }
  // Settle before touching the remote: the terminated Worker may still be finishing
  // its push, and a late push would re-create the branch right after we delete it.
  // Deleting the Job (foreground cascade) stops it, but give the push long enough to
  // land first so the delete below sticks.
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 5_000)
  try {
    if (crashed?.branch !== undefined) branchCleaned = gitDeleteBranch(workspace, crashed.branch)
  } catch { branchCleaned = false }
  try { host?.kill('SIGKILL') } catch { /* already gone */ }
  await rm(root, { recursive: true, force: true }).catch(() => {})
}

// A run that leaves its remote branch behind is not a clean run: surface it instead
// of reporting success and quietly polluting the acceptance repository.
if (verdict?.ok === true && !branchCleaned) {
  verdict = { ...verdict, ok: false, error: 'remote task branch was not cleaned up' }
}

process.stdout.write(`${JSON.stringify(verdict)}\n`)
if (verdict.ok !== true) process.exitCode = 1
