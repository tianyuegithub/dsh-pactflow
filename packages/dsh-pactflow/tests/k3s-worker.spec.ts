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
  return {
    namespace: 'pactflow',
    imagePullSecret: 'pactflow-registry',
    pollIntervalMs: 250,
    templates: [template],
    ...overrides,
  }
}

describe('PactFlow K3s Worker provider', () => {
  it('does not start a polling delay if observation was aborted while reading the Job', async () => {
    vi.useFakeTimers()
    const worker = new PactFlowK3sWorker(config())
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const controller = new AbortController()
    const observe = vi.fn(async () => { controller.abort(); return { state: 'pending' } })
    const cancel = vi.fn()
    Reflect.set(worker, 'observe', observe)
    Reflect.set(worker, 'cancel', cancel)
    const result = expect(worker.waitExisting(spec, controller.signal)).rejects.toThrow(/cancelled/)
    try {
      await vi.advanceTimersByTimeAsync(0)
      expect(vi.getTimerCount()).toBe(0)
      expect(observe).toHaveBeenCalledTimes(1)
      expect(cancel).not.toHaveBeenCalled()
    } finally {
      await vi.runAllTimersAsync()
      await result
      vi.useRealTimers()
    }
  })

  it('stops recovery observation without cancelling a reconnectable Job', async () => {
    const worker = new PactFlowK3sWorker(config())
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const controller = new AbortController()
    controller.abort()
    const cancel = vi.fn().mockResolvedValue(undefined)
    Reflect.set(worker, 'cancel', cancel)
    await expect(worker.waitExisting(spec, controller.signal)).rejects.toThrow(/cancelled/)
    expect(cancel).not.toHaveBeenCalled()
    await expect(Reflect.get(worker, 'waitForResult').call(worker, spec, controller.signal)).rejects.toThrow(/cancelled/)
    expect(cancel).toHaveBeenCalledTimes(1)
  })

  it('does not wait for a result when durable Job binding fails, and still compensates pre-bind resources', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git: PactFlowGitRunSpec = { remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
      baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/isolated-k3s-binding-test', validationCommands: [] }
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task')
    const deleted: string[] = []
    let inputSecret: V1Secret
    let configMap: V1ConfigMap
    let job: V1Job
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        inputSecret = { ...body, metadata: { ...body.metadata, uid: 'created-input-uid' } }; return inputSecret
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
        configMap = { ...body, metadata: { ...body.metadata, uid: 'created-config-uid' } }; return configMap
      },
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async () => inputSecret, readNamespacedConfigMap: async () => configMap,
      listNamespacedPod: async () => ({ items: [] }),
      deleteNamespacedSecret: async ({ body }: { body?: V1DeleteOptions }) => {
        expect(body?.preconditions?.uid).toBe('created-input-uid'); deleted.push('secret')
      },
      deleteNamespacedConfigMap: async ({ body }: { body?: V1DeleteOptions }) => {
        expect(body?.preconditions?.uid).toBe('created-config-uid'); deleted.push('configmap')
      },
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async ({ body }: { body: V1Job }) => {
        job = { ...body, metadata: { ...body.metadata, uid: 'created-job-uid' } }; return job
      },
      readNamespacedJob: async () => job,
      deleteNamespacedJob: async ({ body }: { body?: V1DeleteOptions }) => {
        expect(body?.preconditions?.uid).toBe('created-job-uid'); deleted.push('job')
      },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal, undefined, undefined,
      async () => { throw new Error('durable binding failed') })).rejects.toThrow('durable binding failed')
    expect(wait).not.toHaveBeenCalled()
    expect(deleted).toEqual(['configmap', 'secret', 'job'])
  })

  function creationFixture(worker: PactFlowK3sWorker, jobFailure: 'throws' | 'no-uid' | 'succeeds') {
    const uids = new Map<string, string>()
    const createdJobs = new Set<string>()
    const deletions: string[] = []
    const uidFor = (kind: 'secret' | 'configmap', name: string): string => {
      const existing = uids.get(`${kind}:${name}`)
      if (existing !== undefined) return existing
      const created = `${kind}-${name}-uid`
      uids.set(`${kind}:${name}`, created)
      return created
    }
    Reflect.set(worker, 'core', {
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        const name = body.metadata?.name ?? ''
        return { ...body, metadata: { ...body.metadata, uid: uidFor('secret', name) } }
      },
      createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
        const name = body.metadata?.name ?? ''
        return { ...body, metadata: { ...body.metadata, uid: uidFor('configmap', name) } }
      },
      replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
      readNamespacedSecret: async ({ name }: { name: string }) => ({ metadata: { name, uid: uidFor('secret', name) } }),
      readNamespacedConfigMap: async ({ name }: { name: string }) => ({ metadata: { name, uid: uidFor('configmap', name) } }),
      listNamespacedPod: async () => ({ items: [] }),
      deleteNamespacedSecret: async ({ name, body }: { name: string; body?: V1DeleteOptions }) => {
        // Only the exact confirmed UID may be deleted; a mismatch means a replacement object.
        if (body?.preconditions?.uid !== uidFor('secret', name)) throw { code: 409 }
        uids.delete(`secret:${name}`); deletions.push(`secret:${name}`)
      },
      deleteNamespacedConfigMap: async ({ name, body }: { name: string; body?: V1DeleteOptions }) => {
        if (body?.preconditions?.uid !== uidFor('configmap', name)) throw { code: 409 }
        uids.delete(`configmap:${name}`); deletions.push(`configmap:${name}`)
      },
    })
    Reflect.set(worker, 'batch', {
      createNamespacedJob: async ({ body }: { body: V1Job }) => {
        if (jobFailure === 'throws') throw new Error('admission webhook rejected the Job')
        createdJobs.add(body.metadata?.name ?? '')
        if (jobFailure === 'no-uid') return { ...body, metadata: { ...body.metadata } }
        return { ...body, metadata: { ...body.metadata, uid: 'created-job-uid' } }
      },
      readNamespacedJob: async ({ name }: { name: string }) => {
        if (!createdJobs.has(name)) throw { code: 404 }
        // Identity mismatch (labels/annotations absent) makes cleanup fail closed.
        return { metadata: { name, uid: 'created-job-uid' } }
      },
      deleteNamespacedJob: async ({ name, body }: { name: string; body?: V1DeleteOptions }) => {
        if (!createdJobs.has(name)) throw { code: 404 }
        if (body?.preconditions?.uid !== 'created-job-uid') throw { code: 409 }
        createdJobs.delete(name); deletions.push(`job:${name}`)
      },
    })
    return { uids, createdJobs, deletions }
  }

  const bindingGit = (): PactFlowGitRunSpec => ({ remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
    baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/isolated-k3s-binding-test', validationCommands: [] })

  it('compensates the model Secret and keeps the cause when the input Secret creation fails', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
      ephemeralModelSecret: true }
    const { deletions } = creationFixture(worker, 'succeeds')
    Reflect.set(worker, 'core', {
      ...Reflect.get(worker, 'core'),
      createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
        const name = body.metadata?.name ?? ''
        if (name !== spec.modelSecretName) throw new Error('input Secret quota exceeded')
        return { ...body, metadata: { ...body.metadata, uid: `secret-${name}-uid` } }
      },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal, 'model-key'))
      .rejects.toThrow('failed to create K3s input Secret')
    expect(deletions).toEqual([`secret:${spec.modelSecretName}`])
    expect(wait).not.toHaveBeenCalled()
  })

  it('compensates created Secrets and keeps the cause when the ConfigMap creation fails', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
      ephemeralModelSecret: true }
    const { deletions } = creationFixture(worker, 'succeeds')
    Reflect.set(worker, 'core', {
      ...Reflect.get(worker, 'core'),
      createNamespacedConfigMap: async () => { throw new Error('ConfigMap quota exceeded') },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal, 'model-key'))
      .rejects.toThrow('failed to create K3s ConfigMap')
    expect(deletions).toEqual([`secret:${spec.modelSecretName}`, `secret:${spec.inputSecretName}`])
    expect(wait).not.toHaveBeenCalled()
  })

  it('compensates only confirmed-owned children when the Job creation fails', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
      ephemeralModelSecret: true }
    const { deletions } = creationFixture(worker, 'throws')
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal, 'model-key'))
      .rejects.toThrow('failed to create K3s Job')
    // Owned order is model Secret, input Secret, ConfigMap; the Job was never created.
    expect(deletions).toEqual([
      `secret:${spec.modelSecretName}`, `secret:${spec.inputSecretName}`, `configmap:${spec.configMapName}`,
    ])
    expect(wait).not.toHaveBeenCalled()
  })

  it('keeps compensating the remaining owned resources when one compensation fails', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
      ephemeralModelSecret: true }
    const { deletions } = creationFixture(worker, 'throws')
    Reflect.set(worker, 'core', {
      ...Reflect.get(worker, 'core'),
      deleteNamespacedConfigMap: async () => { throw new Error('ConfigMap delete forbidden') },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal, 'model-key'))
      .rejects.toThrow(/failed to create K3s Job.*compensation/)
    expect(deletions).toEqual([`secret:${spec.modelSecretName}`, `secret:${spec.inputSecretName}`])
    expect(wait).not.toHaveBeenCalled()
  })

  it('never deletes a Job by name when its creation returns no UID', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task')
    const { deletions } = creationFixture(worker, 'no-uid')
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal)).rejects.toThrow('has no UID')
    // The Job's identity is unconfirmed, so it stays an unknown responsibility;
    // only the confirmed children are deleted.
    expect(deletions).toEqual([`secret:${spec.inputSecretName}`, `configmap:${spec.configMapName}`])
    expect(deletions).not.toContain(`job:${spec.jobName}`)
    expect(wait).not.toHaveBeenCalled()
  })

  it('preserves the missing-UID cause when owned compensation fails', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task')
    const { deletions } = creationFixture(worker, 'no-uid')
    Reflect.set(worker, 'core', {
      ...Reflect.get(worker, 'core'),
      deleteNamespacedConfigMap: async () => { throw new Error('ConfigMap delete forbidden') },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal))
      .rejects.toThrow(/has no UID.*compensation/)
    expect(deletions).toEqual([`secret:${spec.inputSecretName}`])
    expect(deletions).not.toContain(`job:${spec.jobName}`)
    expect(wait).not.toHaveBeenCalled()
  })

  it('preserves the binding failure without deleting an unconfirmed Job by name', async () => {
    const worker = new PactFlowK3sWorker(config())
    const git = bindingGit()
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task')
    const { deletions } = creationFixture(worker, 'succeeds')
    Reflect.set(worker, 'core', {
      ...Reflect.get(worker, 'core'),
      replaceNamespacedConfigMap: async () => { throw new Error('ConfigMap replace conflict') },
    })
    const wait = vi.fn()
    Reflect.set(worker, 'waitForResult', wait)
    await expect(worker.run(spec, git, 'task', new AbortController().signal))
      .rejects.toThrow('failed to bind ConfigMap')
    // The binding failure is preserved; compensation runs through the UID-bound path.
    expect(wait).not.toHaveBeenCalled()
  })

  it.each(['valid', 'old-job', 'forged-pod', 'wrong-spec', 'wrong-claim', 'wrong-image', 'image-suffix', 'wrong-branch', 'null-document'] as const)(
    'validates exact terminal result binding: %s', async variant => {
      const worker = new PactFlowK3sWorker(config())
      const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000),
        jobUid: 'job-uid', expectedBranch: 'pactflow/need/node/run', expectedBaseCommit: 'b'.repeat(40) }
      const labels = Reflect.get(worker, 'labels').call(worker, spec)
      const annotations = Reflect.get(worker, 'annotations').call(worker, spec)
      Reflect.set(worker, 'batch', { readNamespacedJob: async () => ({
        metadata: { uid: variant === 'old-job' ? 'other-job' : spec.jobUid, labels, annotations }, status: { succeeded: 1 },
      }) })
      const document = { schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit: 'c'.repeat(40),
        branch: variant === 'wrong-branch' ? 'other-branch' : spec.expectedBranch,
        harnessVersion: 'test', agentExitCode: 0, pushExitCode: 0,
        runNonceHash: spec.runNonceHash, claimTokenHash: variant === 'wrong-claim' ? 'd'.repeat(64) : spec.claimTokenHash,
        specDigest: variant === 'wrong-spec' ? 'e'.repeat(64) : spec.specDigest }
      Reflect.set(worker, 'core', { listNamespacedPod: async () => ({ items: [{
        metadata: { name: 'worker-pod', labels, annotations, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job',
          name: spec.jobName, uid: variant === 'forged-pod' ? 'forged-job' : spec.jobUid, controller: true }] },
        status: { containerStatuses: [{ name: 'worker',
          imageID: variant === 'wrong-image' ? `registry.invalid/other@sha256:${'f'.repeat(64)}` : `${spec.image}${variant === 'image-suffix' ? '-forged' : ''}`,
          state: { terminated: { exitCode: 0, finishedAt: new Date(), message: JSON.stringify(variant === 'null-document' ? null : document) } },
        }] },
      }] }) })
      expect(await worker.observe(spec)).toMatchObject({ state: variant === 'valid' ? 'succeeded' : 'failed' })
    },
  )

  it.each(['all', 'jobUid', 'runNonceHash', 'claimTokenHash', 'specDigest', 'expectedBranch', 'expectedBaseCommit'] as const)(
    'rejects observation identity when %s is absent', async missing => {
      const worker = new PactFlowK3sWorker(config())
      const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000),
        jobUid: 'job-uid', expectedBranch: 'pactflow/need/node/run', expectedBaseCommit: 'b'.repeat(40) }
      const labels = Reflect.get(worker, 'labels').call(worker, spec)
      const annotations = Reflect.get(worker, 'annotations').call(worker, spec)
      const job = { metadata: { uid: spec.jobUid, labels, annotations } }
      Reflect.set(worker, 'batch', { readNamespacedJob: async () => job })
      expect(await worker.observe(spec)).toEqual({ state: 'pending' })
      const incomplete = { ...spec }
      for (const key of missing === 'all'
        ? ['jobUid', 'runNonceHash', 'claimTokenHash', 'specDigest', 'expectedBranch', 'expectedBaseCommit'] : [missing]) {
        Reflect.deleteProperty(incomplete, key)
      }
      expect(await worker.observe(incomplete)).toMatchObject({ state: 'failed', outcome: expect.stringContaining('identity') })
    },
  )

  it('keeps Harness/API compatibility fixed and plans immutable digest Jobs', () => {
    const worker = new PactFlowK3sWorker(config())
    expect(worker.listTemplates()).toEqual([template])
    const spec = worker.plan(
      `run-${'1'.repeat(8)}-${'2'.repeat(4)}-${'3'.repeat(4)}-${'4'.repeat(4)}-${'5'.repeat(12)}` as never,
      'claude',
      'pactflow-git',
      60_000,
    )
    expect(spec).toMatchObject({
      templateId: 'claude',
      harness: 'claude',
      apiMode: 'anthropic-messages',
      // The Job wall-clock budget is independent of the 60s ownership lease: it must
      // not kill a healthy task at the first lease interval.
      activeDeadlineSeconds: 3_600,
      image: template.image,
      gitSecretName: 'pactflow-git',
    })
    expect(spec.jobName).toMatch(/^dsh-pf-[a-z0-9-]+$/)
    expect(spec.runNonceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.claimTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.specDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.inputSecretName).toMatch(/^dsh-pf-[a-z0-9-]+-input$/)
  })

  it('rejects protocol drift, mutable image tags, duplicate ids, and unknown templates', () => {
    expect(() => new PactFlowK3sWorker(config({ kubeconfig: 'relative/config' })))
      .toThrow(/absolute path/)
    expect(() => new PactFlowK3sWorker(config({
      templates: [{ ...template, apiMode: 'openai-chat-completions' }],
    }))).toThrow(/does not support/)
    expect(() => new PactFlowK3sWorker(config({
      templates: [{ ...template, image: 'registry.invalid/worker:latest' }],
    }))).toThrow(/sha256 digest/)
    expect(() => new PactFlowK3sWorker(config({ templates: [template, template] })))
      .toThrow(/duplicate/)
    const worker = new PactFlowK3sWorker(config())
    expect(() => worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'missing', 'git', 60_000))
      .toThrow(/not configured/)
  })

  it('keeps prompts in the Job-owned input Secret rather than the ConfigMap', () => {
    const worker = new PactFlowK3sWorker(config())
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const configMap = (Reflect.get(worker, 'configMap') as (value: unknown) => { data?: Record<string, string> }).call(worker, spec)
    expect(configMap.data?.['spec.json']).toBeUndefined()
    expect(configMap.data?.['worker.sh']).toContain('pactflow-input')
  })

  it('folds declared predecessor code inputs into the K3s baseline (F03)', () => {
    const worker = new PactFlowK3sWorker(config())
    const input = { dependency: 'node-a', branch: 'pactflow/need/node-a/run', commit: 'c'.repeat(40) }
    const git: PactFlowGitRunSpec = { ...bindingGit(), codeInputs: [input] }
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task')
    const inputSecret = (Reflect.get(worker, 'inputSecret') as (s: unknown, g: unknown, p: unknown, r: unknown) =>
      { stringData: Record<string, string> }).call(worker, spec, git, 'task', { runNonce: 'n', claimToken: 't' })
    const document = JSON.parse(inputSecret.stringData['spec.json']!) as { codeInputs?: { commit: string }[] }
    expect(document.codeInputs).toEqual([{ commit: input.commit }])
    // The container script really folds the exact commit, and measures the worker's
    // own change against the folded baseline (not the raw base).
    const configMap = (Reflect.get(worker, 'configMap') as (s: unknown) => { data: Record<string, string> }).call(worker, spec)
    expect(configMap.data['worker.sh']).toContain('merge --no-ff --no-edit "$CODE_INPUT"')
    expect(configMap.data['worker.sh']).toContain('BASELINE_COMMIT')
    expect(configMap.data['worker.sh']).toContain('CURRENT_COMMIT" != "$BASELINE_COMMIT')
    // The digest binds the code inputs, so a swapped baseline can never pass the result check.
    const withoutInputs = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, bindingGit(), 'task')
    expect(spec.specDigest).not.toBe(withoutInputs.specDigest)
  })

  it('admits only bounded prompts and SSH Git remotes before claim', () => {
    const worker = new PactFlowK3sWorker(config())
    const base: PactFlowGitRunSpec = {
      remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
      baseCommit: 'a'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/worktree',
      validationCommands: [],
    }
    expect(() => worker.preflightRun(base, 'do the task')).not.toThrow()
    expect(() => worker.preflightRun({ ...base, remoteUrl: 'https://gitea.invalid/org/repo.git' }, 'task'))
      .toThrow(/require an SSH Git remote/)
    expect(() => worker.preflightRun(base, '')).toThrow(/1-262144/)
  })

  function hangingWorker(): PactFlowK3sWorker {
    const worker = new PactFlowK3sWorker(config())
    Reflect.set(worker, 'requestTimeoutMs', 20)
    return worker
  }

  it('fails the run closed and compensates only confirmed owners when the Job creation hangs', async () => {
    vi.useFakeTimers()
    try {
      const worker = hangingWorker()
      const git = bindingGit()
      const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
        ephemeralModelSecret: true }
      const { createdJobs, deletions } = creationFixture(worker, 'succeeds')
      Reflect.set(worker, 'batch', {
        ...Reflect.get(worker, 'batch'),
        createNamespacedJob: () => new Promise<never>(() => {}),
      })
      createdJobs.add(spec.jobName)
      const wait = vi.fn()
      Reflect.set(worker, 'waitForResult', wait)
      const pending = worker.run(spec, git, 'task', new AbortController().signal, 'model-key')
      const expectation = expect(pending).rejects.toThrow(/failed to create K3s Job.*timed out/)
      await vi.advanceTimersByTimeAsync(50)
      await expectation
      // The hung Job has no confirmed UID, so it is never deleted by name; the
      // confirmed children are.
      expect(deletions).toEqual([
        `secret:${spec.modelSecretName}`, `secret:${spec.inputSecretName}`, `configmap:${spec.configMapName}`,
      ])
      expect(deletions).not.toContain(`job:${spec.jobName}`)
      expect(wait).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('keeps a hung model Secret as unknown rather than deleting it by name', async () => {
    vi.useFakeTimers()
    try {
      const worker = hangingWorker()
      const git = bindingGit()
      const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, git, 'task'),
        ephemeralModelSecret: true }
      const { deletions } = creationFixture(worker, 'succeeds')
      Reflect.set(worker, 'core', {
        ...Reflect.get(worker, 'core'),
        createNamespacedSecret: ({ body }: { body: V1Secret }) => {
          const name = body.metadata?.name ?? ''
          if (name === spec.modelSecretName) return new Promise<never>(() => {})
          return Promise.resolve({ ...body, metadata: { ...body.metadata, uid: `secret-${name}-uid` } })
        },
      })
      const wait = vi.fn()
      Reflect.set(worker, 'waitForResult', wait)
      const pending = worker.run(spec, git, 'task', new AbortController().signal, 'model-key')
      const expectation = expect(pending).rejects.toThrow(/failed to create model Secret.*timed out/)
      await vi.advanceTimersByTimeAsync(50)
      await expectation
      // The model Secret's create outcome is unknown; it must not be deleted by name.
      expect(deletions).toEqual([])
      expect(wait).not.toHaveBeenCalled()
    } finally { vi.useRealTimers() }
  })

  it('fails cleanupRun closed when the Job deletion hangs past its deadline', async () => {
    vi.useFakeTimers()
    try {
      const worker = hangingWorker()
      const spec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000, bindingGit(), 'task'),
        jobUid: 'cleanup-job-uid' }
      const owned = (uid: string) => ({ metadata: { uid, labels: Reflect.get(worker, 'labels').call(worker, spec),
        annotations: Reflect.get(worker, 'annotations').call(worker, spec),
        ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: spec.jobUid, controller: true }] } })
      Reflect.set(worker, 'batch', {
        readNamespacedJob: async () => ({ metadata: { uid: spec.jobUid, labels: Reflect.get(worker, 'labels').call(worker, spec),
          annotations: Reflect.get(worker, 'annotations').call(worker, spec) } }),
        deleteNamespacedJob: () => new Promise<never>(() => {}),
      })
      Reflect.set(worker, 'core', {
        readNamespacedConfigMap: async () => owned('config-uid'),
        readNamespacedSecret: async () => owned('secret-uid'),
        listNamespacedPod: async () => ({ items: [] }),
        deleteNamespacedConfigMap: async () => {},
        deleteNamespacedSecret: async () => {},
      })
      const pending = worker.cleanupRun(spec)
      const expectation = expect(pending).rejects.toThrow(/failed to clean K3s Job/)
      await vi.advanceTimersByTimeAsync(50)
      await expectation
    } finally { vi.useRealTimers() }
  })

})
