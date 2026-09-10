import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { buildTtlProbeJob, evaluateTtlRecycle, evaluateZeroProof } from './k3s-batch-stages.mjs'

const root = resolve(import.meta.dirname, '..')
const SUITES = [
  'packages/dsh-pactflow/e2e/pactflow-k3s-worker.e2e.spec.ts',
  'packages/dsh-pactflow/e2e/pactflow-harness-probes.e2e.spec.ts',
  'packages/dsh-pactflow/e2e/pactflow-k3s-harness-tasks.e2e.spec.ts',
]

function kubectlReachable() {
  try {
    execFileSync('kubectl', ['get', 'namespace', 'pactflow', '-o', 'name'], { stdio: 'pipe', timeout: 10_000 })
    return true
  } catch {
    return false
  }
}

function runStage(name, fn) {
  process.stdout.write(`[k3s-batch] stage: ${name}\n`)
  try {
    fn()
    process.stdout.write(`[k3s-batch] stage ${name}: ok\n`)
  } catch (error) {
    process.stderr.write(`[k3s-batch] stage ${name}: failed\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
    throw error
  }
}

/**
 * TTL 双证阶段：存在性断言 + 短窗真实回收观察。
 *
 * The judgement logic lives in `k3s-batch-stages.mjs` (unit-tested). Driving it
 * against a real cluster is a B-class operation, so this stage fails closed unless
 * explicitly armed with PACTFLOW_K3S_TTL_PROBE=1 — it never pretends TTL passed.
 */
export function ttlStage() {
  if (process.env.PACTFLOW_K3S_TTL_PROBE !== '1') {
    throw new Error('ttlStage: real-cluster TTL probe is a B-class operation; set PACTFLOW_K3S_TTL_PROBE=1 with a reachable cluster')
  }
  const name = `pf-ttl-probe-${Date.now().toString(36)}`
  const namespace = 'pactflow'
  const ttlSeconds = Number(process.env.PACTFLOW_K3S_TTL_SECONDS ?? '60')
  const job = buildTtlProbeJob({
    name, namespace, image: process.env.PACTFLOW_K3S_TTL_IMAGE ?? 'busybox:1.36', ttlSeconds,
  })
  kubectl(['apply', '-f', '-'], JSON.stringify(job))
  try {
    // ttl-after-finished starts only after the Job reaches Complete.
    kubectl(['wait', '--for=condition=complete', `job/${name}`, '-n', namespace, '--timeout=300s'])
    const deadline = Date.now() + 300_000
    for (;;) {
      // Only a genuine NotFound proves the Job is gone; any other failure (transient
      // API error, auth) must NOT be mistaken for a successful TTL recycle.
      const observed = observeJobAbsence(name, namespace)
      if (observed.absent && evaluateTtlRecycle({ exists: false, finished: true }).recycled) {
        process.stdout.write(`[k3s-batch] ttl: observed ttl-after-finished recycle of ${name}\n`)
        return
      }
      if (!observed.absent && observed.error !== undefined) {
        process.stdout.write(`[k3s-batch] ttl: probe read error (retrying): ${observed.error}\n`)
      }
      if (Date.now() >= deadline) {
        throw new Error(`ttlStage: probe Job "${name}" was not recycled within the observation window`)
      }
      sleepSync(5_000)
    }
  } finally {
    // Never leave the probe behind even if TTL did not fire.
    kubectlSucceeds(['delete', 'job', name, '-n', namespace, '--ignore-not-found=true'])
  }
}

/** 归零自证阶段：本批资源 UID 前置精确核对并输出 ZeroProof（真实集群属 B 类）。 */
export function zeroProofStage() {
  if (process.env.PACTFLOW_K3S_ZERO_PROOF !== '1') {
    throw new Error('zeroProofStage: real-cluster zero-proof is a B-class operation; set PACTFLOW_K3S_ZERO_PROOF=1 with a reachable cluster')
  }
  const tracked = JSON.parse(process.env.PACTFLOW_K3S_TRACKED ?? '[]')
  const present = []
  for (const resource of tracked) {
    const found = readIfPresent(resource)
    if (found !== undefined) present.push(found)
  }
  const result = evaluateZeroProof({ tracked, present, unexplained: [] })
  process.stdout.write(`[k3s-batch] zero-proof: ${JSON.stringify(result)}\n`)
  if (!result.zero) throw new Error(`zeroProofStage: ${String(result.remaining.length)} tracked resource(s) still present`)
}

function kubectl(args, input) {
  return execFileSync('kubectl', args, {
    encoding: 'utf8',
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
    ...(input === undefined ? {} : { input }),
  })
}

function kubectlSucceeds(args) {
  try { kubectl(args); return true } catch { return false }
}

/**
 * Observe whether a Job is absent. Distinguishes a real NotFound (gone) from any
 * other error, so a transient API failure is never reported as a successful recycle.
 */
function observeJobAbsence(name, namespace) {
  try {
    kubectl(['get', 'job', name, '-n', namespace, '-o', 'name'])
    return { absent: false }
  } catch (error) {
    const message = `${error?.stderr ?? ''}${error?.message ?? ''}`
    if (/\(NotFound\)|not found/i.test(message)) return { absent: true }
    return { absent: false, error: message.trim().slice(0, 200) || 'unknown kubectl error' }
  }
}

function readIfPresent(resource) {
  try {
    const parsed = JSON.parse(kubectl(['get', resource.kind, resource.name, '-n', 'pactflow', '-o', 'json']))
    return { kind: resource.kind, name: resource.name, uid: parsed?.metadata?.uid }
  } catch { return undefined }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
}

function runSuites() {
  execFileSync('pnpm', ['exec', 'vitest', 'run', '--config', 'vitest.e2e.config.ts', ...SUITES], {
    cwd: root,
    env: { ...process.env, DSH_K3S_E2E: '1' },
    stdio: 'inherit',
  })
}

function main() {
  const dryRun = process.argv.includes('--dry-run')
  if (!kubectlReachable()) {
    process.stderr.write('[k3s-batch] abort: real K3s cluster unavailable (kubectl cannot reach namespace pactflow)\n')
    process.exitCode = 1
    return
  }
  if (dryRun) {
    process.stdout.write(`[k3s-batch] dry-run: real cluster reachable; would run stages ${JSON.stringify(['suites', 'ttl', 'zero-proof'])}\n`)
    return
  }
  runStage('suites', runSuites)
  runStage('ttl', ttlStage)
  runStage('zero-proof', zeroProofStage)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}