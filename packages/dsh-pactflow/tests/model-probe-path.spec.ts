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

// Assembled placeholder; not a usable credential.
const probeSecret = ['probe', 'value'].join('-')

function draft(baseUrl: string) {
  return {
    ...emptyInfrastructure,
    modelConnections: [{
      id: 'm', displayName: 'M', apiMode: 'anthropic-messages' as const,
      model: 'doubao-seed-code', baseUrl, apiKeyCredentialRef: 'PACTFLOW_MODEL_PROBE',
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

async function probe(ctx: Context, baseUrl: string) {
  return ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'm', draft: draft(baseUrl) })
}

afterEach(() => { vi.unstubAllGlobals() })

// model-probe-path-convention: the anthropic probe must resolve the same
// messages endpoint the runtime client (Anthropic SDK over ANTHROPIC_BASE_URL)
// would use — appending /v1/messages when the base lacks a /v1 segment.
describe('model probe anthropic path convention', () => {
  it('appends v1/messages when the base has no /v1 segment', async () => {
    const requests = stubFetch([{ status: 200, body: { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] } }])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(probe(ctx, 'https://ark.example/api/coding')).resolves.toMatchObject({ success: true })
      expect(requests).toHaveLength(1)
      expect(requests[0]!.url).toBe('https://ark.example/api/coding/v1/messages')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('does not double the /v1 segment when the base already ends with it', async () => {
    const requests = stubFetch([{ status: 200, body: { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] } }])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(probe(ctx, 'https://api.anthropic.example/v1')).resolves.toMatchObject({ success: true })
      expect(requests).toHaveLength(1)
      expect(requests[0]!.url).toBe('https://api.anthropic.example/v1/messages')
      expect(requests[0]!.url).not.toContain('/v1/v1/')
    } finally {
      await ctx.fiber.dispose()
    }
  })

  it('keeps both retry requests on the /v1-resolved path with auth fallback', async () => {
    const requests = stubFetch([
      { status: 401, body: { error: {} } },
      { status: 200, body: { id: 'msg_1', content: [{ type: 'text', text: 'ok' }] } },
    ])
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(MemorySettings, { pactflow: { k3s: false, infrastructure: emptyInfrastructure } })
      await ctx.plugin(PactFlowService, {})
      ctx.provide('credentials', credentialProvider())
      await expect(probe(ctx, 'https://ark.example/api/coding')).resolves.toMatchObject({ success: true })
      expect(requests).toHaveLength(2)
      expect(requests.map(request => request.url)).toEqual([
        'https://ark.example/api/coding/v1/messages',
        'https://ark.example/api/coding/v1/messages',
      ])
      expect(requests[1]!.headers.authorization).toBe(`Bearer ${probeSecret}`)
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
