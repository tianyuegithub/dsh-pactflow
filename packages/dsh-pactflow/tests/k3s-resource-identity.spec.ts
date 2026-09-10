import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'
import type { V1ConfigMap, V1Secret, V1Job, V1DeleteOptions } from '@kubernetes/client-node'

const digest = `sha256:${'a'.repeat(64)}`
const template = {
  id: 'claude',
  harness: 'claude' as const,
  apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/datavdl/pactflow-worker@${digest}`,
  model: 'glm-5.2',
  baseUrl: 'https://model.example.invalid/v1',
  modelSecretName: 'pactflow-model-claude',
  cpuRequest: '500m',
  memoryRequest: '1Gi',
  cpuLimit: '2',
  memoryLimit: '4Gi',
}

function config(overrides: Partial<PactFlowK3sConfig> = {}): PactFlowK3sConfig {
  return { namespace: 'pactflow', imagePullSecret: 'pactflow-registry', pollIntervalMs: 250, templates: [template], ...overrides }
}

const bindingGit = (): PactFlowGitRunSpec => ({ remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
  baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/isolated-k3s-identity-test', validationCommands: [] })

function spec(worker: PactFlowK3sWorker, git: PactFlowGitRunSpec, ephemeral = false) {
  return { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'), ephemeralModelSecret: ephemeral }
}

/**
 * F02 / spec k3s-resource-identity: creation-phase compensation must only touch
 * resources this call actually created and confirmed with a server UID. A 409
 * (AlreadyExists) never belonged to this run, so it must never be deleted by name.
 */
describe('PactFlow K3s resource identity during creation', () => {
  it('never deletes a pre-existing ConfigMap when its create returns 409 AlreadyExists', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git)
    const deletes: string[] = []
    let inputSecret: V1Secret
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        inputSecret = { ...body, metadata: { ...body.metadata, uid: 'this-run-input-uid' } }
        return inputSecret
      },
      // The ConfigMap name already exists (owned by someone else): the API returns 409.
      createNamespacedConfigMap: async () => { throw { code: 409 } },
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async () => inputSecret,
      listNamespacedPod: async () => ({ items: [] }),
      deleteNamespacedSecret: async ({ name }: { name: string }) => { deletes.push(`secret:${name}`) },
      deleteNamespacedConfigMap: async ({ name }: { name: string }) => { deletes.push(`configmap:${name}`) },
    })
    Reflect.set(worker, 'batch', {
      deleteNamespacedJob: async ({ name }: { name: string }) => { deletes.push(`job:${name}`) },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)

    await expect(worker.run(runSpec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/failed to create K3s ConfigMap/)

    // The foreign ConfigMap must not be deleted; deleting it would destroy another run's/owner's resource.
    expect(deletes).not.toContain(`configmap:${runSpec.configMapName}`)
    expect(wait).not.toHaveBeenCalled()
  })

  it('does not delete a same-name object that replaced the one this run created', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git)
    const deletes: string[] = []
    let inputSecret: V1Secret
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        inputSecret = { ...body, metadata: { ...body.metadata, uid: 'this-run-input-uid' } }
        return inputSecret
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => ({ ...body, metadata: { ...body.metadata, uid: 'this-run-config-uid' } }),
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async () => inputSecret,
      listNamespacedPod: async () => ({ items: [] }),
      deleteNamespacedSecret: async ({ name, body }: { name: string; body?: V1DeleteOptions }) => {
        deletes.push(`secret:${name}:${String(body?.preconditions?.uid ?? 'none')}`)
      },
      deleteNamespacedConfigMap: async ({ name, body }: { name: string; body?: V1DeleteOptions }) => {
        // Simulate the UID precondition mismatch: the name now belongs to a replacement object.
        if (body?.preconditions?.uid !== 'this-run-config-uid') throw { code: 409 }
        deletes.push(`configmap:${name}:${String(body?.preconditions?.uid ?? 'none')}`)
      },
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async () => { throw new Error('Job admission rejected') },
      deleteNamespacedJob: async ({ name }: { name: string }) => { deletes.push(`job:${name}`) },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)

    await expect(worker.run(runSpec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/failed to create K3s Job/)

    // Deletion must carry the UID precondition, and a precondition mismatch must fail closed.
    expect(deletes).toContain(`configmap:${runSpec.configMapName}:this-run-config-uid`)
  })

  it('treats a delete timeout as unknown rather than successful compensation', async () => {
    const worker = new PactFlowK3sWorker(config())
    // Shorten the independent request deadline so the timeout path is exercised quickly.
    Reflect.set(worker, 'requestTimeoutMs', 200)
    const git = bindingGit()
    const runSpec = spec(worker, git)
    let inputSecret: V1Secret
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        inputSecret = { ...body, metadata: { ...body.metadata, uid: 'this-run-input-uid' } }
        return inputSecret
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => ({ ...body, metadata: { ...body.metadata, uid: 'this-run-config-uid' } }),
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async () => inputSecret,
      listNamespacedPod: async () => ({ items: [] }),
      // Delete never resolves within the deadline → outcome is unknown, not a clean success.
      deleteNamespacedSecret: async () => new Promise(() => {}),
      deleteNamespacedConfigMap: async () => new Promise(() => {}),
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async () => { throw new Error('Job admission rejected') },
      deleteNamespacedJob: async () => { throw new Error('should not reach Job delete') },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    const started = Date.now()

    await expect(worker.run(runSpec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/compensation/)

    // Bounded: the deadline is enforced, the call does not hang forever.
    expect(Date.now() - started).toBeLessThan(20_000)
    expect(wait).not.toHaveBeenCalled()
  })

  it('keeps a create-timeout resource as an unknown responsibility instead of deleting it by name', async () => {
    const worker = new PactFlowK3sWorker(config())
    Reflect.set(worker, 'requestTimeoutMs', 200)
    const git = bindingGit()
    const runSpec = spec(worker, git)
    const deletes: string[] = []
    Reflect.set(worker, 'core', {
      // The request timed out: the server may or may not have created the object.
      createNamespacedSecret: async (options: { signal?: AbortSignal }) => {
        void options
        return new Promise(() => {})
      },
      deleteNamespacedSecret: async ({ name }: { name: string }) => { deletes.push(`secret:${name}`) },
      deleteNamespacedConfigMap: async ({ name }: { name: string }) => { deletes.push(`configmap:${name}`) },
      listNamespacedPod: async () => ({ items: [] }),
    })
    Reflect.set(worker, 'batch', {
      deleteNamespacedJob: async ({ name }: { name: string }) => { deletes.push(`job:${name}`) },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    const started = Date.now()

    await expect(worker.run(runSpec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/input Secret/)

    expect(Date.now() - started).toBeLessThan(20_000)
    // An unconfirmed create must not trigger a name-based delete of that object.
    expect(deletes).not.toContain(`secret:${runSpec.inputSecretName}`)
    expect(wait).not.toHaveBeenCalled()
  })

  it('treats an accepted-but-terminating delete (202/finalizer) as unknown, not cleaned', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git)
    let inputSecret: V1Secret
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        inputSecret = { ...body, metadata: { ...body.metadata, uid: 'this-run-input-uid' } }
        return inputSecret
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => ({ ...body, metadata: { ...body.metadata, uid: 'this-run-config-uid' } }),
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async () => inputSecret,
      listNamespacedPod: async () => ({ items: [] }),
      // The server accepts the delete but reports the object still terminating.
      deleteNamespacedSecret: async () => ({ metadata: { deletionTimestamp: new Date().toISOString() } }),
      deleteNamespacedConfigMap: async () => ({ metadata: { deletionTimestamp: new Date().toISOString() } }),
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async () => { throw new Error('Job admission rejected') },
      deleteNamespacedJob: async () => { throw new Error('should not reach Job delete') },
    })
    Reflect.set(worker, 'waitForResult', vi.fn())

    await expect(worker.run(runSpec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/compensation outcome unknown/)
  })

  it('discards a planned-but-never-run Run\'s in-memory secrets without touching resources', async () => {
    const worker = new PactFlowK3sWorker(config())
    const runSpec = spec(worker, bindingGit())
    const pending = Reflect.get(worker, 'pendingRuntimeSecrets') as Map<string, unknown>
    expect(pending.has(runSpec.jobName)).toBe(true)
    // A discarded plan never created external resources, so no delete may be issued.
    const deletes: string[] = []
    Reflect.set(worker, 'core', {
      deleteNamespacedSecret: async ({ name }: { name: string }) => { deletes.push(`secret:${name}`) },
      deleteNamespacedConfigMap: async ({ name }: { name: string }) => { deletes.push(`configmap:${name}`) },
    })
    Reflect.set(worker, 'batch', { deleteNamespacedJob: async ({ name }: { name: string }) => { deletes.push(`job:${name}`) } })
    worker.discard(runSpec.jobName)
    expect(pending.has(runSpec.jobName)).toBe(false)
    expect(deletes).toEqual([])
  })

  it('creates nothing when the creation intent cannot be persisted', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git, true)
    const creates: string[] = []
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => { creates.push(`secret:${body.metadata?.name}`); return body },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => { creates.push(`configmap:${body.metadata?.name}`); return body },
      deleteNamespacedSecret: async () => {}, deleteNamespacedConfigMap: async () => {},
      listNamespacedPod: async () => ({ items: [] }),
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async ({ body }: { body: V1Job }) => { creates.push(`job:${body.metadata?.name}`); return body },
      deleteNamespacedJob: async () => {},
    })
    Reflect.set(worker, 'waitForResult', vi.fn())

    // The durable intent write fails: no external resource may be created.
    await expect(worker.run(runSpec, git, 'task', new AbortController().signal, 'model-key', undefined, undefined,
      async () => { throw new Error('ledger write failed') }))
      .rejects.toThrow(/ledger write failed/)
    expect(creates).toEqual([])
  })

  it('keeps the creation intent when a transient read returns 404 (late creation)', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git, true)
    const unknown: string[] = []
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: `secret-${body.metadata?.name}-uid` } }),
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => ({ ...body, metadata: { ...body.metadata, uid: `configmap-${body.metadata?.name}-uid` } }),
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      listNamespacedPod: async () => ({ items: [] }),
      deleteNamespacedSecret: async () => { throw { code: 404 } },
      deleteNamespacedConfigMap: async () => { throw { code: 404 } },
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async ({ body }: { body: V1Job }) => ({ ...body, metadata: { ...body.metadata, uid: 'job-uid' } }),
      deleteNamespacedJob: async () => { throw { code: 404 } },
    })
    Reflect.set(worker, 'waitForResult', vi.fn().mockResolvedValue({ state: 'failed', outcome: 'isolated' }))

    // The intent record persists through the run; a 404 read never removes it here.
    const events: string[] = []
    await worker.run(runSpec, git, 'task', new AbortController().signal, 'model-key', undefined, undefined,
      async event => { events.push(event.phase) })
    expect(events).toContain('intent')
    expect(events).toContain('confirmed')
    expect(unknown).toEqual([])
  })

  it('releases this run\'s pending secrets on failure instead of retaining them', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const runSpec = spec(worker, git, true)
    const pending = Reflect.get(worker, 'pendingRuntimeSecrets') as Map<string, unknown>
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async () => { throw new Error('Secret quota exceeded') },
      deleteNamespacedSecret: async () => {}, deleteNamespacedConfigMap: async () => {},
      listNamespacedPod: async () => ({ items: [] }),
    })
    Reflect.set(worker, 'batch', { deleteNamespacedJob: async () => {} })
    Reflect.set(worker, 'waitForResult', vi.fn())

    expect(pending.has(runSpec.jobName)).toBe(true)
    await expect(worker.run(runSpec, git, 'task', new AbortController().signal, 'model-key'))
      .rejects.toThrow(/model Secret/)
    // F08: the failed run must not retain its per-run runtime secrets indefinitely.
    expect(pending.has(runSpec.jobName)).toBe(false)
  })
})
