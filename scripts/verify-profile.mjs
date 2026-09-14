import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfileRuntime } from './profile-runtime.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = resolveProfileRuntime({ development: process.argv.includes('--development'),
  source: process.env.DSH_SOURCE, cliEntry: process.env.DSH_CLI_ENTRY })
const dshSource = runtime.cwd
const dshEntry = runtime.entry
const packageVersion = JSON.parse(readFileSync(resolve(root, 'packages/dsh-pactflow/package.json'), 'utf8')).version
const tarball = resolve(root, `dist/dsh-pactflow-${packageVersion}.tgz`)
const testHome = mkdtempSync(join(tmpdir(), 'dsh-pactflow-profile-'))
const environment = { ...process.env, DSH_HOME: testHome }

// Bound every child process: no verification step may wait forever.
// Declared BEFORE the top-level try below: these are read by the first runDsh()
// call inside it. While they sat after the try, the module's temporal dead zone
// threw a ReferenceError, so this gate never actually ran.
const COMMAND_TIMEOUT_MS = 120_000
const BOOT_TIMEOUT_MS = 120_000

try {
  accessSync(dshEntry, constants.R_OK)
  if (runtime.kind === 'development' && process.env.DSH_SKIP_BUILD !== '1') run('pnpm', ['run', 'build:lib'], dshSource)
  const runtimeVersion = runDsh(['--version']).trim()
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(runtimeVersion)) throw new Error('DSH CLI returned an invalid version')
  console.log(`verify-profile runtime: ${runtime.kind} ${runtimeVersion}${runtime.kind === 'development' ? ' (not release evidence)' : ''}`)
  run('pnpm', ['run', 'pack'], root)
  runDsh(['plugin', '--profile', 'web', 'add', tarball])

  const installed = runDsh(['--profile', 'web', '--dump-config'])
  requireText(installed, '# == dsh-pactflow')
  requireText(installed, 'pactflowPresetRoot')
  requireText(installed, 'id: pactflow')
  requireText(installed, 'name: dsh-pactflow')
  // The preset's skill rows live in its own agent.cordis.yml under the package-owned
  // preset root, so they have no lifecycle of their own — they are reachable exactly
  // while that root is. Assert the root really does carry them while installed, so
  // the residue check after removal is about something that was actually there.
  requireSkillCatalog(testHome, true)
  await bootWeb(true)

  // Re-adding the same complete artifact exercises the profile upgrade path:
  // pnpm may replace or retain it, but Bundle order and activation must stay singular.
  runDsh(['plugin', '--profile', 'web', 'add', tarball])
  const upgraded = runDsh(['--profile', 'web', '--dump-config'])
  requireText(upgraded, '# == dsh-pactflow')
  if (upgraded.split('# == dsh-pactflow').length !== 2) {
    throw new Error('profile upgrade duplicated the dsh-pactflow Bundle layer')
  }
  await bootWeb(true)

  runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-pactflow'])
  const removed = runDsh(['--profile', 'web', '--dump-config'])
  rejectText(removed, 'dsh-pactflow')
  rejectText(removed, 'pactflowPresetRoot')
  // No preset root means no skill directory to mount: the rows cannot outlive the
  // Bundle that carried them. Checked explicitly rather than argued, because
  // "it has no separate lifecycle" is precisely the kind of claim that stops
  // being true the moment someone gives it one.
  requireSkillCatalog(testHome, false)
  await bootWeb(false)
  console.log(`verify-profile (${runtime.kind}): install, boot, remove, and clean boot passed`)
} finally {
  rmSync(testHome, { recursive: true, force: true })
}

// Bound every child process: no verification step may wait forever.
// (Declared above the top-level try — see note there.)

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: COMMAND_TIMEOUT_MS,
    killSignal: 'SIGKILL',
  })
}

function runDsh(args) {
  return run(process.execPath, [...runtime.args, ...args], dshSource)
}

function requireText(value, expected) {
  if (!value.includes(expected)) throw new Error(`profile output is missing ${JSON.stringify(expected)}`)
}

/**
 * Whether the installed Bundle still carries the preset's skill catalog on disk.
 *
 * The preset root is resolved at run time (`cordis.patch.yml` injects it as a
 * service), so it is not a path in `--dump-config`. The rows and the skill
 * directories are therefore checked where they actually live: inside the package
 * as installed under this run's DSH_HOME.
 */
function findPresetRoot(home) {
  const stack = [home]
  while (stack.length > 0) {
    const current = stack.pop()
    let entries
    try { entries = readdirSync(current, { withFileTypes: true }) } catch { continue }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      const path = join(current, entry.name)
      if (entry.name === 'pactflow' && existsSync(join(path, 'agent.cordis.yml'))) return path
      stack.push(path)
    }
  }
  return undefined
}

function requireSkillCatalog(home, expected) {
  const preset = findPresetRoot(home)
  if (!expected) {
    if (preset !== undefined) throw new Error(`removed Bundle left a PactFlow preset behind at ${preset}`)
    return
  }
  if (preset === undefined) throw new Error('installed Bundle ships no PactFlow preset directory')
  const agent = readFileSync(join(preset, 'agent.cordis.yml'), 'utf8')
  for (const row of ['dsh-skill-filesystem', 'dsh-tool-skill']) {
    if (!agent.includes(row)) throw new Error(`installed preset is missing the ${row} row`)
  }
  const skills = join(preset, 'skills')
  if (!existsSync(skills)) throw new Error(`installed preset has no skills directory at ${skills}`)
  const count = readdirSync(skills, { withFileTypes: true }).filter(entry => entry.isDirectory()).length
  if (count === 0) throw new Error('installed preset ships an empty skills directory')
}

function rejectText(value, rejected) {
  if (value.includes(rejected)) throw new Error(`removed profile still contains ${JSON.stringify(rejected)}`)
}

async function bootWeb(expectPactFlow) {
  const child = spawn(process.execPath, [
    ...runtime.args, '--profile', 'web', '--no-open', '--port', '0',
  ], {
    cwd: dshSource,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`dsh web did not become ready within ${BOOT_TIMEOUT_MS}ms: ${stderr.slice(-2000)}`))
    }, 30_000)
    // Overall grace period: even if readiness never resolves, the boot must not
    // wait forever.
    const grace = setTimeout(() => {
      child.kill('SIGKILL')
      rejectReady(new Error(`dsh web did not become ready within ${BOOT_TIMEOUT_MS}ms: ${stderr.slice(-2000)}`))
    }, BOOT_TIMEOUT_MS)
    const clear = () => { clearTimeout(timeout); clearTimeout(grace) }
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)
      if (match?.[1] === undefined) return
      clear()
      resolveReady(match[1])
    })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', (error) => {
      clear()
      rejectReady(error)
    })
    child.once('exit', (code) => {
      if (stdout.includes('dsh web:')) return
      clear()
      rejectReady(new Error(`dsh web exited before readiness with ${String(code)}: ${stderr.slice(-2000)}`))
    })
  })
  try {
    const launchUrl = await ready
    await verifyPactFlowRemote(launchUrl, expectPactFlow)
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = new Promise(resolveExit => child.once('exit', resolveExit))
      child.kill('SIGINT')
      await exited
    }
  }
}

async function verifyPactFlowRemote(launchUrl, expected) {
  const authenticated = await fetch(launchUrl, { redirect: 'manual' })
  const setCookie = authenticated.headers.get('set-cookie')
  if (authenticated.status !== 303 || setCookie === null) {
    throw new Error(`profile authentication returned HTTP ${String(authenticated.status)}`)
  }
  const response = await fetch(`${new URL(launchUrl).origin}/api/pactflow/health`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: setCookie.split(';', 1)[0] },
    body: JSON.stringify({
      type: 'client-request',
      rpcId: 'dsh-pactflow-profile-health',
      method: 'pactflow/health',
      payload: { args: {} },
    }),
  })
  if (!expected) {
    if (response.status !== 404) {
      throw new Error(`removed profile still serves pactflow/health over HTTP ${String(response.status)}`)
    }
    return
  }
  if (!response.ok) {
    throw new Error(`installed profile pactflow/health returned HTTP ${String(response.status)}`)
  }
  const result = await response.json()
  if (result?.result?.ok !== true || result.result.value?.plugin !== 'dsh-pactflow'
    || result.result.value?.mode !== 'pactflow') {
    throw new Error('installed profile pactflow/health returned an invalid Remote result')
  }
}
