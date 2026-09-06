import { describe, expect, it, vi } from 'vitest'
import { API_PROBE_SCRIPT, PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import type { PactFlowK3sRunSpec } from '../src/types.ts'
import type { V1Job, V1Secret } from '@kubernetes/client-node'

const spec: PactFlowK3sRunSpec = {
  jobUid: 'cleanup-job-uid', runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64), specDigest: '3'.repeat(64),
  templateId: 'dsh', namespace: 'pactflow', jobName: 'dsh-pf-cleanup', configMapName: 'dsh-pf-cleanup',
  image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull',
  harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
  modelSecretName: 'dsh-pf-cleanup-model', ephemeralModelSecret: true, gitSecretName: 'git-secret',
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
  activeDeadlineSeconds: 600, finishedJobTtlSeconds: 86_400,
}

function worker(): PactFlowK3sWorker {
  return new PactFlowK3sWorker({
    namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [],
  })
}

function ownedResource(instance: PactFlowK3sWorker, uid: string, ownerUid = spec.jobUid) {
  return { metadata: { uid, labels: Reflect.get(instance, 'labels').call(instance, spec),
    annotations: Reflect.get(instance, 'annotations').call(instance, spec),
    ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: ownerUid, controller: true }] } }
}

const probeTemplate = {
  id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/worker@sha256:${'b'.repeat(64)}`,
  model: 'model', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
}

function probeWorker(): PactFlowK3sWorker {
  const config: PactFlowK3sConfig = {
    namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250,
    templates: [probeTemplate],
  }
  return new PactFlowK3sWorker(config)
}

describe('PactFlow K3s cleanup', () => {
  it.each(['harness-log', 'harness-encoded', 'harness-error', 'harness-truncated', 'api-log', 'api-encoded', 'api-error', 'api-truncated'] as const)(
    'does not return the known model credential from %s', async mode => {
      const instance = probeWorker()
      const secret = 'sk-pf-isolated-sensitive-fixture-value'
      const encoded = Buffer.from(secret).toString('base64')
      Reflect.set(instance, 'batch', {
        createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
        readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
      })
      Reflect.set(instance, 'core', {
        createNamespacedSecret: vi.fn(async () => {
          if (mode.endsWith('error')) throw new Error(`rejected ${secret}`)
          if (mode.endsWith('truncated')) throw new Error(`${'x'.repeat(4080)}${secret}`)
          return { metadata: { uid: 'secret-uid' } }
        }), deleteNamespacedSecret: vi.fn(),
      })
      Reflect.set(instance, 'probeLog', vi.fn(async () => mode.endsWith('encoded') ? `data=${encoded}` : `debug=${secret}`))
      Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
      const result = mode.startsWith('api') ? await instance.probeApi('claude', 'hello', 10_000, secret)
        : await instance.probe('claude', 'hello', 10_000, secret)
      expect(JSON.stringify(result)).not.toContain(secret.slice(0, 6))
      expect(JSON.stringify(result)).not.toContain(encoded)
      expect(result.output).toContain('[redacted]')
    },
  )

  it('keeps the API probe request payload free of credential material', async () => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    const encoded = Buffer.from(secret).toString('base64')
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async () => {}),
      deleteNamespacedSecret: vi.fn(),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'ok'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = await instance.probeApi('claude', 'hello', 10_000, secret)
    expect(JSON.stringify(result.requestPayload)).not.toContain(secret)
    expect(JSON.stringify(result.requestPayload)).not.toContain(encoded)
    expect(JSON.stringify(result.requestPayload)).not.toMatch(/Authorization|authToken|api[_-]?key/i)
    const payload = JSON.parse(result.requestPayload) as Record<string, unknown>
    expect(Object.keys(payload).sort()).toEqual(expect.arrayContaining(['max_tokens', 'messages', 'model']))
    expect((payload.messages as never[]).every(item => JSON.stringify(item).includes('hello'))).toBe(true)
  })

  it('keeps credential values out of the API probe script surface and error path', async () => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    expect(API_PROBE_SCRIPT).toMatch(/os\.environ\['(ANTHROPIC_AUTH_TOKEN|OPENAI_API_KEY)'\]/)
    expect(API_PROBE_SCRIPT).not.toMatch(/print\s*\(\s*(str\()?headers/)
    expect(API_PROBE_SCRIPT).not.toMatch(/print\s*\(\s*request\)/)
    const apiResult = await (async () => {
      Reflect.set(instance, 'batch', {
        createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
        readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
      })
      Reflect.set(instance, 'core', {
        createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
        replaceNamespacedSecret: vi.fn(async () => {}),
        deleteNamespacedSecret: vi.fn(),
      })
      Reflect.set(instance, 'probeLog', vi.fn(async () => `HTTPError body echoed ${secret}`))
      Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
      return await instance.probeApi('claude', 'hello', 10_000, secret)
    })()
    expect(apiResult.success).toBe(true)
    expect(JSON.stringify(apiResult.stages)).not.toContain(secret)
    expect(apiResult.output).not.toContain(secret)
  })

  it.each(['harness', 'api'] as const)('binds the %s probe model Secret to its Job and plans a finished-Job TTL', async kind => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    const jobBodies: V1Job[] = []
    let jobName = ''
    let replaced: { name?: string; ownerName?: string; ownerUid?: string; controller?: boolean } | undefined
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => {
        jobName = body.metadata?.name ?? ''; jobBodies.push(body); return { metadata: { uid: 'probe-job-uid' } }
      }),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => {
        const owner = body.metadata?.ownerReferences?.[0]
        replaced = { name: body.metadata?.name, ownerName: owner?.name, ownerUid: owner?.uid, controller: owner?.controller }
      }),
      deleteNamespacedSecret: vi.fn(),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'hi'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = kind === 'api' ? await instance.probeApi('claude', 'hello', 10_000, secret)
      : await instance.probe('claude', 'hello', 10_000, secret)
    expect(result.success).toBe(true)
    expect(jobBodies.every(body => body.spec?.ttlSecondsAfterFinished === 3_600)).toBe(true)
    expect(replaced).toMatchObject({ name: `${jobName}-model`, ownerName: jobName, ownerUid: 'probe-job-uid', controller: true })
  })

  it('keeps the harness probe result and cleanup when the Secret owner binding fails', async () => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    const deleteSecret = vi.fn()
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async () => { throw new Error('Secret replace conflict') }),
      deleteNamespacedSecret: deleteSecret,
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'hi'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = await instance.probe('claude', 'hello', 10_000, secret)
    expect(result.success).toBe(true)
    expect(deleteSecret).toHaveBeenCalledTimes(1)
  })

  it('plans a finished-Job TTL for the image probe', async () => {
    const instance = probeWorker()
    const jobBodies: V1Job[] = []
    let jobName = ''
    const owned = () => ({ metadata: { name: 'owned', uid: 'owned-uid',
      ownerReferences: [{ kind: 'Job', name: jobName, uid: 'probe-job-uid', controller: true }] } })
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => {
        jobName = body.metadata?.name ?? ''; jobBodies.push(body); return { metadata: { uid: 'probe-job-uid' } }
      }),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      listNamespacedPod: vi.fn(async () => ({ items: [owned()] })),
      readNamespacedPodLog: vi.fn(async () => 'claude 1.0'),
      readNamespacedPod: vi.fn(async () => owned()),
      deleteNamespacedPod: vi.fn(),
    })
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = await instance.probeImage('claude', 10_000)
    expect(result.success).toBe(true)
    expect(jobBodies[0]?.spec?.ttlSecondsAfterFinished).toBe(3_600)
  })

  it.each(['foreign-only', 'foreign-first', 'replaced', 'replaced-job'] as const)('binds probe logs to the exact controller and Pod: %s', async mode => {
    const instance = probeWorker()
    let jobName = ''
    const owned = () => ({ metadata: { name: 'owned', uid: 'owned-uid', ownerReferences: [
      { kind: 'Job', name: jobName, uid: 'probe-job-uid', controller: true },
    ] } })
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async ({ body }) => { jobName = body.metadata.name; return { metadata: { uid: 'probe-job-uid' } } }),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: mode === 'replaced-job' ? 'replacement-job' : 'probe-job-uid' },
        status: { succeeded: 1 } })), deleteNamespacedJob: vi.fn(),
    })
    const readLog = vi.fn(async ({ name }) => name === 'owned' ? 'verified log' : 'foreign log')
    const removePod = vi.fn()
    Reflect.set(instance, 'core', {
      listNamespacedPod: vi.fn(async () => ({ items: [
        { metadata: { name: 'foreign', uid: 'foreign-uid', ownerReferences: [
          { kind: 'Job', name: jobName, uid: 'another-job', controller: true },
        ] } }, ...(mode === 'foreign-only' ? [] : [owned()]),
      ] })),
      readNamespacedPodLog: readLog,
      readNamespacedPod: vi.fn(async () => mode === 'replaced' ? { metadata: { ...owned().metadata, uid: 'replacement-uid' } } : owned()),
      deleteNamespacedPod: removePod,
    })
    const result = await instance.probeImage('claude', 10_000)
    expect(result.success).toBe(mode === 'foreign-first')
    if (mode === 'foreign-only' || mode === 'replaced-job') expect(readLog).not.toHaveBeenCalled()
    else expect(readLog).toHaveBeenCalledWith(expect.objectContaining({ name: 'owned' }), expect.anything())
    expect(removePod.mock.calls.every(([request]) => request.name === 'owned')).toBe(true)
  })

  it('rejects an API probe with empty response evidence', async () => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => '  \n'))
    const cleanup = vi.fn(async () => 0)
    Reflect.set(instance, 'cleanupProbeResources', cleanup)
    expect((await instance.probeApi('claude', 'hello', 10_000)).success).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(1)
  })

  it.each(['harness', 'api', 'image'] as const)('rejects a %s success without a probe Pod', async kind => {
    const instance = probeWorker()
    const removeJob = vi.fn(async () => {})
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
      deleteNamespacedJob: removeJob,
    })
    const readLog = vi.fn(async () => 'not a real probe result')
    Reflect.set(instance, 'core', { listNamespacedPod: vi.fn(async () => ({ items: [] })), readNamespacedPodLog: readLog })
    const result = kind === 'image' ? await instance.probeImage('claude', 10_000)
      : kind === 'api' ? await instance.probeApi('claude', 'hello', 10_000)
        : await instance.probe('claude', 'hello', 10_000)
    expect(result.success).toBe(false)
    expect(result.output).toContain('Pod was not found')
    expect(readLog).not.toHaveBeenCalled()
    expect(removeJob).toHaveBeenCalledTimes(1)
  })

  it.each(['bad-hash', '409', '500', '404'] as const)('enforces ConfigMap cleanup failure semantics: %s', async variant => {
    const instance = worker()
    const notFound = async (): Promise<never> => { throw Object.assign(new Error('not found'), { code: 404 }) }
    const resource = ownedResource(instance, 'config-uid')
    if (variant === 'bad-hash') resource.metadata.annotations['pactflow.dev/spec-digest'] = 'f'.repeat(64)
    const deleteJob = vi.fn(async () => {})
    const deleteConfig = vi.fn(async () => { throw Object.assign(new Error('delete response'), { code: Number(variant) }) })
    Reflect.set(instance, 'batch', { readNamespacedJob: notFound, deleteNamespacedJob: deleteJob })
    Reflect.set(instance, 'core', { readNamespacedConfigMap: async () => resource, readNamespacedSecret: notFound,
      listNamespacedPod: async () => ({ items: [] }), deleteNamespacedConfigMap: deleteConfig })
    if (variant === '404') {
      await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()
      expect(deleteJob).toHaveBeenCalledTimes(1)
    } else {
      await expect(instance.cleanupRun(spec)).rejects.toThrow(/identity|failed to clean/)
      expect(deleteJob).not.toHaveBeenCalled()
    }
    if (variant === 'bad-hash') expect(deleteConfig).not.toHaveBeenCalled()
    else expect(deleteConfig).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'config-uid' } } }), expect.anything())
  })

  it.each(['wrong-hash', 'uid-conflict'] as const)('keeps the Job when owned Pod cleanup encounters %s', async variant => {
    const instance = worker()
    const notFound = async (): Promise<never> => { throw Object.assign(new Error('not found'), { code: 404 }) }
    const resource = ownedResource(instance, 'pod-uid')
    if (variant === 'wrong-hash') resource.metadata.annotations['pactflow.dev/spec-digest'] = 'f'.repeat(64)
    const deleteJob = vi.fn()
    const deletePod = vi.fn(async () => { throw Object.assign(new Error('UID precondition failed'), { code: 409 }) })
    Reflect.set(instance, 'batch', { readNamespacedJob: notFound, deleteNamespacedJob: deleteJob })
    Reflect.set(instance, 'core', {
      readNamespacedConfigMap: notFound, readNamespacedSecret: notFound,
      listNamespacedPod: async () => ({ items: [{ metadata: { ...resource.metadata, name: 'owned-pod' } }] }),
      deleteNamespacedPod: deletePod,
    })
    await expect(instance.cleanupRun(spec)).rejects.toThrow(/identity|failed to clean/)
    expect(deleteJob).not.toHaveBeenCalled()
    if (variant === 'wrong-hash') expect(deletePod).not.toHaveBeenCalled()
    else expect(deletePod).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'pod-uid' } } }), expect.anything())
  })

  it('deletes owned children before the Job while preserving foreign and historical Pods', async () => {
    const instance = worker()
    const order: string[] = []
    Reflect.set(instance, 'core', {
      readNamespacedConfigMap: vi.fn(async () => ownedResource(instance, 'config-uid')),
      readNamespacedSecret: vi.fn(async () => ownedResource(instance, 'secret-uid')),
      listNamespacedPod: vi.fn(async () => ({ items: [
        { metadata: { ...ownedResource(instance, 'pod-uid').metadata, name: 'owned-pod' } },
        { metadata: { ...ownedResource(instance, 'foreign-uid', 'another-job').metadata, name: 'foreign-pod' } },
        ...Array.from({ length: 34 }, (_, index) => ({ metadata: { name: `historical-${index}`, uid: `old-${index}` } })),
      ] })),
      deleteNamespacedPod: vi.fn(async () => { order.push('pod') }),
      deleteNamespacedConfigMap: vi.fn(async () => { order.push('configmap') }),
      deleteNamespacedSecret: vi.fn(async () => { order.push('secret') }),
    })
    Reflect.set(instance, 'batch', {
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: spec.jobUid,
        labels: Reflect.get(instance, 'labels').call(instance, spec), annotations: Reflect.get(instance, 'annotations').call(instance, spec) } })),
      deleteNamespacedJob: vi.fn(async () => {
        if (!order.includes('configmap') || !order.includes('secret')) {
          throw Object.assign(new Error('owner dependents are still deleting'), { code: 409 })
        }
        order.push('job')
      }),
    })

    await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()
    expect(order).toEqual(['configmap', 'secret', 'pod', 'job'])
    expect(Reflect.get(instance, 'core').deleteNamespacedPod).toHaveBeenCalledTimes(1)
    expect(Reflect.get(instance, 'core').deleteNamespacedPod).toHaveBeenCalledWith(expect.objectContaining({ name: 'owned-pod', body: { preconditions: { uid: 'pod-uid' } } }), expect.anything())
    expect(Reflect.get(instance, 'core').deleteNamespacedConfigMap).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'config-uid' } } }), expect.anything())
    expect(Reflect.get(instance, 'core').deleteNamespacedSecret).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'secret-uid' } } }), expect.anything())
    expect(Reflect.get(instance, 'batch').deleteNamespacedJob).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: spec.jobUid } } }), expect.anything())
  })

  it('treats already-missing child resources and Job as clean', async () => {
    const instance = worker()
    const notFound = (): Promise<never> => Promise.reject(Object.assign(new Error('not found'), { code: 404 }))
    Reflect.set(instance, 'core', {
      readNamespacedConfigMap: vi.fn(notFound), readNamespacedSecret: vi.fn(notFound),
      listNamespacedPod: vi.fn(async () => ({ items: [] })),
      deleteNamespacedConfigMap: vi.fn(notFound), deleteNamespacedSecret: vi.fn(notFound),
    })
    Reflect.set(instance, 'batch', { readNamespacedJob: vi.fn(notFound), deleteNamespacedJob: vi.fn(notFound) })


    await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()
  })

  it('refuses persisted cleanup and cancellation without ownership identity', async () => {
    const instance = worker()
    const remove = vi.fn(async () => {})
    Reflect.set(instance, 'batch', { deleteNamespacedJob: remove })
    Reflect.set(instance, 'core', { deleteNamespacedConfigMap: remove, deleteNamespacedSecret: remove })
    const incomplete = { ...spec }
    Reflect.deleteProperty(incomplete, 'jobUid')
    await expect(instance.cleanupRun(incomplete)).rejects.toThrow(/identity/)
    await expect(instance.cancelRun(incomplete)).rejects.toThrow(/identity/)
    expect(remove).not.toHaveBeenCalled()
  })

  it('does not delete replaced children when the original Job has disappeared', async () => {
    const instance = worker()
    const remove = vi.fn()
    Reflect.set(instance, 'batch', {
      readNamespacedJob: async () => { throw Object.assign(new Error('not found'), { code: 404 }) },
      deleteNamespacedJob: remove,
    })
    Reflect.set(instance, 'core', { readNamespacedConfigMap: async () => ownedResource(instance, 'foreign-config', 'another-job'),
      deleteNamespacedConfigMap: remove, deleteNamespacedSecret: remove })
    await expect(instance.cleanupRun(spec)).rejects.toThrow(/child resource identity/)
    expect(remove).not.toHaveBeenCalled()
  })

  it('deletes only UID-bound probe Pods before their short-lived Job', async () => {
    const instance = worker()
    const order: string[] = []
    Reflect.set(instance, 'batch', {
      deleteNamespacedJob: vi.fn(async ({ body }) => { expect(body.preconditions.uid).toBe('probe-job-uid'); order.push('job') }),
    })
    Reflect.set(instance, 'core', {
      listNamespacedPod: vi.fn(async () => ({
        items: [{ metadata: { name: 'dsh-pf-image-test-pod', uid: 'probe-pod-uid', ownerReferences: [
          { kind: 'Job', name: 'dsh-pf-image-test', uid: 'probe-job-uid', controller: true },
        ] } }, { metadata: { name: 'foreign-pod', uid: 'foreign-uid', ownerReferences: [
          { kind: 'Job', name: 'dsh-pf-image-test', uid: 'another-job', controller: true },
        ] } }, { metadata: { name: 'unowned-pod', uid: 'unowned-uid' } }],
      })),
      deleteNamespacedPod: vi.fn(async ({ name, body }) => { expect(body.preconditions.uid).toBe('probe-pod-uid'); order.push(`pod:${name}`) }),
    })
    const cleanup = Reflect.get(instance, 'cleanupProbeResources') as undefined | ((jobName: string, jobUid: string) => Promise<void>)

    expect(cleanup).toBeTypeOf('function')
    await cleanup?.call(instance, 'dsh-pf-image-test', 'probe-job-uid')
    expect(order).toEqual(['pod:dsh-pf-image-test-pod', 'job'])
  })

  it.each(['missing-job-uid', 'missing-pod-uid', 'pod-delete-failure'] as const)('fails probe cleanup closed for %s', async mode => {
    const instance = worker()
    const removeJob = vi.fn()
    const removePod = vi.fn(async () => { if (mode === 'pod-delete-failure') throw new Error('delete failed') })
    const list = vi.fn(async () => ({ items: [{ metadata: { name: 'owned',
      ...(mode === 'missing-pod-uid' ? {} : { uid: 'pod-uid' }),
      ownerReferences: [{ kind: 'Job', controller: true, name: 'probe', uid: 'job-uid' }],
    } }] }))
    Reflect.set(instance, 'batch', { deleteNamespacedJob: removeJob })
    Reflect.set(instance, 'core', { listNamespacedPod: list, deleteNamespacedPod: removePod })
    await expect(Reflect.get(instance, 'cleanupProbeResources').call(instance, 'probe',
      mode === 'missing-job-uid' ? undefined : 'job-uid')).rejects.toThrow(/UID|failed/)
    expect(removeJob).not.toHaveBeenCalled()
    expect(removePod).toHaveBeenCalledTimes(mode === 'pod-delete-failure' ? 1 : 0)
    if (mode === 'missing-job-uid') expect(list).not.toHaveBeenCalled()
  })

  it.each([
    ['Harness', (instance: PactFlowK3sWorker) => instance.probe('claude', 'hello', 10_000, 'secret-api-key')],
    ['API', (instance: PactFlowK3sWorker) => instance.probeApi('claude', 'hello', 10_000, 'secret-api-key')],
  ])('fails the %s probe when its ephemeral model Secret cannot be removed', async (_name, run) => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => ({ metadata: { uid: 'probe-secret-uid' } })),
      deleteNamespacedSecret: vi.fn(async () => { throw new Error('delete failed') }),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))

    const result = await run(instance)

    expect(result.success).toBe(false)
    expect(result.stages).toContainEqual(expect.objectContaining({
      name: 'cleanup', state: 'failed',
    }))
  })

  it('fails the image probe when its Job or Pods cannot be removed', async () => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => { throw new Error('cleanup failed') }))

    const result = await instance.probeImage('claude', 10_000)

    expect(result.success).toBe(false)
    expect(result.stages).toContainEqual(expect.objectContaining({ name: 'cleanup', state: 'failed' }))
  })

  it.each(['harness-known', 'harness-unknown', 'harness-conflict', 'api-known', 'api-unknown', 'api-conflict'] as const)(
    'deletes only a confirmed ephemeral Secret: %s', async mode => {
      const instance = probeWorker()
      const createJob = vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } }))
      const removeSecret = vi.fn(async () => {})
      Reflect.set(instance, 'batch', { createNamespacedJob: createJob,
        readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })) })
      Reflect.set(instance, 'core', {
        createNamespacedSecret: vi.fn(async () => {
          if (mode.endsWith('conflict')) throw Object.assign(new Error('already exists'), { code: 409 })
          return mode.endsWith('-known') ? { metadata: { uid: 'secret-uid' } } : {}
        }),
        deleteNamespacedSecret: removeSecret,
      })
      Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
      Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
      const result = mode.startsWith('harness')
        ? await instance.probe('claude', 'hello', 10_000, 'isolated-test-value')
        : await instance.probeApi('claude', 'hello', 10_000, 'isolated-test-value')
      if (mode.endsWith('-known')) {
        expect(result.success).toBe(true)
        expect(removeSecret).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'secret-uid' } } }), expect.anything())
      } else {
        expect(result.success).toBe(false)
        expect(removeSecret).not.toHaveBeenCalled()
        expect(createJob).not.toHaveBeenCalled()
      }
    },
  )

  it('treats an already-missing ephemeral model Secret as clean', async () => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => ({ metadata: { uid: 'probe-secret-uid' } })),
      deleteNamespacedSecret: vi.fn(async () => { throw Object.assign(new Error('not found'), { code: 404 }) }),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))

    const result = await instance.probeApi('claude', 'hello', 10_000, 'secret-api-key')

    expect(result.success).toBe(true)
    expect(result.stages).not.toContainEqual(expect.objectContaining({ name: 'cleanup', state: 'failed' }))
  })

  it('records intent before creation, confirmation after identities, and removal after cleanup', async () => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    const events: unknown[] = []
    let jobName = ''
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => {
        jobName = body.metadata?.name ?? ''
        return { ...body, metadata: { ...body.metadata, uid: 'probe-job-uid' } }
      }),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async () => {}),
      deleteNamespacedSecret: vi.fn(),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'hi'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = await instance.probe('claude', 'hello', 10_000, secret, new AbortController().signal, async event => {
      events.push(event)
    })
    expect(result.success).toBe(true)
    expect(events).toEqual([
      { phase: 'intent', jobName, secretName: `${jobName}-model` },
      { phase: 'confirmed', jobName, jobUid: 'probe-job-uid', secretName: `${jobName}-model`, secretUid: 'secret-uid' },
      { phase: 'cleaned', jobName },
    ])
  })

  it('creates no resources when the cleanup responsibility cannot be persisted', async () => {
    const instance = probeWorker()
    const createSecret = vi.fn()
    const createJob = vi.fn()
    Reflect.set(instance, 'batch', { createNamespacedJob: createJob })
    Reflect.set(instance, 'core', { createNamespacedSecret: createSecret })
    const result = await instance.probe('claude', 'hello', 10_000, 'isolated-test-value',
      new AbortController().signal, async () => { throw new Error('ledger is read-only') })
    expect(result.success).toBe(false)
    expect(createSecret).not.toHaveBeenCalled()
    expect(createJob).not.toHaveBeenCalled()
  })

  it('keeps the ledger entry when confirmed cleanup fails instead of reporting cleaned', async () => {
    const instance = probeWorker()
    const events: unknown[] = []
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' } })),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => ({ metadata: { uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async () => {}),
      deleteNamespacedSecret: vi.fn(),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'hi'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => { throw new Error('cleanup failed') }))
    const result = await instance.probe('claude', 'hello', 10_000, 'isolated-test-value',
      new AbortController().signal, async event => { events.push(event) })
    expect(result.success).toBe(false)
    expect(events).toEqual([
      expect.objectContaining({ phase: 'intent' }),
      expect.objectContaining({ phase: 'confirmed', jobUid: 'probe-job-uid' }),
    ])
  })

  it.each(['full', 'missing-job-uid', 'missing-secret-uid', 'secret-delete-error'] as const)(
    'enforces probe identity recovery semantics: %s', async mode => {
      const instance = probeWorker()
      const removeSecret = vi.fn(async () => {
        if (mode === 'secret-delete-error') throw new Error('Secret delete forbidden')
      })
      const cleanupResources = vi.fn(async () => 1)
      Reflect.set(instance, 'core', { deleteNamespacedSecret: removeSecret })
      Reflect.set(instance, 'cleanupProbeResources', cleanupResources)
      const identity = {
        jobName: 'dsh-pf-probe-recover',
        ...(mode === 'missing-job-uid' ? {} : { jobUid: 'probe-job-uid' }),
        secretName: 'dsh-pf-probe-recover-model',
        ...(mode === 'missing-secret-uid' ? {} : { secretUid: 'probe-secret-uid' }),
      }
      if (mode === 'missing-job-uid' || mode === 'missing-secret-uid') {
        await expect(instance.cleanupProbeIdentity(identity)).rejects.toThrow('confirmed')
        expect(removeSecret).not.toHaveBeenCalled()
        expect(cleanupResources).not.toHaveBeenCalled()
        return
      }
      if (mode === 'secret-delete-error') {
        await expect(instance.cleanupProbeIdentity(identity)).rejects.toThrow('Secret delete forbidden')
        expect(cleanupResources).not.toHaveBeenCalled()
        return
      }
      await expect(instance.cleanupProbeIdentity(identity)).resolves.toBeUndefined()
      expect(removeSecret).toHaveBeenCalledWith(expect.objectContaining({
        body: { preconditions: { uid: 'probe-secret-uid' } },
      }), expect.anything())
      expect(cleanupResources).toHaveBeenCalledWith('dsh-pf-probe-recover', 'probe-job-uid')
    },
  )

  it.each(['harness-secret', 'harness-job', 'image-job'] as const)(
    'retains the probe ledger entry when a hung %s creation passes its deadline', async mode => {
      vi.useFakeTimers()
      try {
        const instance = probeWorker()
        Reflect.set(instance, 'requestTimeoutMs', 20)
        const events: unknown[] = []
        const record = async (event: unknown): Promise<void> => { events.push(event) }
        const hang = () => new Promise<never>(() => {})
        if (mode === 'image-job') {
          Reflect.set(instance, 'batch', { createNamespacedJob: hang })
        } else {
          Reflect.set(instance, 'batch', {
            createNamespacedJob: mode === 'harness-job' ? hang
              : vi.fn(async ({ body }: { body: V1Job }) => ({ ...body, metadata: { ...body.metadata, uid: 'probe-job-uid' } })),
          })
          Reflect.set(instance, 'core', {
            createNamespacedSecret: mode === 'harness-secret' ? hang
              : vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
            replaceNamespacedSecret: vi.fn(async () => {}),
            deleteNamespacedSecret: vi.fn(),
          })
        }
        Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
        const pending = mode === 'image-job'
          ? instance.probeImage('claude', 10_000, new AbortController().signal, record)
          : mode === 'harness-job'
            ? instance.probe('claude', 'hello', 10_000, 'isolated-test-value', new AbortController().signal, record)
            : instance.probe('claude', 'hello', 10_000, 'isolated-test-value', new AbortController().signal, record)
        await vi.advanceTimersByTimeAsync(50)
        const result = await pending
        expect(result.success).toBe(false)
        expect(events).toEqual([expect.objectContaining({ phase: 'intent' })])
      } finally { vi.useRealTimers() }
    },
  )

  it.each(['harness', 'api'] as const)('carries the %s probe model credential only through a Secret reference', async kind => {
    const instance = probeWorker()
    const secret = 'sk-pf-isolated-sensitive-fixture-value'
    const jobBodies: V1Job[] = []
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => { jobBodies.push(body); return { metadata: { uid: 'probe-job-uid' } } }),
      readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async ({ body }: { body: V1Secret }) => ({ ...body, metadata: { ...body.metadata, uid: 'secret-uid' } })),
      replaceNamespacedSecret: vi.fn(async () => {}),
      deleteNamespacedSecret: vi.fn(),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'hi'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))
    const result = kind === 'api' ? await instance.probeApi('claude', 'hello', 10_000, secret)
      : await instance.probe('claude', 'hello', 10_000, secret)
    expect(result.success).toBe(true)
    for (const body of jobBodies) {
      const spec = JSON.stringify(body)
      expect(spec).not.toContain(secret)
      expect(spec).toContain('secretKeyRef')
    }
  })

  it('keeps raw model credentials out of the run Job spec', () => {
    const worker = probeWorker()
    const runSpec = { ...worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000,
      { remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
        baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/isolated-k3s-binding-test',
        validationCommands: [] }, 'task'), ephemeralModelSecret: true }
    const body = JSON.stringify(Reflect.get(worker, 'job').call(worker, runSpec))
    expect(body).toContain('secretKeyRef')
    expect(body).not.toMatch(/sk-[A-Za-z0-9-]+/)
    expect(body).not.toContain('apiKey')
  })

  it('keeps the ledger entry when the probe Job deletion hangs past its deadline', async () => {
    vi.useFakeTimers()
    try {
      const instance = probeWorker()
      Reflect.set(instance, 'requestTimeoutMs', 20)
      const events: unknown[] = []
      const record = async (event: unknown): Promise<void> => { events.push(event) }
      Reflect.set(instance, 'batch', {
        createNamespacedJob: vi.fn(async ({ body }: { body: V1Job }) => ({ ...body, metadata: { ...body.metadata, uid: 'probe-job-uid' } })),
        readNamespacedJob: vi.fn(async () => ({ metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } })),
        deleteNamespacedJob: () => new Promise<never>(() => {}),
      })
      Reflect.set(instance, 'core', {
        listNamespacedPod: vi.fn(async () => ({ items: [] })),
      })
      const pending = instance.probeImage('claude', 10_000, new AbortController().signal, record)
      await vi.advanceTimersByTimeAsync(50)
      const result = await pending
      expect(result.success).toBe(false)
      expect(events).toEqual([
        expect.objectContaining({ phase: 'intent' }),
        expect.objectContaining({ phase: 'confirmed' }),
      ])
    } finally { vi.useRealTimers() }
  })
})
