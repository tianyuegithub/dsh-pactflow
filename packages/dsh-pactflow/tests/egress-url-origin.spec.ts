import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import * as PactFlowAgentTools from '../presets/pactflow/plugin/index.js'

// egress-url-origin: the agent plane may reference egress targets ONLY by
// registered id; a model must never be handed an endpoint parameter it can
// point anywhere (the 2026-09-11 deep scan could not prove this statically —
// these guards make it a repository-verifiable fact).
const ENDPOINT_PARAMETER = /(^|_)(urls?|endpoints?|base_?urls?|addresses?|hosts?|hostnames?|remote_?addrs?)$/i

/** Boot the real preset artifact and collect the pactflow_* schemas the agent sees. */
async function agentPlaneTools() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId('egress-origin-agent'), { meta: { agentPreset: 'pactflow' } })
  const agent = { id: session.id, session } as Agent
  const scope = createScope(ctx, agent)
  await scope.ctx.plugin(PactFlowAgentTools)
  const tools = ctx.tools.schemas(agent).filter(schema => schema.name.startsWith('pactflow_'))
  return { ctx, tools }
}

describe('PactFlow egress URL origin', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('exposes no endpoint-like parameter on any agent-plane tool', async () => {
    const { ctx, tools } = await agentPlaneTools()
    try {
      // The guard must see a real tool surface, not an accidentally empty one.
      expect(tools.length).toBeGreaterThanOrEqual(10)
      const offenders: string[] = []
      for (const tool of tools) {
        // schemas() projects a JSON-Schema envelope; the parameter names live in
        // `properties`. Asserting the envelope keeps this guard from scanning an
        // empty object and passing vacuously.
        const parameters = tool.parameters as { type?: string; properties?: Record<string, unknown> } | undefined
        expect(parameters?.type, `${tool.name}: unexpected schema envelope`).toBe('object')
        expect(parameters?.properties, `${tool.name}: missing properties`).toBeTypeOf('object')
        for (const name of Object.keys(parameters?.properties ?? {})) {
          if (ENDPOINT_PARAMETER.test(name)) offenders.push(`${tool.name}.${name}`)
        }
      }
      expect(offenders, offenders.join(', ')).toEqual([])
      // Pin the intended shape: the Git binding names a registered Provider id
      // and offers no endpoint parameter to point elsewhere.
      const bind = tools.find(tool => tool.name === 'pactflow_bind_git')
      const bindProperties = (bind?.parameters as { properties?: Record<string, unknown> } | undefined)?.properties
      expect(Object.keys(bindProperties ?? {})).toContain('gitea_provider_id')
      expect(Object.keys(bindProperties ?? {}).some(name => ENDPOINT_PARAMETER.test(name))).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps settings-form probe helpers off the agent plane', async () => {
    const { ctx, tools } = await agentPlaneTools()
    try {
      // Discovery/probe helpers accept operator-typed draft endpoints by design;
      // they belong to the client settings surface and must never reach the model.
      const offenders = tools
        .map(tool => tool.name)
        .filter(name => /discover|^pactflow_probe/.test(name))
      expect(offenders, offenders.join(', ')).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('fails closed on an unregistered model connection before any network request', async () => {
    const fetchCalls = vi.fn()
    vi.stubGlobal('fetch', fetchCalls)
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      infrastructure: {
        clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [], gitProviders: [],
      },
    })
    try {
      const result = await ctx.pactflow.probeInfrastructure({ kind: 'model-connection', id: 'missing' })
      expect(result.success).toBe(false)
      expect(JSON.stringify(result.stages)).toMatch(/not configured/)
      expect(fetchCalls).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('fails closed on an unconfigured credential ref before any model discovery request', async () => {
    const discoverCalls = vi.fn(async () => [])
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    ctx.provide('llm', { discoverModels: discoverCalls } as never)
    // A credentials service whose ref resolves to nothing configured.
    ctx.provide('credentials', { resolve: async () => undefined } as never)
    try {
      await expect(ctx.pactflow.discoverModels({
        id: 'draft', displayName: 'Draft', apiMode: 'openai-chat-completions',
        baseUrl: 'https://model.example/v1', apiKeyCredentialRef: 'MISSING_KEY', registryId: 'r',
      } as never)).rejects.toThrow(/not configured/)
      expect(discoverCalls).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })
})
