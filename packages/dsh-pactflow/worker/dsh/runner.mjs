import { spawn, execFileSync } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
const root = '/opt/pactflow-worker'
const manifest = JSON.parse(await readFile(`${root}/runtime-manifest.json`, 'utf8'))
const version = execFileSync('dsh', ['--version'], { encoding: 'utf8' }).trim()
if (version !== manifest.dshVersion || manifest.protocol !== process.env.PACTFLOW_INTERACTION_PROTOCOL) throw new Error('DSH worker runtime identity mismatch')
await writeFile('/tmp/harness-version.txt', version)
const base = new URL(process.env.OPENAI_BASE_URL ?? '')
if (base.username || base.password || base.search || base.hash) throw new Error('Worker base URL must not contain credentials or query parameters')
const model = process.env.OPENAI_MODEL ?? process.env.MODEL
if (!model || !process.env.PROMPT_PATH) throw new Error('Worker model or prompt file is missing')
const quote = JSON.stringify
const patch = `- id: llm-pi-ai
  config:
    providers:
      pactflow:
        displayName: PactFlow worker
        apiKeyEnv: OPENAI_API_KEY
        api: openai-completions
        baseURL: ${quote(base.toString())}
        models:
          - id: ${quote(model)}
- id: agent-default-model
  config:
    provider: pactflow
    model: ${quote(model)}
- insert:
    - id: pactflow-worker-interactions
      name: ${quote(`${root}/lib/worker/plugin.js`)}
      config:
        questionApi: ${quote(manifest.questionApi)}
- id: headless-runner
  inject: [headlessStartup, pactflowWorkerStartup]
  config:
    task: !!js ctx.pactflowWorkerStartup.task
`
const patchPath = '/tmp/pactflow-worker-overlay.yml'
await writeFile(patchPath, patch, { mode: 0o600 })
const seconds = Number(process.env.HARNESS_TIMEOUT_SECONDS ?? 3570)
if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('Invalid worker deadline')
const child = spawn('dsh', ['--profile', 'headless', '--patch', patchPath, '执行挂载的任务'], {
  stdio: ['ignore', 'pipe', 'pipe'], detached: true, env: { ...process.env, DSH_TELEMETRY_MODE: 'DISABLED' },
})
// Keep raw output in bounded process memory only, then redact known credentials
// before returning diagnostics. The independent bridge carries live questions.
let output = ''
const collect = chunk => { output = (output + chunk.toString('utf8')).slice(-1048576) }
child.stdout.on('data', collect); child.stderr.on('data', collect)
let hardKill
const killGroup = signal => { try { process.kill(-child.pid, signal) } catch (error) { if (error.code !== 'ESRCH') throw error } }
const stop = () => { killGroup('SIGTERM'); hardKill ??= setTimeout(() => killGroup('SIGKILL'), 10000) }
process.on('SIGTERM', stop); process.on('SIGINT', stop)
const deadline = setTimeout(stop, seconds * 1000)
const code = await new Promise(resolve => { child.once('exit', code => resolve(code ?? 1)); child.once('error', () => resolve(1)) })
clearTimeout(deadline); clearTimeout(hardKill)
for (const [key, value] of Object.entries(process.env)) if (/TOKEN|SECRET|PASSWORD|API_KEY/.test(key) && value && value.length >= 8) output = output.split(value).join('[凭证已隐藏]')
process.stdout.write(output.slice(-32768))
process.exitCode = code
