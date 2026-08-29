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
    expect(descriptor).toMatchObject({ applies: 'restart', value: { k3s: { templates: [template] } } })
    expect(JSON.stringify(descriptor)).not.toMatch(/apiKey|authToken|password/i)

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
})
