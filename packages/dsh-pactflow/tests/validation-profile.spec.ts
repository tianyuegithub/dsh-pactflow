import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

describe('PactFlow validation profiles', () => {
  it('stores user-owned command IDs with CAS and rejects shell wrappers', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-validation-profile-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const workspace = { id: 'workspace-1', path: root, title: 'Workspace', sessionIds: [] }
      ctx.provide('workspaceRegistry', {
        list: () => [workspace], get: () => workspace,
      } as never)
      const saved = await ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 0,
        profiles: [{ id: 'git-status', displayName: 'Git status', command: 'git', args: ['status', '--short'], timeoutMs: 5_000 }],
        selectedProfileIds: ['git-status'],
      })
      expect(saved).toMatchObject({ revision: 1, validationProfiles: [{ id: 'git-status', revision: 1 }] })
      await expect(ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 0, profiles: [],
      })).rejects.toThrow(/revision mismatch/)
      await expect(ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 1,
        profiles: [{ id: 'shell', displayName: 'Shell', command: '/bin/sh', args: ['-c', 'echo unsafe'], timeoutMs: 5_000 }],
      })).rejects.toThrow(/shell wrapper/)
      await ctx.fiber.dispose()
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
