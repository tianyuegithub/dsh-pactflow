import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import type { PactFlowK3sRunSpec } from '../src/types.ts'

const spec: PactFlowK3sRunSpec = {
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
  it('deletes owner-referenced ConfigMap and Secret before deleting the Job', async () => {
    const instance = worker()
    const order: string[] = []
    Reflect.set(instance, 'core', {
      deleteNamespacedConfigMap: vi.fn(async () => { order.push('configmap') }),
      deleteNamespacedSecret: vi.fn(async () => { order.push('secret') }),
    })
    Reflect.set(instance, 'batch', {
      deleteNamespacedJob: vi.fn(async () => {
        if (!order.includes('configmap') || !order.includes('secret')) {
          throw Object.assign(new Error('owner dependents are still deleting'), { code: 409 })
        }
        order.push('job')
      }),
    })

    await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()
    expect(order).toEqual(['configmap', 'secret', 'job'])
  })

  it('treats already-missing child resources and Job as clean', async () => {
    const instance = worker()
    const notFound = (): Promise<never> => Promise.reject(Object.assign(new Error('not found'), { code: 404 }))
    Reflect.set(instance, 'core', {
      deleteNamespacedConfigMap: vi.fn(notFound), deleteNamespacedSecret: vi.fn(notFound),
    })
    Reflect.set(instance, 'batch', { deleteNamespacedJob: vi.fn(notFound) })

    await expect(instance.cleanupRun(spec)).resolves.toBeUndefined()
  })

  it('deletes terminal probe Pods after deleting their short-lived Job', async () => {
    const instance = worker()
    const order: string[] = []
    Reflect.set(instance, 'batch', {
      deleteNamespacedJob: vi.fn(async () => { order.push('job') }),
    })
    Reflect.set(instance, 'core', {
      listNamespacedPod: vi.fn(async () => ({
        items: [{ metadata: { name: 'dsh-pf-image-test-pod' } }],
      })),
      deleteNamespacedPod: vi.fn(async ({ name }: { readonly name: string }) => { order.push(`pod:${name}`) }),
    })
    const cleanup = Reflect.get(instance, 'cleanupProbeResources') as undefined | ((jobName: string) => Promise<void>)

    expect(cleanup).toBeTypeOf('function')
    await cleanup?.call(instance, 'dsh-pf-image-test')
    expect(order).toEqual(['job', 'pod:dsh-pf-image-test-pod'])
  })

  it.each([
    ['Harness', (instance: PactFlowK3sWorker) => instance.probe('claude', 'hello', 10_000, 'secret-api-key')],
    ['API', (instance: PactFlowK3sWorker) => instance.probeApi('claude', 'hello', 10_000, 'secret-api-key')],
  ])('fails the %s probe when its ephemeral model Secret cannot be removed', async (_name, run) => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => {}),
      readNamespacedJob: vi.fn(async () => ({ status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => {}),
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
      createNamespacedJob: vi.fn(async () => {}),
      readNamespacedJob: vi.fn(async () => ({ status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => { throw new Error('cleanup failed') }))

    const result = await instance.probeImage('claude', 10_000)

    expect(result.success).toBe(false)
    expect(result.stages).toContainEqual(expect.objectContaining({ name: 'cleanup', state: 'failed' }))
  })

  it('treats an already-missing ephemeral model Secret as clean', async () => {
    const instance = probeWorker()
    Reflect.set(instance, 'batch', {
      createNamespacedJob: vi.fn(async () => {}),
      readNamespacedJob: vi.fn(async () => ({ status: { succeeded: 1 } })),
    })
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => {}),
      deleteNamespacedSecret: vi.fn(async () => { throw Object.assign(new Error('not found'), { code: 404 }) }),
    })
    Reflect.set(instance, 'probeLog', vi.fn(async () => 'probe completed'))
    Reflect.set(instance, 'cleanupProbeResources', vi.fn(async () => 1))

    const result = await instance.probeApi('claude', 'hello', 10_000, 'secret-api-key')

    expect(result.success).toBe(true)
    expect(result.stages).not.toContainEqual(expect.objectContaining({ name: 'cleanup', state: 'failed' }))
  })
})
