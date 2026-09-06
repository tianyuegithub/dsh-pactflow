import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { PactFlowK3sWorker } from '../src/k3s-worker.ts'

it.each(['job', 'pod-list', 'pod-log'] as const)('aborts a real Kubernetes %s read and still cleans confirmed resources', async stage => {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-transport-'))
  let readStarted = false
  let readClosed = false
  let deletes = 0
  let jobName = ''
  let podLists = 0
  const server = createServer((request, response) => {
    request.resume()
    response.setHeader('content-type', 'application/json')
    if (request.method === 'POST') {
      response.writeHead(201)
      response.end(JSON.stringify({ apiVersion: 'batch/v1', kind: 'Job', metadata: { uid: 'probe-job-uid' } }))
    } else if (request.method === 'DELETE') {
      deletes++
      response.end(JSON.stringify({ apiVersion: 'v1', kind: 'Status', status: 'Success' }))
    } else if (request.url?.startsWith('/apis/batch/v1/namespaces/test/jobs/')) {
      jobName = request.url.split('?')[0]!.split('/').at(-1)!
      if (stage !== 'job') {
        response.end(JSON.stringify({ apiVersion: 'batch/v1', kind: 'Job', metadata: { uid: 'probe-job-uid' }, status: { succeeded: 1 } }))
        return
      }
    } else if (request.url?.split('?')[0] === '/api/v1/namespaces/test/pods') {
      podLists++
      if (stage !== 'pod-list' || podLists > 1) {
        response.end(JSON.stringify({ apiVersion: 'v1', kind: 'PodList', items: stage === 'pod-log' ? [
          { metadata: { name: 'probe-pod', uid: 'probe-pod-uid', ownerReferences: [
            { apiVersion: 'batch/v1', kind: 'Job', controller: true, name: jobName, uid: 'probe-job-uid' },
          ] } },
        ] : [] }))
        return
      }
    } else if (!request.url?.includes('/pods/probe-pod/log')) {
      response.writeHead(404)
      response.end('{}')
      return
    }
    if (request.method !== 'GET') return
    readStarted = true
    response.once('close', () => { readClosed = true })
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  let pending: Promise<unknown> | undefined
  try {
    const kubeconfig = join(root, 'kubeconfig.json')
    await writeFile(kubeconfig, JSON.stringify({ apiVersion: 'v1', kind: 'Config',
      clusters: [{ name: 'test', cluster: { server: `http://127.0.0.1:${(server.address() as AddressInfo).port}`,
        'insecure-skip-tls-verify': true } }],
      users: [{ name: 'test', user: {} }], contexts: [{ name: 'test', context: { cluster: 'test', user: 'test' } }],
      'current-context': 'test',
    }), { mode: 0o600 })
    const worker = new PactFlowK3sWorker({ kubeconfig, namespace: 'test', imagePullSecret: 'pull', pollIntervalMs: 250,
      templates: [{ id: 'dsh', harness: 'dsh', apiMode: 'openai-chat-completions',
        image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, model: 'model', baseUrl: 'https://model.invalid',
        modelSecretName: 'shared-model', cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi' }] })
    const controller = new AbortController()
    let settled = false
    let observed: unknown
    pending = worker.probeImage('dsh', 10_000, controller.signal).then(result => { observed = result; settled = true; return result })
    await vi.waitFor(() => {
      if (settled && !readStarted) throw new Error(`Probe fixture stopped before read: ${JSON.stringify(observed)}`)
      expect(readStarted).toBe(true)
    })
    controller.abort()
    await vi.waitFor(() => expect(settled).toBe(true))
    await expect(pending).resolves.toMatchObject({ success: false })
    expect(readClosed).toBe(true)
    expect(deletes).toBe(stage === 'pod-log' ? 2 : 1)
  } finally {
    server.closeAllConnections()
    await pending
    await new Promise<void>(resolve => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  }
})
