/**
 * Probe what each blocked acceptance task actually needs — by testing, not by
 * reading a list someone maintained.
 *
 * Written because the same mistake was made five times in one session: a
 * resource was missing, and that was generalised from "this command needs a
 * cluster" to "this whole section cannot be done", so tasks that never touched a
 * cluster went undone too. Each of the five turned out to need nothing that was
 * actually absent.
 *
 * The fix is not optimism. It is that "cannot run" is a claim needing evidence,
 * exactly like "passed" is — so this probes each prerequisite separately and
 * says which one is missing, rather than asserting a task is blocked.
 *
 *   node scripts/probe-acceptance-readiness.mjs
 */
import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))

const run = (command, args, timeoutMs = 15_000) => new Promise(resolve_ => {
  execFile(command, args, { timeout: timeoutMs, cwd: root }, error => resolve_(error === null))
})

const exists = async path => {
  try { await access(path, constants.F_OK); return true } catch { return false }
}

const envSet = name => {
  const value = process.env[name]
  return typeof value === 'string' && value !== ''
}

/**
 * One prerequisite: a name, how to test it, and what it unblocks. The check must
 * be a real probe — an env-var lookup, a binary lookup, a reachability test — and
 * never a hand-maintained verdict.
 */
const PREREQUISITES = [
  {
    id: 'node22',
    what: 'Node 22 on PATH',
    check: async () => run('node', ['-e', 'process.exit(process.versions.node.split(".")[0] >= 22 ? 0 : 1)']),
    fix: 'export PATH="$HOME/.local/node22/bin:$PATH"',
  },
  {
    id: 'dsh-source',
    what: 'DSH source checkout (sibling fork)',
    check: async () => await exists(join(root, '..', 'deepseek-harness-pactflow-p0')),
    fix: 'clone the fork beside this repo; this is what verify:profile:dev uses — NOT an installed release',
  },
  {
    id: 'docker',
    what: 'Docker daemon',
    check: async () => run('docker', ['info']),
    fix: 'install/start Docker',
  },
  {
    id: 'public-registry',
    what: 'public container registry reachable',
    check: async () => run('docker', ['pull', '--quiet', 'hello-world'], 90_000),
    fix: 'network access to Docker Hub / quay.io',
  },
  {
    id: 'artifact-store',
    what: 'S3-compatible endpoint armed (PACTFLOW_REAL_ARTIFACT_*)',
    check: async () => ['ENDPOINT', 'BUCKET', 'ACCESS_KEY', 'SECRET_KEY']
      .every(suffix => envSet(`PACTFLOW_REAL_ARTIFACT_${suffix}`)),
    fix: 'any local endpoint will do — see scripts/run-real-artifact.mjs; a cluster is NOT required',
  },
  {
    id: 'kubectl',
    what: 'kubectl binary',
    check: async () => run('kubectl', ['version', '--client']),
    fix: 'install kubectl',
  },
  {
    id: 'cluster',
    what: 'K3s cluster reachable',
    check: async () => run('kubectl', ['cluster-info'], 20_000),
    fix: 'point KUBECONFIG at a reachable cluster',
  },
  {
    id: 'harbor',
    what: 'worker image base layer pullable',
    check: async () => {
      const dockerfile = join(root, 'packages/dsh-pactflow/worker/dsh/Dockerfile')
      const { readFile } = await import('node:fs/promises')
      const text = await readFile(dockerfile, 'utf8')
      const image = /ARG BASE_IMAGE=(\S+)/.exec(text)?.[1]
      if (image === undefined) return false
      return run('docker', ['manifest', 'inspect', image], 30_000)
    },
    fix: 'network access to the Harbor holding the pinned base image',
  },
  {
    id: 'model-key',
    what: 'DEEPSEEK_API_KEY',
    check: async () => envSet('DEEPSEEK_API_KEY'),
    fix: 'export DEEPSEEK_API_KEY=…',
  },
  {
    id: 'gitea-token',
    what: 'PACTFLOW_GITEA_API_TOKEN',
    check: async () => envSet('PACTFLOW_GITEA_API_TOKEN'),
    fix: 'export PACTFLOW_GITEA_API_TOKEN=…',
  },
  {
    id: 'dsh-home',
    what: 'installed DSH home (~/.dsh)',
    check: async () => await exists(join(homedir(), '.dsh')),
    fix: 'install a DSH release; note that verify:profile:dev does NOT need this',
  },
]

/** What each still-open acceptance lane needs, keyed to the probes above. */
const LANES = [
  { lane: 'test:real-artifact', needs: ['node22', 'artifact-store'], unblocks: 'artifact-ref-handoff 的对象存储半边（已跑通）' },
  { lane: 'verify:profile:dev', needs: ['node22', 'dsh-source'], unblocks: 'agent-skill-composition 5.1（已跑通）' },
  { lane: 'test:real-worker', needs: ['node22', 'model-key'], unblocks: 'agent-skill-composition 3.1' },
  { lane: 'test:autopilot', needs: ['node22', 'model-key', 'gitea-token'], unblocks: 'agent-skill-composition 3.2' },
  { lane: 'test:worker-interactions', needs: ['node22', 'model-key', 'docker', 'harbor'], unblocks: 'agent-skill-composition 3.3' },
  { lane: 'build:worker-image', needs: ['docker', 'harbor'], unblocks: 'dsh-harness-telemetry 5.2' },
  { lane: 'dsh-harness-telemetry spike 0.1/0.2', needs: ['docker', 'harbor', 'model-key'], unblocks: '0.3 → 2.1 / 2.3 → 6.2' },
  { lane: 'test:real-k3s', needs: ['node22', 'kubectl', 'cluster', 'harbor'], unblocks: 'artifact-ref-handoff 5.1 / 7.1；dsh-harness-telemetry 7.1 / 7.2' },
]

const results = new Map()
for (const prerequisite of PREREQUISITES) {
  let ok = false
  try { ok = await prerequisite.check() === true } catch { ok = false }
  results.set(prerequisite.id, ok)
  process.stdout.write(`${ok ? '  ok' : 'MISS'}  ${prerequisite.what}\n`)
  if (!ok) process.stdout.write(`        → ${prerequisite.fix}\n`)
}

process.stdout.write('\n')
let ready = 0
for (const { lane, needs, unblocks } of LANES) {
  const missing = needs.filter(id => results.get(id) !== true)
  if (missing.length === 0) {
    ready += 1
    process.stdout.write(`READY  ${lane}\n         ${unblocks}\n`)
    continue
  }
  process.stdout.write(`BLOCK  ${lane}\n         缺：${missing.join(', ')}\n         ${unblocks}\n`)
}
process.stdout.write(`\n${String(ready)}/${String(LANES.length)} 条验收通道当前可跑。\n`)
process.stdout.write('每条 BLOCK 只列它自己缺的东西——不要由此推断同一 change 的其它任务也做不了。\n')
