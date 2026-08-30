import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dshSource = resolve(process.env.DSH_SOURCE ?? resolve(root, '../deepseek-harness-pactflow-p0'))
const dshEntry = resolve(dshSource, 'apps/cli/src/bin.ts')
const packageVersion = JSON.parse(readFileSync(resolve(root, 'packages/dsh-pactflow/package.json'), 'utf8')).version
const tarball = resolve(root, `dist/dsh-pactflow-${packageVersion}.tgz`)
const testHome = mkdtempSync(join(tmpdir(), 'dsh-pactflow-profile-'))
const environment = { ...process.env, DSH_HOME: testHome }

try {
  accessSync(dshEntry, constants.R_OK)
  if (process.env.DSH_SKIP_BUILD !== '1') run('pnpm', ['run', 'build:lib'], dshSource)
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
  console.log('verify-profile: install, boot, remove, and clean boot passed')
} finally {
  rmSync(testHome, { recursive: true, force: true })
}

function run(command, args, cwd) {
  return execFileSync(command, args, {
    cwd,
    env: environment,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
}

function runDsh(args) {
  return run(process.execPath, ['--import', 'tsx/esm', dshEntry, ...args], dshSource)
}

function requireText(value, expected) {
  if (!value.includes(expected)) throw new Error(`profile output is missing ${JSON.stringify(expected)}`)
}

function rejectText(value, rejected) {
  if (value.includes(rejected)) throw new Error(`removed profile still contains ${JSON.stringify(rejected)}`)
}

async function bootWeb(expectPactFlow) {
  const child = spawn(process.execPath, [
    '--import', 'tsx/esm', dshEntry, '--profile', 'web', '--no-open', '--port', '0',
  ], {
    cwd: dshSource,
    env: environment,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const ready = new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => {
      rejectReady(new Error(`dsh web did not become ready: ${stderr.slice(-2000)}`))
    }, 30_000)
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)
      if (match?.[1] === undefined) return
      clearTimeout(timeout)
      resolveReady(match[1])
    })
    child.stderr.on('data', (chunk) => { stderr += String(chunk) })
    child.once('error', (error) => {
      clearTimeout(timeout)
      rejectReady(error)
    })
    child.once('exit', (code) => {
      if (stdout.includes('dsh web:')) return
      clearTimeout(timeout)
      rejectReady(new Error(`dsh web exited before readiness with ${String(code)}: ${stderr.slice(-2000)}`))
    })
  })
  try {
    const launchUrl = await ready
    await verifyPactFlowRemote(launchUrl, expectPactFlow)
  } finally {
    child.kill('SIGINT')
    await new Promise(resolveExit => child.once('exit', resolveExit))
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
