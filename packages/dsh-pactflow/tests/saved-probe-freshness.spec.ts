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

const emptyInfrastructure = {
  clusters: [], registries: [], gitProviders: [], templates: [], workerPools: [],
}

// infrastructure-probe-freshness: saved probes read the currently persisted
// settings document, not the startup snapshot. A resource saved after the
// Profile starts must be testable (and visible to read-only discovery and
// deletion impact) without restarting, while runtime worker resources stay
// bound to the restart-applied contract.
describe('saved infrastructure probes read the current persisted document', () => {
  it('tests a resource saved after startup without restarting, without rebinding runtime pools', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MemorySettings, {
      pactflow: { k3s: false, infrastructure: emptyInfrastructure },
    })
    await ctx.plugin(PactFlowService, {})

    // Baseline: the pool is absent from the persisted document.
    await expect(ctx.pactflow.probeInfrastructure({ kind: 'worker-pool', id: 'default' }))
      .resolves.toMatchObject({ success: false, stages: expect.arrayContaining([expect.objectContaining({ state: 'failed' })]) })

    const saved = {
      clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
      registries: [{
        id: 'harbor', displayName: 'Harbor', kind: 'harbor' as const,
        endpoint: 'https://harbor.invalid', tlsVerify: true, imagePullSecret: 'pull-secret',
      }],
      gitProviders: [],
      templates: [{
        id: 'dsh', harness: 'dsh' as const, apiMode: 'openai-chat-completions' as const,
        image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`,
        model: 'model', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
        cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
      }],
      modelConnections: [],
      workerPools: [{
        id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
        templateIds: ['dsh'], maxConcurrency: 2, queuePolicy: 'fifo' as const,
      }],
    }
    await ctx.settings.update('pactflow' as SettingsNamespace, { infrastructure: saved })

    // Saved probe sees the freshly persisted pool without a restart.
    await expect(ctx.pactflow.probeInfrastructure({ kind: 'worker-pool', id: 'default' }))
      .resolves.toMatchObject({
        success: true,
        stages: [
          { name: 'start', state: 'succeeded' },
          { name: 'resource-graph', state: 'succeeded' },
        ],
      })

    // Read-only boundary: runtime worker pools stay restart-applied.
    expect(ctx.pactflow.listWorkerPools()).toEqual([])

    // Deletion impact also evaluates the freshly saved resource.
    await expect(ctx.pactflow.infrastructureDeletionImpact('cluster', 'home')).resolves.toMatchObject({
      blockers: ['执行资源池「Default」'],
    })
    await ctx.fiber.dispose()
  })

  it('starts the saved-probe log with the currently-saved settings wording', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(MemorySettings, {
      pactflow: { k3s: false, infrastructure: emptyInfrastructure },
    })
    await ctx.plugin(PactFlowService, {})
    await expect(ctx.pactflow.probeInfrastructure({ kind: 'worker-pool', id: 'default' }))
      .resolves.toMatchObject({
        stages: expect.arrayContaining([expect.objectContaining({ name: 'start', detail: expect.stringContaining('currently saved settings') })]),
      })
    await ctx.fiber.dispose()
  })
})
