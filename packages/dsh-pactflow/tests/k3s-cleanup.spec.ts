import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker } from '../src/k3s-worker.ts'
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
})
