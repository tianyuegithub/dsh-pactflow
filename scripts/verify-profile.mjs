import { execFileSync, spawn } from 'node:child_process'
import { accessSync, constants, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const dshSource = resolve(process.env.DSH_SOURCE ?? resolve(root, '../deepseek-harness-pactflow-p0'))
const dshEntry = resolve(dshSource, 'apps/cli/src/bin.ts')
const tarball = resolve(root, 'dist/dsh-pactflow-0.1.0.tgz')
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
  requireText(installed, '/lib/index.js')
  await bootWeb()

  runDsh(['plugin', '--profile', 'web', 'remove', 'dsh-pactflow'])
  const removed = runDsh(['--profile', 'web', '--dump-config'])
  rejectText(removed, 'dsh-pactflow')
  rejectText(removed, 'pactflowPresetRoot')
  await bootWeb()
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

async function bootWeb() {
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
      if (!stdout.includes('dsh web:')) return
      clearTimeout(timeout)
      resolveReady()
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
    await ready
  } finally {
    child.kill('SIGINT')
    await new Promise(resolveExit => child.once('exit', resolveExit))
  }
}
