import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { describe, expect, it, vi } from 'vitest'
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

const template = {
  id: 'dsh', harness: 'dsh' as const, apiMode: 'openai-chat-completions' as const,
  image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`,
  model: 'model', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
}

describe('PactFlow Settings namespace', () => {
  it('loads stored non-secret templates at restart and does not hot-swap after a write', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MemorySettings, {
      pactflow: {
        k3s: {
          namespace: 'pactflow', imagePullSecret: 'pull-secret', pollIntervalMs: 1_000,
          templates: [template],
        },
      },
    })
    await ctx.plugin(PactFlowService, {})

    expect(ctx.pactflow.listK3sTemplates()).toEqual([template])
    const descriptor = ctx.settings.describe({ redactSecrets: true })
      .find(item => String(item.ns) === 'pactflow')
    expect(descriptor).toMatchObject({
      applies: 'restart', value: { k3s: { templates: [template] }, infrastructure: false },
    })
    expect(JSON.stringify(descriptor?.value)).not.toMatch(/apiKey|authToken|"password"|secret-value/i)

    await ctx.settings.update('pactflow' as SettingsNamespace, { k3s: false })
    expect(ctx.pactflow.listK3sTemplates()).toEqual([template])
    await ctx.fiber.dispose()
  })

  it('registers when the Settings provider mounts after PactFlow', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {})
    await ctx.plugin(MemorySettings, {
      pactflow: {
        k3s: {
          namespace: 'pactflow', imagePullSecret: 'pull-secret', pollIntervalMs: 1_000,
          templates: [template],
        },
      },
    })
    expect(ctx.pactflow.listK3sTemplates()).toEqual([template])
    expect(ctx.settings.describe().map(item => String(item.ns))).toContain('pactflow')
    await ctx.fiber.dispose()
  })

  it('loads resource-based infrastructure and exposes logical pool counters', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MemorySettings, {
      pactflow: {
        k3s: false,
        infrastructure: {
          clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
          registries: [{
            id: 'harbor', displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.invalid',
            tlsVerify: false, imagePullSecret: 'pull-secret',
          }],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.invalid',
            tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
          }],
          templates: [template],
          workerPools: [{
            id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
            templateIds: ['dsh'], maxConcurrency: 2, queuePolicy: 'fifo',
          }],
        },
      },
    })
    await ctx.plugin(PactFlowService, {})
    expect(ctx.pactflow.listK3sTemplates()).toEqual([template])
    expect(ctx.pactflow.listWorkerPools()).toEqual([expect.objectContaining({
      id: 'default', maxConcurrency: 2, running: 0, waiting: 0,
    })])
    await expect(ctx.pactflow.infrastructureDeletionImpact('cluster', 'home')).resolves.toMatchObject({
      blockers: ['执行资源池「Default」'], credentialRefs: [],
    })
    await expect(ctx.pactflow.infrastructureDeletionImpact('git-provider', 'gitea')).resolves.toMatchObject({
      blockers: [], credentialRefs: ['PACTFLOW_GITEA_TOKEN'],
    })
    await ctx.fiber.dispose()
  })

  it('tests an unsaved draft and returns staged failures instead of rejecting silently', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {})
    const draft = {
      clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
      registries: [{
        id: 'harbor', displayName: 'Harbor', kind: 'harbor' as const,
        endpoint: 'https://harbor.invalid', tlsVerify: true, imagePullSecret: 'pull-secret',
      }],
      gitProviders: [], templates: [template],
      workerPools: [{
        id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
        templateIds: ['dsh'], maxConcurrency: 1, queuePolicy: 'fifo' as const,
      }],
    }
    await expect(ctx.pactflow.probeInfrastructure({ kind: 'worker-pool', id: 'default', draft }))
      .resolves.toMatchObject({
        success: true,
        stages: [
          { name: 'start', state: 'succeeded' },
          { name: 'resource-graph', state: 'succeeded' },
        ],
      })
    await expect(ctx.pactflow.probeInfrastructure({ kind: 'worker-pool', id: 'default' }))
      .resolves.toMatchObject({
        success: false,
        stages: expect.arrayContaining([expect.objectContaining({ state: 'failed' })]),
      })
    await ctx.fiber.dispose()
  })

  it('reuses the DSH model-discovery service with a credential resolved only on the Host', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {})
    const discoverModels = vi.fn(() => Promise.resolve([
      { id: 'model-b' }, { id: 'model-a', name: 'Model A' }, { id: 'model-a', name: 'Duplicate' },
    ]))
    ctx.provide('credentials', {
      resolve: () => Promise.resolve({ value: 'secret-api-key', source: 'memory' }),
    } as never)
    ctx.provide('llm', { discoverModels } as never)
    await expect(ctx.pactflow.discoverModels({
      id: 'model', displayName: 'Model', apiMode: 'openai-chat-completions',
      model: '', baseUrl: 'https://models.example/v1', apiKeyCredentialRef: 'PACTFLOW_MODEL_API_KEY',
    })).resolves.toEqual([{ id: 'model-a', name: 'Model A' }, { id: 'model-b' }])
    expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', {
      baseURL: 'https://models.example/v1', api: 'openai-completions', apiKey: 'secret-api-key',
    })
    await ctx.fiber.dispose()
  })
})
