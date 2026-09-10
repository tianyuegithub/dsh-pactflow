import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { PactFlowK3sWorker } from '../src/k3s-worker.ts'
import { PactFlowProbeCleanupLedger } from '../src/probe-ledger.ts'

// Real-cluster probe cleanup reconciliation (authorized B-class run).
// Unlike the isolated doubles, this drives a REAL Kubernetes API: it creates a real
// Job, confirms its server UID into the durable ledger, then reconciles with a
// UID-precondition delete and proves 404 idempotency. Nothing here is mocked.
const enabled = process.env.DSH_K3S_E2E === '1'
const NAMESPACE = 'pactflow'
const IMAGE = process.env.PACTFLOW_K3S_TTL_IMAGE ?? 'busybox:1.36'

function kubeconfigPath(): string {
  return process.env.KUBECONFIG ?? join(homedir(), '.kube', 'config')
}

function applyJob(jobName: string): void {
  execFileSync('kubectl', ['apply', '-f', '-'], {
    input: JSON.stringify({
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: { name: jobName, namespace: NAMESPACE },
      spec: {
        backoffLimit: 0, ttlSecondsAfterFinished: 3600,
        template: { spec: { restartPolicy: 'Never', containers: [{ name: 'probe', image: IMAGE, command: ['sh', '-c', 'exit 0'] }] } },
      },
    }),
    stdio: ['pipe', 'ignore', 'pipe'],
  })
}

function jobUid(jobName: string): string {
  return JSON.parse(execFileSync('kubectl', ['get', 'job', jobName, '-n', NAMESPACE, '-o', 'json'], { encoding: 'utf8' })).metadata.uid
}

function jobPresent(jobName: string): boolean {
  try { execFileSync('kubectl', ['get', 'job', jobName, '-n', NAMESPACE], { stdio: 'ignore' }); return true } catch { return false }
}

describe.skipIf(!enabled)('PactFlow real probe ledger reconciliation', { timeout: 300_000 }, () => {
  let root: string
  let worker: PactFlowK3sWorker
  let ledger: PactFlowProbeCleanupLedger
  const created: string[] = []

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-probe-ledger-'))
    worker = new PactFlowK3sWorker({
      namespace: NAMESPACE,
      kubeconfig: kubeconfigPath(),
      imagePullSecret: 'pactflow-registry-home-harbor',
      pollIntervalMs: 1_000,
      templates: [],
    })
    ledger = new PactFlowProbeCleanupLedger(join(root, 'probe-cleanups.json'))
  })

  afterAll(async () => {
    for (const name of created.splice(0)) {
      try { execFileSync('kubectl', ['delete', 'job', name, '-n', NAMESPACE, '--ignore-not-found=true', '--wait=false'], { stdio: 'ignore' }) } catch { /* best effort */ }
    }
    if (root !== undefined) await rm(root, { recursive: true, force: true })
  })

  it('confirms a real Job UID into the ledger, reconciles it by UID precondition, and stays idempotent', async () => {
    const jobName = `pf-ledger-${Date.now().toString(36)}`
    created.push(jobName)
    applyJob(jobName)

    // Intent before creation, then confirmation with the real server UID.
    await ledger.apply('harness', 'real-fingerprint', { phase: 'intent', jobName })
    const uid = jobUid(jobName)
    expect(typeof uid).toBe('string')
    await ledger.apply('harness', 'real-fingerprint', { phase: 'confirmed', jobName, jobUid: uid })
    expect((await ledger.list()).find(record => record.jobName === jobName)?.jobUid).toBe(uid)

    // Wait for the Pod so cleanup exercises the real owned-Pod path.
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const pods = JSON.parse(execFileSync('kubectl', ['get', 'pods', '-n', NAMESPACE, '-l', `job-name=${jobName}`, '-o', 'json'], { encoding: 'utf8' })).items
      if (pods.length > 0) break
      await new Promise(resolve => setTimeout(resolve, 1_000))
    }

    // Real UID-precondition cleanup of the Job (and any owned Pod).
    await worker.cleanupProbeIdentity({ jobName, jobUid: uid })
    expect(jobPresent(jobName)).toBe(false)
    // The durable record is only removed once the responsibility is discharged.
    expect(await readFile(join(root, 'probe-cleanups.json'), 'utf8')).toContain(jobName)

    // 404 idempotency: reconciling the same identity again must succeed (already gone).
    await expect(worker.cleanupProbeIdentity({ jobName, jobUid: uid })).resolves.toBeUndefined()

    await ledger.apply('harness', 'real-fingerprint', { phase: 'cleaned', jobName })
    expect((await ledger.list()).some(record => record.jobName === jobName)).toBe(false)
  })

  it('retains a record whose identity is unconfirmed instead of deleting it by name', async () => {
    const jobName = `pf-ledger-unconfirmed-${Date.now().toString(36)}`
    created.push(jobName)
    applyJob(jobName)
    // The ledger has only an intent (no confirmed UID) while a real Job exists.
    await ledger.apply('harness', 'real-fingerprint', { phase: 'intent', jobName })
    // Without a confirmed UID the worker must fail closed, not delete by reusable name.
    await expect(worker.cleanupProbeIdentity({ jobName })).rejects.toThrow(/requires a confirmed Job UID/)
    // The real Job is untouched, and the record is retained for explicit recovery.
    expect(jobPresent(jobName)).toBe(true)
    expect((await ledger.list()).some(record => record.jobName === jobName && record.jobUid === undefined)).toBe(true)
  })
})
