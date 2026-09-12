import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, it, expect, vi } from 'vitest'
import PactFlowService from '../lib/index.js'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  return ctx
}

describe('project panel demand loading', () => {
  it('returns registry metadata without touching configuration, Git or session discovery', async () => {
    const ctx = await harness()
    try {
      const workspace = { id: 'a', path: '/not/a/repository', title: 'A', sessionIds: ['cold'] }
      ctx.provide('workspaceRegistry', { list: () => [workspace] } as never)
      const discovery = vi.spyOn(ctx.pactflow, 'listProjects').mockRejectedValue(new Error('must not discover'))
      const configs = vi.spyOn(Reflect.get(ctx.pactflow, 'workspaceProjects'), 'list').mockRejectedValue(new Error('must not load configs'))
      expect(await ctx.pactflow.listWorkspaceProjectSummaries()).toEqual([{ workspaceId: 'a', path: workspace.path, title: 'A' }])
      expect(discovery).not.toHaveBeenCalled()
      expect(configs).not.toHaveBeenCalled()
    } finally { await ctx.fiber.dispose() }
  })

  it('reads only selected workspace with real Git and rejects unknown ids before inspecting anything', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-panel-'))
    const previous = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = await harness()
    try {
      const repo = join(root, 'repo')
      await mkdir(repo)
      execFileSync('git', ['init', '-b', 'main', repo], { stdio: 'ignore' })
      const workspace = { id: 'a', path: repo, title: 'A', sessionIds: ['cold'] }
      const list = vi.fn(() => { throw new Error('must not inspect other workspaces') })
      ctx.provide('workspaceRegistry', { list, get: (id: string) => id === 'a' ? workspace : undefined } as never)
      const discovery = vi.spyOn(ctx.pactflow, 'listProjects').mockRejectedValue(new Error('must not discover'))
      expect(await ctx.pactflow.workspaceProjectDetails('a')).toMatchObject({ workspaceId: 'a', gitStatus: { initialized: true, hasCommit: false } })
      expect(discovery).not.toHaveBeenCalled()
      expect(list).not.toHaveBeenCalled()
      await expect(ctx.pactflow.workspaceProjectDetails('missing')).rejects.toThrow(/not configured/)
      await expect(ctx.pactflow.workspaceMigrationCandidates('missing')).rejects.toThrow(/not configured/)
    } finally {
      await ctx.fiber.dispose()
      if (previous === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previous
      await rm(root, { recursive: true, force: true })
    }
  })

  it('reads a real persisted candidate only on demand, without making it live or enumerating unrelated sessions', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-panel-cold-'))
    const writer = await harness()
    const reader = await harness()
    try {
      await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const session = writer.sessions.create(SessionId('panel-cold'), { meta: { agentPreset: 'pactflow' } })
      writer.pactflow.initialize(session.id, { name: 'Cold project' })
      await writer.sessions.flush(session)
      await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const readSession = vi.fn(async (id: string) => {
        const stored = await reader.sessionPersistence.load(SessionId(id))
        return { session: stored.meta, events: [...stored.events] }
      })
      const listSessions = vi.fn(() => { throw new Error('must not enumerate unrelated sessions') })
      reader.provide('sessionQuery', { readSession, listSessions } as never)
      reader.provide('workspaceRegistry', { get: () => ({ id: 'a', path: root, title: 'A', sessionIds: [session.id] }) } as never)
      const expected = [{ sessionId: session.id, projectName: 'Cold project', revision: 1 }]
      expect(await reader.pactflow.workspaceMigrationCandidates('a')).toEqual(expected)
      expect(await reader.pactflow.workspaceMigrationCandidates('a')).toEqual(expected)
      expect(readSession.mock.calls).toEqual([[session.id], [session.id]])
      expect(listSessions).not.toHaveBeenCalled()
      expect(reader.sessions.get(session.id)).toBeUndefined()
      readSession.mockRejectedValueOnce(new Error('read failed'))
      await expect(reader.pactflow.workspaceMigrationCandidates('a')).rejects.toThrow('read failed')
    } finally {
      await writer.fiber.dispose(); await reader.fiber.dispose()
      await rm(root, { recursive: true, force: true })
    }
  })
})
