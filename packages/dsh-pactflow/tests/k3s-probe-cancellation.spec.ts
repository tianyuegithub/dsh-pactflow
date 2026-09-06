import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker } from '../src/k3s-worker.ts'

describe.each(['harness', 'api', 'image'] as const)('PactFlow %s probe cancellation', kind => {
  it.each(kind === 'image' ? ['before', 'job', 'read', 'waiting', 'deadline'] : ['before', 'secret', 'job', 'read', 'waiting', 'deadline'])(
    'cleans only confirmed resources when cancelled at %s', async at => {
      const worker = new PactFlowK3sWorker({ namespace: 'test', imagePullSecret: 'pull', pollIntervalMs: 250,
        templates: [{ id: 'dsh', harness: 'dsh', apiMode: 'openai-chat-completions',
          image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, model: 'model', baseUrl: 'https://model.invalid',
          modelSecretName: 'shared-model', cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi' }] })
      const controller = new AbortController()
      const clock = at === 'deadline' ? vi.spyOn(performance, 'now').mockReturnValue(0) : undefined
      let enteredWait!: () => void
      let waitSettled = false
      const waiting = new Promise<void>(resolve => { enteredWait = resolve })
      if (at === 'waiting') {
        const originalDelay = Reflect.get(worker, 'delay').bind(worker)
        Reflect.set(worker, 'delay', (signal: AbortSignal) => {
          const result = originalDelay(signal).then(() => { waitSettled = true })
          enteredWait()
          return result
        })
      }
      const createJob = vi.fn(async () => {
        if (at === 'job') controller.abort()
        return { metadata: { uid: 'job-uid' } }
      })
      const readJob = vi.fn(async () => {
        if (at === 'read') controller.abort()
        if (at === 'waiting') return { metadata: { uid: 'job-uid' }, status: {} }
        if (at === 'deadline') clock!.mockReturnValue(10_000)
        return { metadata: { uid: 'job-uid' }, status: { succeeded: 1 } }
      })
      const createSecret = vi.fn(async () => {
        if (at === 'secret') controller.abort()
        return { metadata: { uid: 'secret-uid' } }
      })
      const deleteJob = vi.fn(async () => {})
      const deleteSecret = vi.fn(async () => {})
      Reflect.set(worker, 'batch', { createNamespacedJob: createJob, readNamespacedJob: readJob, deleteNamespacedJob: deleteJob })
      Reflect.set(worker, 'core', { createNamespacedSecret: createSecret, deleteNamespacedSecret: deleteSecret,
        listNamespacedPod: vi.fn(async () => ({ items: [] })) })
      Reflect.set(worker, 'probeLog', vi.fn(async () => 'completed'))
      if (at === 'before') controller.abort()
      try {
        const pending = kind === 'image' ? worker.probeImage('dsh', 10_000, controller.signal)
          : kind === 'api' ? worker.probeApi('dsh', 'hello', 10_000, 'isolated-test-value', controller.signal)
            : worker.probe('dsh', 'hello', 10_000, 'isolated-test-value', controller.signal)
        if (at === 'waiting') {
          await waiting
          controller.abort()
          await Promise.resolve()
          expect(waitSettled).toBe(true) // No timer advance: cancellation itself resolves the polling wait.
        }
        if (at === 'before') {
          await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
          expect(createJob).not.toHaveBeenCalled()
          expect(createSecret).not.toHaveBeenCalled()
          expect(deleteJob).not.toHaveBeenCalled()
          expect(deleteSecret).not.toHaveBeenCalled()
        } else {
          const result = await pending
          expect(result.success).toBe(false)
          if (at === 'deadline') expect(result.output).toContain('Host deadline')
          expect(readJob).toHaveBeenCalledTimes(['read', 'waiting', 'deadline'].includes(at) ? 1 : 0)
          expect(deleteJob).toHaveBeenCalledTimes(at === 'secret' ? 0 : 1)
          if (at !== 'secret') expect(deleteJob).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'job-uid' } } }), expect.anything())
          if (kind !== 'image') expect(deleteSecret).toHaveBeenCalledWith(expect.objectContaining({ body: { preconditions: { uid: 'secret-uid' } } }), expect.anything())
          else expect(deleteSecret).not.toHaveBeenCalled()
        }
      } finally { clock?.mockRestore() }
    },
  )
})
