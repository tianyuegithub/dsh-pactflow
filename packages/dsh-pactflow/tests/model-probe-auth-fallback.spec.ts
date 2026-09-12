import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { SettingsProvider, type SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { afterEach, describe, expect, it, vi } from 'vitest'
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
  clusters: [], registries: [], gitProviders: [], templates: [], modelConnections: [], workerPools: [],
}

interface RecordedRequest {
  readonly url: string
  readonly headers: Record<string, string>
}

// Assembled (not a credential-shaped literal) and not usable anywhere; keeps
// the header-style assertions free of hardcoded credential values.
const probeSecret = ['probe', 'value'].join('-')

function anthropicDraft() {
  return {
    ...emptyInfrastructure,
    modelConnections: [{
      id: 'ark', displayName: 'Ark', apiMode: 'anthropic-messages' as const,
      model: 'doubao-seed-code', baseUrl: 'https://model.invalid/anthropic',
      apiKeyCredentialRef: 'PACTFLOW_MODEL_PROBE',
    }],
  }
}

function stubFetch(responses: readonly { readonly status: number; readonly body?: unknown }[]) {
  const requests: RecordedRequest[] = []
  const mock = vi.fn(async (url: unknown, init?: { readonly headers?: Record<string, string> }) => {
    const index = requests.length
    requests.push({ url: String(url), headers: { ...(init?.headers ?? {}) } })
    const scripted = responses[Math.min(index, responses.length - 1)]!
    return new Response(JSON.stringify(scripted.body ?? {}), { status: scripted.status })
  })
  vi.stubGlobal('fetch', mock)
  return requests
}

function credentialProvider() {
  return { resolve: () => Promise.resolve({ value: probeSecret, source: 'memory' }) } as never
}

afterEach(() => { vi.unstubAllGlobals() })

// model-probe-auth-fallback: the anthropic probe leads with x-api-key (official
// semantics) and, only on HTTP 401, retries exactly once with Bearer against
// gateways (e.g. Volcengine Ark) that reject the Anthropic header style.
describe('model probe anthropic auth fallback', () => {
  it('retries once with Bearer after a 401 and succeeds', async () => {
    const requests = stubFetch([
      { status: 401, body: { error: { message: 'denied' } } },
      { status: 200, body: { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] } },
    ])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'ark', draft: anthropicDraft() }))
        .resolves.toMatchObject({ success: true })
      expect(requests).toHaveLength(2)
      expect(requests[0]!.headers['x-api-key']).toBe(probeSecret)
      expect(requests[0]!.headers.authorization).toBeUndefined()
      expect(requests[1]!.headers.authorization).toBe(`Bearer ${probeSecret}`)
      expect(requests[1]!.headers['x-api-key']).toBeUndefined()
      expect(requests[1]!.url).toBe(requests[0]!.url)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('fails with the 401 named when both header styles are rejected', async () => {
    const requests = stubFetch([{ status: 401 }, { status: 401 }])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'ark', draft: anthropicDraft() }))
        .resolves.toMatchObject({
          success: false,
          stages: expect.arrayContaining([expect.objectContaining({ state: 'failed', detail: expect.stringContaining('401') })]),
        })
      expect(requests).toHaveLength(2)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not retry a non-401 failure', async () => {
    const requests = stubFetch([{ status: 403, body: { error: {} } }])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'ark', draft: anthropicDraft() }))
        .resolves.toMatchObject({
          success: false,
          stages: expect.arrayContaining([expect.objectContaining({ state: 'failed', detail: expect.stringContaining('403') })]),
        })
      expect(requests).toHaveLength(1)
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('succeeds on the first x-api-key request against the official style', async () => {
    const requests = stubFetch([{ status: 200, body: { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] } }])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'ark', draft: anthropicDraft() }))
        .resolves.toMatchObject({ success: true })
      expect(requests).toHaveLength(1)
      expect(requests[0]!.headers.authorization).toBeUndefined()
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
