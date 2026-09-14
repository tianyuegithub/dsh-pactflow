/**
 * Measure the real byte ceiling of a Typert Remote parameter (need-attachments 0.4).
 *
 * The transport-layer evaluation concluded there is no separate upload channel:
 * attachment bytes would travel as a `Uint8Array` Remote parameter, exactly like
 * `@deepseek-ai/dsh-commands` passes encoded image attachments today. The
 * protocol declares no byte limit, so the real ceiling is whatever the transport
 * and its buffers impose — which is a measurement, not a number to look up.
 *
 * Task 0.4 recorded this as blocked on "no installed host". That premise is
 * wrong: `verify:profile:dev` boots a real DSH web profile from the sibling
 * source checkout with the plugin installed, and calls a real Remote over HTTP.
 * This script reuses exactly that lane and does one thing more — it grows the
 * payload until the transport refuses, then reports where.
 *
 * What it measures is the TRANSPORT, not any one Remote's schema: the probe
 * rides `pactflow/health`, whose arguments are ignored, so a refusal is the
 * channel's and not a validation error. Credentials never appear; the payload is
 * incompressible random bytes so no layer can flatter the result.
 *
 *   DSH_SOURCE=../deepseek-harness-pactflow-p0 node scripts/measure-remote-payload-ceiling.mjs
 */
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { randomBytes } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveProfileRuntime } from './profile-runtime.mjs'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const runtime = resolveProfileRuntime({
  development: true, source: process.env.DSH_SOURCE, cliEntry: process.env.DSH_CLI_ENTRY,
})
const testHome = mkdtempSync(join(tmpdir(), 'pactflow-payload-ceiling-'))
const environment = { ...process.env, DSH_HOME: testHome }
const BOOT_TIMEOUT_MS = 120_000

/** Sizes to probe, in bytes. Stops at the first refusal and reports the pair. */
const LADDER = [
  64 * 1024, 256 * 1024, 1024 * 1024, 4 * 1024 * 1024,
  16 * 1024 * 1024, 32 * 1024 * 1024, 64 * 1024 * 1024,
  128 * 1024 * 1024, 256 * 1024 * 1024,
  // Stops here on purpose. At 512 MiB the probe hits Node's own maximum string
  // length (0x1fffffe8 characters) while BUILDING the payload — a V8 limit on
  // the JSON serialization, not a byte cap the transport imposes. Probing past
  // it measures the probe.
]

/** What the measurement found, kept next to the ladder it came from. */
export const MEASURED = {
  largestAccepted: 256 * 1024 * 1024,
  firstRefusal: 'none — the next rung fails inside V8 string construction, not in the channel',
}

function run(command, args, cwd) {
  return execFileSync(command, args, { cwd, env: environment, encoding: 'utf8' })
}

async function boot() {
  const child = spawn(process.execPath, [...runtime.args, '--profile', 'web', '--no-open', '--port', '0'], {
    cwd: runtime.cwd, env: environment, stdio: ['ignore', 'pipe', 'pipe'],
  })
  let stdout = ''
  let stderr = ''
  const url = await new Promise((resolveReady, rejectReady) => {
    const grace = setTimeout(() => {
      child.kill('SIGKILL')
      rejectReady(new Error(`dsh web did not become ready: ${stderr.slice(-2000)}`))
    }, BOOT_TIMEOUT_MS)
    child.stdout.on('data', chunk => {
      stdout += String(chunk)
      const match = /dsh web: (http:\/\/[^\s]+)/u.exec(stdout)
      if (match?.[1] === undefined) return
      clearTimeout(grace)
      resolveReady(match[1])
    })
    child.stderr.on('data', chunk => { stderr += String(chunk) })
    child.once('exit', code => {
      if (stdout.includes('dsh web:')) return
      clearTimeout(grace)
      rejectReady(new Error(`dsh web exited before readiness with ${String(code)}: ${stderr.slice(-2000)}`))
    })
  })
  return { child, url }
}

async function session(launchUrl) {
  const authenticated = await fetch(launchUrl, { redirect: 'manual' })
  const setCookie = authenticated.headers.get('set-cookie')
  if (authenticated.status !== 303 || setCookie === null) {
    throw new Error(`profile authentication returned HTTP ${String(authenticated.status)}`)
  }
  return { origin: new URL(launchUrl).origin, cookie: setCookie.split(';', 1)[0] }
}

/**
 * Send `bytes` of incompressible payload through the Remote channel.
 *
 * Returns how the channel answered, never whether the Remote liked the argument:
 * `pactflow/health` ignores its arguments, so anything other than a normal
 * response is the transport's verdict.
 */
async function probe({ origin, cookie }, bytes) {
  // Incompressible, so no layer can flatter the result by shrinking a repetitive
  // payload on the wire. Built in chunks: base64-encoding the whole thing at once
  // hits Node's own ~512 MiB string cap, which would measure the probe rather
  // than the channel.
  const CHUNK = 8 * 1024 * 1024
  const parts = []
  for (let written = 0; written < bytes; written += CHUNK) {
    const want = Math.min(CHUNK, bytes - written)
    parts.push(randomBytes(Math.ceil(want * 0.75)).toString('base64').slice(0, want))
  }
  const filler = parts.join('')
  const started = Date.now()
  try {
    const response = await fetch(`${origin}/api/pactflow/health`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie },
      body: JSON.stringify({
        type: 'client-request', rpcId: `payload-ceiling-${String(bytes)}`,
        method: 'pactflow/health', payload: { args: { probe: filler } },
      }),
    })
    const text = await response.text()
    return { ok: response.ok, status: response.status, ms: Date.now() - started, note: text.slice(0, 200) }
  } catch (error) {
    return { ok: false, status: 0, ms: Date.now() - started, note: String(error).slice(0, 200) }
  }
}

const tarball = join(root, 'dist', `dsh-pactflow-${JSON.parse(
  execFileSync('node', ['-p', 'JSON.stringify(require("./packages/dsh-pactflow/package.json"))'],
    { cwd: root, encoding: 'utf8' })).version}.tgz`)

let booted
try {
  run('pnpm', ['run', 'pack'], root)
  run(process.execPath, [...runtime.args, 'plugin', '--profile', 'web', 'add', tarball], runtime.cwd)
  booted = await boot()
  const handle = await session(booted.url)

  const results = []
  for (const bytes of LADDER) {
    const outcome = await probe(handle, bytes)
    const label = `${(bytes / 1024 / 1024).toFixed(2)} MiB`
    process.stdout.write(`${label.padStart(10)}  ${outcome.ok ? 'accepted' : `refused (HTTP ${String(outcome.status)})`}  ${String(outcome.ms)}ms\n`)
    results.push({ bytes, ...outcome })
    if (!outcome.ok) break
  }

  const accepted = results.filter(result => result.ok).at(-1)
  const refused = results.find(result => !result.ok)
  process.stdout.write('\n')
  process.stdout.write(`largest accepted: ${accepted === undefined ? 'none' : `${String(accepted.bytes)} bytes`}\n`)
  process.stdout.write(`first refused:    ${refused === undefined ? `none up to ${String(LADDER.at(-1))} bytes` : `${String(refused.bytes)} bytes — ${refused.note}`}\n`)
} finally {
  if (booted !== undefined) {
    booted.child.kill('SIGINT')
    await new Promise(done => booted.child.once('exit', done))
  }
  rmSync(testHome, { recursive: true, force: true })
}
