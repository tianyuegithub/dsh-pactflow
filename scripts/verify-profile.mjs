import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
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
  await bootWeb(false)
  console.log(`verify-profile (${runtime.kind}): install, boot, remove, and clean boot passed`)
} finally {
  rmSync(testHome, { recursive: true, force: true })
}

// Bound every child process: no verification step may wait forever.
const COMMAND_TIMEOUT_MS = 120_000
const BOOT_TIMEOUT_MS = 120_000

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
