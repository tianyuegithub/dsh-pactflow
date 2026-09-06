import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowK3sWorker } from '../src/k3s-worker.ts'

const roots: string[] = []
const priorHome = process.env.DSH_HOME

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
  if (priorHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = priorHome
})

interface LedgerEntry {
  readonly jobName: string
  readonly kind: 'harness' | 'api' | 'image'
  readonly fingerprint: string
  readonly createdAt: string
  readonly jobUid?: string
  readonly secretName?: string
  readonly secretUid?: string
}

function entry(fingerprint: string, withUid = true): LedgerEntry {
  return {
    jobName: 'dsh-pf-probe-recovery', kind: 'harness', fingerprint, createdAt: new Date().toISOString(),
    ...(withUid ? { jobUid: 'recovery-job-uid' } : {}),
    secretName: 'dsh-pf-probe-recovery-model',
    ...(withUid ? { secretUid: 'recovery-secret-uid' } : {}),
  }
}

async function startService(): Promise<Context> {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-recovery-'))
  roots.push(root)
  process.env.DSH_HOME = root
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  return ctx
}

describe('PactFlow probe cleanup recovery', () => {
  it('cleans a retained record exactly through the matching provider and removes it', async () => {
    const ctx = await startService()
    try {
      const record = entry('fp-a')
      const remove = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'probeLedger', {
        list: vi.fn(async () => [record]),
        remove,
      })
      const cleanupProbeIdentity = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'k3s', {
        connectionFingerprint: () => 'fp-a',
        cleanupProbeIdentity,
      })
      await expect(Reflect.get(ctx.pactflow, 'reconcileProbeCleanups').call(ctx.pactflow)).resolves.toBe(true)
      expect(cleanupProbeIdentity).toHaveBeenCalledWith(record)
      expect(remove).toHaveBeenCalledWith('dsh-pf-probe-recovery')
    } finally { await ctx.fiber.dispose() }
  })

  it('retains records whose provider fingerprint no longer matches without deleting by name', async () => {
    const ctx = await startService()
    try {
      const remove = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'probeLedger', {
        list: vi.fn(async () => [entry('fp-gone')]),
        remove,
      })
      const cleanupProbeIdentity = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'k3s', {
        connectionFingerprint: () => 'fp-a',
        cleanupProbeIdentity,
      })
      await expect(Reflect.get(ctx.pactflow, 'reconcileProbeCleanups').call(ctx.pactflow)).resolves.toBe(true)
      expect(cleanupProbeIdentity).not.toHaveBeenCalled()
      expect(remove).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps the record for retry when exact cleanup fails', async () => {
    const ctx = await startService()
    try {
      const remove = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'probeLedger', {
        list: vi.fn(async () => [entry('fp-a')]),
        remove,
      })
      Reflect.set(ctx.pactflow, 'k3s', {
        connectionFingerprint: () => 'fp-a',
        cleanupProbeIdentity: vi.fn(async () => { throw new Error('Job delete forbidden') }),
      })
      await expect(Reflect.get(ctx.pactflow, 'reconcileProbeCleanups').call(ctx.pactflow)).resolves.toBe(false)
      expect(remove).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('retains records without any configured provider and never deletes by name', async () => {
    const ctx = await startService()
    try {
      const remove = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'probeLedger', {
        list: vi.fn(async () => [entry('fp-a')]),
        remove,
      })
      await expect(Reflect.get(ctx.pactflow, 'reconcileProbeCleanups').call(ctx.pactflow)).resolves.toBe(true)
      expect(remove).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('fails an unconfirmed record closed through the real worker and keeps it retained', async () => {
    const ctx = await startService()
    try {
      const root = roots[roots.length - 1]!
      const kubeconfigPath = join(root, 'kubeconfig')
      await writeFile(kubeconfigPath, [
        'apiVersion: v1', 'kind: Config',
        'clusters: [{ name: test, cluster: { server: "http://127.0.0.1:1" } }]',
        'users: [{ name: test, user: {} }]',
        'contexts: [{ name: test, context: { cluster: test, user: test } }]',
        'current-context: test',
      ].join('\n'), 'utf8')
      const worker = new PactFlowK3sWorker({
        namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [], kubeconfig: kubeconfigPath,
      })
      const record = entry(worker.connectionFingerprint(), false)
      const remove = vi.fn(async () => {})
      Reflect.set(ctx.pactflow, 'probeLedger', {
        list: vi.fn(async () => [record]),
        remove,
      })
      Reflect.set(ctx.pactflow, 'k3s', worker)
      await expect(Reflect.get(ctx.pactflow, 'reconcileProbeCleanups').call(ctx.pactflow)).resolves.toBe(false)
      expect(remove).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})
