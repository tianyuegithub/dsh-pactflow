import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function kubeconfig(root: string, server: string, ca: string): string {
  const path = join(root, 'kubeconfig')
  writeFileSync(path, [
    'apiVersion: v1', 'kind: Config',
    `clusters: [{ name: test, cluster: { server: "${server}", certificate-authority-data: "${ca}" } }]`,
    'users: [{ name: test, user: {} }]',
    'contexts: [{ name: test, context: { cluster: test, user: test } }]',
    'current-context: test',
  ].join('\n'), 'utf8')
  return path
}

function worker(path: string): PactFlowK3sWorker {
  return new PactFlowK3sWorker({
    namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [], kubeconfig: path,
  } as PactFlowK3sConfig)
}

describe('PactFlow cluster connection identity', () => {
  it('changes when the same kubeconfig path is replaced with another cluster', () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-cluster-identity-'))
    roots.push(root)
    const path = kubeconfig(root, 'https://cluster-a.invalid:6443', 'Y2EtYQ==')
    const first = worker(path).connectionFingerprint()
    // Same path, same context/namespace, but the file now points at a different cluster.
    kubeconfig(root, 'https://cluster-b.invalid:6443', 'Y2EtYg==')
    const second = worker(path).connectionFingerprint()
    expect(second).not.toBe(first)
  })

  it('is stable for the same cluster identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-cluster-stable-'))
    roots.push(root)
    const path = kubeconfig(root, 'https://cluster-a.invalid:6443', 'Y2EtYQ==')
    expect(worker(path).connectionFingerprint()).toBe(worker(path).connectionFingerprint())
  })

  it('changes when only the certificate authority differs', () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-cluster-ca-'))
    roots.push(root)
    const path = kubeconfig(root, 'https://cluster-a.invalid:6443', 'Y2EtYQ==')
    const first = worker(path).connectionFingerprint()
    kubeconfig(root, 'https://cluster-a.invalid:6443', 'ZGlmZmVyZW50LWNh')
    expect(worker(path).connectionFingerprint()).not.toBe(first)
  })
})
