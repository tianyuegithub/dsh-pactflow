import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { artifactStoreEnv, logSummary, uploadWorkerLog } from '../src/worker/log-upload.ts'
import { PactFlowArtifactStoreClient } from '../src/artifact-store.ts'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'

describe('PactFlow worker log upload', () => {
  const closers: Array<() => Promise<void>> = []
  afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())) })

  async function fakeStore() {
    const objects = new Map<string, Buffer>()
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
      const key = decodeURIComponent(url.pathname).replace(/^\/store-bucket\/?/, '')
      if (request.method === 'PUT' && key.length > 0) {
        const chunks: Buffer[] = []
        request.on('data', chunk => chunks.push(chunk))
        request.on('end', () => {
          const content = Buffer.concat(chunks)
          objects.set(key, content)
          response.setHeader('etag', `"${createHash('sha256').update(content).digest('hex')}"`)
          response.statusCode = 200
          response.end()
        })
        return
      }
      const stored = objects.get(key)
      if (request.method === 'GET' && stored !== undefined) {
        response.setHeader('etag', `"${createHash('sha256').update(stored).digest('hex')}"`)
        response.setHeader('content-length', String(stored.byteLength))
        response.end(stored)
        return
      }
      response.statusCode = stored === undefined ? 404 : 200
      response.end()
    })
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
    closers.push(() => new Promise<void>(resolve => server.close(() => resolve())))
    return {
      objects,
      endpoint: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`,
    }
  }

  const boundEnv = (endpoint: string) => ({
    PACTFLOW_ARTIFACT_ENDPOINT: endpoint, PACTFLOW_ARTIFACT_BUCKET: 'store-bucket',
    PACTFLOW_ARTIFACT_ACCESS_KEY_ID: 'test-ak', PACTFLOW_ARTIFACT_SECRET_ACCESS_KEY: 'test-sk',
  })

  it('returns undefined for an unbound run (zero behavior change)', async () => {
    expect(artifactStoreEnv({})).toBeUndefined()
    expect(await uploadWorkerLog({ key: 'a/b.txt', content: 'x', env: {} })).toBeUndefined()
  })

  it('uploads the full log and returns a verifiable artifactRef', async () => {
    const store = await fakeStore()
    const content = 'line one\nline two\nall done\n'
    const refJson = await uploadWorkerLog({ key: 'pactflow-logs/run-1/0-execution-log-runner-aa.txt', content, env: boundEnv(store.endpoint) })
    expect(refJson).toBeDefined()
    const ref = JSON.parse(refJson!) as { uri: string; bytes: number; hash: string }
    expect(ref.bytes).toBe(Buffer.byteLength(content))
    expect(new TextDecoder().decode(store.objects.get('pactflow-logs/run-1/0-execution-log-runner-aa.txt')!)).toBe(content)
    const client = new PactFlowArtifactStoreClient({
      endpoint: store.endpoint, bucket: 'store-bucket', region: 'us-east-1',
      accessKeyId: 'test-ak', secretAccessKey: 'test-sk',
    })
    const resolved = await client.resolveArtifact(JSON.parse(refJson!))
    expect(Buffer.from(resolved).toString('utf8')).toBe(content)
  })

  it('refuses to upload logs that contain credential patterns (no object created)', async () => {
    const store = await fakeStore()
    await expect(uploadWorkerLog({
      key: 'pactflow-logs/run-1/0-execution-log-runner-bb.txt',
      content: 'error: password=hunter2secret in config',
      env: boundEnv(store.endpoint),
    })).rejects.toMatchObject({ reason: /key\/value/ })
    expect(store.objects.size).toBe(0)
  })

  it('builds a one-line byte-bounded summary', () => {
    expect(logSummary('first\nsecond')).toBe('first')
    expect(logSummary('\n\nsecond')).toBe('second')
    expect(logSummary('x'.repeat(2000))).toHaveLength(1024)
  })
})

describe('PactFlow worker container log tail (degraded forensics)', () => {
  function worker(): PactFlowK3sWorker {
    const template = {
      id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
      image: `registry.invalid/pactflow-worker@sha256:${'a'.repeat(64)}`,
      model: 'm', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
      cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
    }
    return new PactFlowK3sWorker({ namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [template] } as PactFlowK3sConfig)
  }

  it('reads the worker container tail bounded by the given budget', async () => {
    const workerInstance = worker()
    const runSpec = workerInstance.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const specLabels = Reflect.get(workerInstance, 'labels').call(workerInstance, runSpec) as Record<string, string>
    const specAnnotations = Reflect.get(workerInstance, 'annotations').call(workerInstance, runSpec) as Record<string, string>
    const seen: Array<{ container?: string; limitBytes?: number }> = []
    Reflect.set(workerInstance, 'core', {
      listNamespacedPod: async () => ({ items: [{ metadata: { name: 'pod-a', uid: 'uid-a', labels: specLabels, annotations: specAnnotations } }] }),
      readNamespacedPodLog: async ({ container, limitBytes }: { container?: string; limitBytes?: number }) => {
        seen.push({ container, limitBytes })
        return 'tail of the log'
      },
      readNamespacedPod: async () => ({ metadata: { uid: 'uid-a' } }),
    })
    const tail = await workerInstance.workerLogTail(runSpec, 4_096)
    expect(tail).toBe('tail of the log')
    expect(seen[0]?.container).toBe('worker')
    expect(seen[0]?.limitBytes).toBe(4_096)
  })

  it('rejects a non-positive budget and pod identity drift', async () => {
    const workerInstance = worker()
    const runSpec = workerInstance.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const specLabels = Reflect.get(workerInstance, 'labels').call(workerInstance, runSpec) as Record<string, string>
    const specAnnotations = Reflect.get(workerInstance, 'annotations').call(workerInstance, runSpec) as Record<string, string>
    await expect(workerInstance.workerLogTail(runSpec, 0)).rejects.toThrow(/budget/)
    Reflect.set(workerInstance, 'core', {
      listNamespacedPod: async () => ({ items: [{ metadata: { name: 'pod-a', uid: 'uid-a', labels: specLabels, annotations: specAnnotations } }] }),
      readNamespacedPodLog: async () => 'tail',
      readNamespacedPod: async () => ({ metadata: { uid: 'uid-CHANGED' } }),
    })
    await expect(workerInstance.workerLogTail(runSpec, 1_024)).rejects.toThrow(/identity changed/)
  })
})
