import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import { PactFlowRunCleanupLedger } from '../src/run-ledger.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'
import type { V1ConfigMap, V1Secret, V1Job } from '@kubernetes/client-node'

const digest = `sha256:${'a'.repeat(64)}`
const template = {
  id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/datavdl/pactflow-worker@${digest}`, model: 'glm-5.2',
  baseUrl: 'https://model.example.invalid/v1', modelSecretName: 'pactflow-model-claude',
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
}
function config(): PactFlowK3sConfig {
  return { namespace: 'pactflow', imagePullSecret: 'pactflow-registry', pollIntervalMs: 250, templates: [template] }
}
const git = (): PactFlowGitRunSpec => ({ remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git',
  defaultBranch: 'main', baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run',
  worktreePath: '/tmp/isolated-run-ledger-test', validationCommands: [] })

const dirs: string[] = []
function ledgerPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'pactflow-run-ledger-'))
  dirs.push(root)
  return join(root, 'run-cleanups.json')
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('PactFlow durable run creation intent', () => {
  it('records intent before any resource exists and confirms server UIDs afterward', async () => {
    const ledger = new PactFlowRunCleanupLedger(ledgerPath())
    const worker = new PactFlowK3sWorker(config())
    const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git(), 'task'),
      ephemeralModelSecret: true }
    let intentSeenAtCreate = false
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        // The intent must already be durable before the first create call.
        intentSeenAtCreate = (await ledger.list()).some(record => record.jobName === spec.jobName && record.jobUid === undefined)
        return { ...body, metadata: { ...body.metadata, uid: `secret-${body.metadata?.name}-uid` } }
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => ({ ...body, metadata: { ...body.metadata, uid: `configmap-${body.metadata?.name}-uid` } }),
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      listNamespacedPod: async () => ({ items: [] }),
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async ({ body }: { body: V1Job }) => ({ ...body, metadata: { ...body.metadata, uid: 'job-uid' } }),
    })
    Reflect.set(worker, 'waitForResult', vi.fn().mockResolvedValue({ state: 'failed', outcome: 'isolated' }))

    await worker.run(spec, git(), 'task', new AbortController().signal, 'model-key', undefined, undefined,
      event => ledger.apply('fingerprint', event))

    expect(intentSeenAtCreate).toBe(true)
    const records = await ledger.list()
    const record = records.find(item => item.jobName === spec.jobName)
    expect(record?.jobUid).toBe('job-uid')
    expect(record?.children?.length).toBe(3)
  })

  it('refuses to confirm a creation that was never persisted as intent', async () => {
    const ledger = new PactFlowRunCleanupLedger(ledgerPath())
    await expect(ledger.apply('fingerprint', { phase: 'confirmed', jobName: 'never-intended', jobUid: 'uid', children: [] }))
      .rejects.toThrow(/was not persisted before creation/)
  })

  it('fails closed on a corrupted ledger instead of discarding responsibilities', async () => {
    const path = ledgerPath()
    const ledger = new PactFlowRunCleanupLedger(path)
    await ledger.apply('fingerprint', { phase: 'intent', jobName: 'run-x', childNames: [] })
    const { writeFileSync } = await import('node:fs')
    writeFileSync(path, '{ not json')
    await expect(new PactFlowRunCleanupLedger(path).list()).rejects.toThrow(/corrupted/)
  })
})
