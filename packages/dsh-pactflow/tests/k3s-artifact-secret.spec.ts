import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker, pactFlowK3sSpecDigest, pactFlowSecretHash } from '../src/k3s-worker.ts'
import type { PactFlowK3sRunSpec } from '../src/types.ts'

/**
 * The artifact-store Secret holds long-lived object-store keys in the clear.
 * Unlike the ConfigMap and the model/input Secrets it was never given an
 * ownerReference and never appeared in `cleanupRun`'s deletion list, so every
 * task bound to object storage left one behind: the Job's deletion could not
 * cascade to it (no owner), and nothing else deleted it. On a long-lived Host
 * they accumulated, each readable by anything in the namespace with `secrets get`.
 */

const spec: PactFlowK3sRunSpec = {
  jobUid: 'artifact-job-uid', runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64), specDigest: '3'.repeat(64),
  templateId: 'dsh', namespace: 'pactflow', jobName: 'dsh-pf-artifact', configMapName: 'dsh-pf-artifact',
  image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull',
  harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
  modelSecretName: 'dsh-pf-artifact-model', ephemeralModelSecret: true, gitSecretName: 'pactflow-git-secret',
  inputSecretName: 'dsh-pf-artifact-input',
  artifactStore: {
    endpoint: 'https://s3.invalid', region: 'us-east-1', bucket: 'pactflow',
    secretName: 'dsh-pf-artifact-artifact', forcePathStyle: true,
  },
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
  activeDeadlineSeconds: 600, finishedJobTtlSeconds: 86_400,
}

function worker(): PactFlowK3sWorker {
  return new PactFlowK3sWorker({ namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [] })
}

function ownedMetadata(instance: PactFlowK3sWorker, uid: string) {
  return { metadata: { uid, labels: Reflect.get(instance, 'labels').call(instance, spec),
    annotations: Reflect.get(instance, 'annotations').call(instance, spec),
    ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: spec.jobUid, controller: true }] } }
}

describe('PactFlow artifact-store Secret lifecycle', () => {
  it('is deleted with the rest of the run, under its own UID precondition', async () => {
    const instance = worker()
    const deleted: { name: string; uid: unknown }[] = []
    Reflect.set(instance, 'core', {
      readNamespacedConfigMap: vi.fn(async () => ownedMetadata(instance, 'config-uid')),
      readNamespacedSecret: vi.fn(async ({ name }: { name: string }) => ownedMetadata(instance, `${name}-uid`)),
      listNamespacedPod: vi.fn(async () => ({ items: [] })),
      deleteNamespacedConfigMap: vi.fn(),
      deleteNamespacedSecret: vi.fn(async (request: { name: string; body?: { preconditions?: { uid?: string } } }) => {
        deleted.push({ name: request.name, uid: request.body?.preconditions?.uid })
      }),
    })
    Reflect.set(instance, 'batch', {
      readNamespacedJob: vi.fn(async () => ownedMetadata(instance, spec.jobUid!)),
      deleteNamespacedJob: vi.fn(),
    })

    await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()

    expect(deleted.map(entry => entry.name).sort()).toEqual([
      'dsh-pf-artifact-artifact', 'dsh-pf-artifact-input', 'dsh-pf-artifact-model',
    ])
    // Never by name alone: an unconfirmed identity must not be deleted.
    expect(deleted.every(entry => typeof entry.uid === 'string' && entry.uid !== '')).toBe(true)
  })

  it('is bound to the Job so deleting the Job cascades to it', async () => {
    const instance = worker()
    const bound = new Map<string, unknown>()
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: { metadata?: { name?: string } } }) =>
        ({ metadata: { name: body.metadata?.name, uid: `${body.metadata?.name ?? ''}-uid` } })),
      createNamespacedConfigMap: vi.fn(async () => ({ metadata: { uid: 'config-uid' } })),
      replaceNamespacedConfigMap: vi.fn(),
      replaceNamespacedSecret: vi.fn(async ({ name, body }: { name: string; body: { metadata?: { ownerReferences?: unknown } } }) => {
        bound.set(name, body.metadata?.ownerReferences)
      }),
      listNamespacedPod: vi.fn(async () => ({ items: [] })),
    })
    Reflect.set(instance, 'batch', { createNamespacedJob: vi.fn(async () => ({ metadata: { uid: spec.jobUid } })) })
    // Stop right after binding: the wait loop is not what this case is about.
    Reflect.set(instance, 'waitForResult', vi.fn(() => { throw new Error('stop after binding') }))

    const { jobUid: _drop, ...unbound } = spec
    const runtimeSecrets = { runNonce: 'n'.repeat(32), claimToken: 'c'.repeat(32) }
    Reflect.set(instance, 'pendingRuntimeSecrets', new Map([[spec.jobName, runtimeSecrets]]))
    const git = {
      remote: 'origin', remoteUrl: 'https://git.invalid/o/r.git', defaultBranch: 'main',
      baseCommit: 'b'.repeat(40), branch: 'pactflow/task', worktreePath: '/tmp/wt', validationCommands: [],
    }
    const base = {
      ...(unbound as PactFlowK3sRunSpec),
      runNonceHash: pactFlowSecretHash(runtimeSecrets.runNonce),
      claimTokenHash: pactFlowSecretHash(runtimeSecrets.claimToken),
    }
    // The digest is reconciled on entry, so it has to be the real one.
    const planned: PactFlowK3sRunSpec = { ...base, specDigest: pactFlowK3sSpecDigest(base, git, 'prompt') }
    await expect(instance.run(planned, git, 'prompt', new AbortController().signal, 'model-key',
      runtimeSecrets, undefined, undefined, { accessKeyId: 'AKIA', secretAccessKey: 'secret' }))
      .rejects.toThrow(/stop after binding/)

    const owner = bound.get('dsh-pf-artifact-artifact')
    expect(owner, 'the artifact Secret must carry an ownerReference to its Job').toEqual([{
      apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: spec.jobUid,
      controller: true, blockOwnerDeletion: true,
    }])
  })
})
