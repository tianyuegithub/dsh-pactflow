import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

class MemorySettings extends SettingsProvider {
  readonly writable = true
  constructor(ctx: Context, private readonly document: Record<string, unknown>) { super(ctx) }
  protected load(): Promise<Record<string, unknown>> { return Promise.resolve(structuredClone(this.document)) }
  protected persist(ns: SettingsNamespace, section: Record<string, unknown>): Promise<void> {
    this.document[ns] = structuredClone(section)
    return Promise.resolve()
  }
}

const digest = `sha256:${'a'.repeat(64)}`

function infrastructureSettings(poolMaxConcurrency: number) {
  return {
    clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
    registries: [{
      id: 'harbor', displayName: 'Harbor', kind: 'harbor' as const,
      endpoint: 'https://harbor.invalid', tlsVerify: true, imagePullSecret: 'pull-secret',
    }],
    gitProviders: [],
    templates: [{
      id: 'dsh', displayName: 'DeepSeek Harness', harness: 'dsh' as const,
      registryId: 'harbor', repository: 'pactflow-worker', artifactDigest: digest,
      cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
    }],
    modelConnections: [{
      id: 'glm', displayName: 'GLM', apiMode: 'openai-chat-completions' as const,
      model: 'glm-4.6', baseUrl: 'https://model.invalid/v1', apiKeyCredentialRef: 'PACTFLOW_MODEL_GLM',
    }],
    workerPools: [{
      id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
      templateIds: ['dsh'], maxConcurrency: poolMaxConcurrency, queuePolicy: 'fifo' as const,
    }],
  }
}

// User decision (2026-09-12): an Agent Profile's Worker quantity is the
// project-side declared demand, bounded 1-12; it is deliberately NOT bounded
// by the shared pool capacity — the runtime pool arbitrates actual
// concurrency and queues the excess.
describe('PactFlow Agent Profile Worker quantity bounds', () => {
  it('accepts a profile quantity above the pool capacity and rejects 13', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-agent-bounds-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    try {
      await mkdir(join(root, 'repo'), { recursive: true })
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: infrastructureSettings(3) } })
      await ctx.plugin(PactFlowService, {})
      const registeredWorkspace = { id: 'bounds-workspace', path: join(root, 'repo'), title: 'Bounds', sessionIds: [] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)

      const request = (quantity: number) => ({
        workspaceId: 'bounds-workspace', expectedRevision: 0, k3sGitSecretName: 'pactflow-git-bounds',
        worker: {
          clusterId: 'home', workerPoolId: 'default', maxConcurrency: quantity,
          agentProfiles: [{
            id: 'agent', displayName: 'Agent', templateId: 'dsh', modelConnectionId: 'glm',
            maxConcurrency: quantity,
          }],
        },
      })

      // Pool caps at 3; a declared demand of 12 must still save (queues at runtime).
      const saved = await ctx.pactflow.saveWorkspaceWorkerPolicy(request(12))
      expect(saved.worker.agentProfiles[0]).toMatchObject({ maxConcurrency: 12 })
      // The hard bound is 12; 13 is refused with the named range.
      await expect(ctx.pactflow.saveWorkspaceWorkerPolicy(request(13)))
        .rejects.toThrow(/must be 1-12/)
    } finally {
      process.env.DSH_HOME = priorHome
      await ctx.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
