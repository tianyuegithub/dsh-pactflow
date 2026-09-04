import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import Group from '@deepseek-ai/cordis-plugin-group'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import AgentRegistry from '@deepseek-ai/dsh-agent'
import AgentLoop from '@deepseek-ai/dsh-agent-loop'
import AgentPresets from '@deepseek-ai/dsh-agent-presets'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

describe('PactFlow packaged Agent Preset', () => {
  it('passes the real mount audit and exposes tools only to the composed Agent', async () => {
    const ctx = new Context()
    ctx.baseUrl = pathToFileURL(resolve('package.json')).href
    await ctx.plugin(Loader)
    ctx.loader.builtins.include = Include
    ctx.loader.builtins.group = Group
    await ctx.plugin(LlmRuntime)
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(SystemPrompt, { persona: '' })
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(AgentLoop, { agents: [] })
    await ctx.plugin(PactFlowService)
    ctx.provide('shell', { sandboxMode: undefined } as never)
    ctx.provide('shellEnv', { collect: () => ({}) } as never)
    ctx.provide('fs', { sandboxMode: undefined } as never)
    ctx.provide('subprocess', {} as never)
    await ctx.plugin(AgentPresets, {
      default: 'pactflow',
      roots: [{ path: resolve('packages/dsh-pactflow/presets'), trust: 'user' }],
      includeShippedRoot: false,
      includeUserRoot: false,
    })

    const handle = await ctx.agents.create({
      sessionId: SessionId('mounted-pactflow'),
      setup: async (agentCtx: Context) => void await ctx.agentPresets.mount(agentCtx, 'pactflow'),
    })
    const names = ctx.tools.schemas(handle.agent).map(schema => schema.name).sort()
    expect(names).toEqual([
      'glob',
      'grep',
      'pactflow_bind_git',
      'pactflow_close_git_need',
      'pactflow_create_need',
      'pactflow_create_node',
      'pactflow_dispatch_git',
      'pactflow_dispatch_k3s',
      'pactflow_initialize',
      'pactflow_record_review',
      'pactflow_retry_cleanup',
      'pactflow_retry_node',
      'pactflow_transition_need',
      'pactflow_view',
      'read',
    ])
    expect(ctx.tools.schemas()).toEqual([])
    await handle.dispose()
  })
})
