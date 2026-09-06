import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'

// Real-Git fixtures are slow under load; relax the per-test timeout without touching assertions.
vi.setConfig({ testTimeout: 20_000 })
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow Workspace remote creation reconciliation', () => {
  async function seedUnknownResult(root: string) {
    const previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, { infrastructure: {
      clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
      gitProviders: [{ id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.invalid',
        username: 'owner', tokenCredentialRef: 'TEST_GITEA' }],
    } })
    const { workspace } = createGitFixture(root)
    execFileSync('git', ['-C', workspace, 'remote', 'remove', 'origin'])
    const registered = { id: 'workspace', path: workspace, title: 'Workspace', sessionIds: [] }
    ctx.provide('workspaceRegistry', { list: () => [registered], get: () => registered } as never)
    ctx.provide('credentials', { resolve: async () => ({ value: 'isolated-test-value', source: 'memory' }) } as never)
    const create = vi.fn(async () => { throw new Error('injected response loss after request') })
    Reflect.set(ctx.pactflow, 'gitea', { createRepository: create })
    await expect(ctx.pactflow.createWorkspaceRemote({ workspaceId: registered.id, expectedRevision: 0,
      providerId: 'gitea', owner: 'owner', repo: 'repo', defaultBranch: 'main', private: true,
      confirm: 'create-gitea-repository' as const })).rejects.toThrow('injected response loss')
    const store = Reflect.get(ctx.pactflow, 'workspaceProjects')
    const saved = await store.get(registered.id)
    expect(saved.remoteCreation).toMatchObject({ state: 'creating', owner: 'owner', repo: 'repo' })
    const restoreHome = async () => {
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
    }
    return { ctx, store, workspace, registered, saved, operationId: saved.remoteCreation.id as string, restoreHome }
  }

  it('lists read-only candidates with intent comparisons and never persists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-remote-reconcile-'))
    const { ctx, store, registered, operationId, restoreHome } = await seedUnknownResult(root)
    try {
      const listing = vi.fn(async () => [
        { id: 7, fullName: 'owner/repo', cloneUrl: 'https://gitea.invalid/owner/repo.git', defaultBranch: 'main',
          private: true, empty: true, description: `Managed by dsh-pactflow ${operationId}`, createdAt: '2026-09-06T00:00:00Z' },
        { id: 8, fullName: 'owner/repo-backup', cloneUrl: 'https://gitea.invalid/owner/repo-backup.git', defaultBranch: 'dev',
          private: false, empty: true, description: 'unrelated', createdAt: '2026-09-06T00:00:00Z' },
      ])
      Reflect.set(ctx.pactflow, 'gitea', { listCandidateRepositories: listing })
      const result = await ctx.pactflow.listWorkspaceRemoteCandidates(registered.id)
      expect(result.intent).toMatchObject({ owner: 'owner', repo: 'repo', defaultBranch: 'main', private: true, operationId })
      expect(result.candidates).toHaveLength(2)
      expect(result.candidates[0]).toMatchObject({ id: 7, matches: {
        exactName: true, defaultBranch: true, private: true, descriptionClue: true } })
      expect(result.candidates[1]).toMatchObject({ id: 8, matches: {
        exactName: false, defaultBranch: false, private: false, descriptionClue: false } })
      expect(listing).toHaveBeenCalledTimes(1)
      expect((await store.get(registered.id)).revision).toBe((await store.get(registered.id)).revision)
      const after = await store.get(registered.id)
      expect(after.remoteCreation).toMatchObject({ state: 'creating' })
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); await restoreHome() }
  })

  it.each(['missing', 'wrong-name', 'wrong-private', 'wrong-branch'] as const)(
    'refuses confirmation on any %s mismatch without persisting', async mode => {
      const root = await mkdtemp(join(tmpdir(), 'pactflow-remote-confirm-'))
      const { ctx, store, registered, restoreHome } = await seedUnknownResult(root)
      try {
        const before = await store.get(registered.id)
        Reflect.set(ctx.pactflow, 'gitea', {
          getRepositoryById: vi.fn(async (_base: string, _user: string | undefined, _token: string, id: number) => {
            if (mode === 'missing') throw Object.assign(new Error('not found'), { status: 404 })
            return {
              id, fullName: mode === 'wrong-name' ? 'owner/other' : 'owner/repo',
              cloneUrl: 'https://gitea.invalid/owner/repo.git',
              defaultBranch: mode === 'wrong-branch' ? 'dev' : 'main',
              private: mode === 'wrong-private' ? false : true,
              empty: true, description: '', createdAt: '2026-09-06T00:00:00Z',
            }
          }),
        })
        await expect(ctx.pactflow.confirmWorkspaceRemoteCandidate({
          workspaceId: registered.id, expectedRevision: before.revision, repoId: 7 }))
          .rejects.toThrow()
        const after = await store.get(registered.id)
        expect(after.remoteCreation).toMatchObject({ state: 'creating' })
        expect(after.revision).toBe(before.revision)
      } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); await restoreHome() }
    })

  it('persists the confirmed address and lets the existing guarded path complete the push', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-remote-confirm-'))
    const { ctx, store, workspace, registered, restoreHome } = await seedUnknownResult(root)
    try {
      const before = await store.get(registered.id)
      const resolved = join(root, 'resolved.git')
      const byId = vi.fn(async () => ({
        id: 7, fullName: 'owner/repo', cloneUrl: resolved, defaultBranch: 'main',
        private: true, empty: true, description: '', createdAt: '2026-09-06T00:00:00Z',
      }))
      Reflect.set(ctx.pactflow, 'gitea', { getRepositoryById: byId })
      const confirmed = await ctx.pactflow.confirmWorkspaceRemoteCandidate({
        workspaceId: registered.id, expectedRevision: before.revision, repoId: 7 })
      expect(confirmed.remoteCreation).toMatchObject({ state: 'created', cloneUrl: resolved })
      expect(byId).toHaveBeenCalledTimes(1)
      // A second confirmation on a non-creating record must be refused.
      await expect(ctx.pactflow.confirmWorkspaceRemoteCandidate({
        workspaceId: registered.id, expectedRevision: confirmed.revision, repoId: 7 }))
        .rejects.toThrow(/no unknown-result/)
      // The existing guarded creation path resumes: push to the confirmed remote only.
      execFileSync('git', ['init', '--bare', resolved])
      Reflect.set(ctx.pactflow, 'gitea', {})
      const completed = await ctx.pactflow.createWorkspaceRemote({ workspaceId: registered.id,
        expectedRevision: confirmed.revision, providerId: 'gitea', owner: 'owner', repo: 'repo',
        defaultBranch: 'main', private: true, confirm: 'create-gitea-repository' as const })
      expect(completed.remoteCreation).toMatchObject({ state: 'completed', cloneUrl: resolved })
      expect(execFileSync('git', ['-C', workspace, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim())
        .toBe(resolved)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }); await restoreHome() }
  })
})
