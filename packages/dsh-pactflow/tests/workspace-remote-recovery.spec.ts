import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow Workspace remote creation responsibility', () => {
  it.each(['unknown-create-result', 'push-failure', 'concurrent-create', 'commit-drift', 'origin-drift', 'remote-drift', 'completion-write-failure', 'different-default-branch'] as const)('persists responsibility across %s', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-remote-recovery-'))
    const previousDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    const ctx = new Context()
    try {
      const { workspace, remote } = createGitFixture(root)
      execFileSync('git', ['-C', workspace, 'remote', 'remove', 'origin'])
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, { infrastructure: {
        clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
        gitProviders: [{ id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.invalid',
          username: 'owner', tokenCredentialRef: 'TEST_GITEA' }],
      } })
      const registered = { id: 'workspace', path: workspace, title: 'Workspace', sessionIds: [] }
      ctx.provide('workspaceRegistry', { list: () => [registered], get: () => registered } as never)
      ctx.provide('credentials', { resolve: async () => ({ value: 'isolated-test-value', source: 'memory' }) } as never)
      const store = Reflect.get(ctx.pactflow, 'workspaceProjects')
      if (mode === 'completion-write-failure') {
        execFileSync('git', ['init', '--bare', join(root, 'unavailable.git')])
        const put = store.putIfRevision.bind(store)
        let failed = false
        store.putIfRevision = async (revision: number, config: { remoteCreation?: { state: string } }) => {
          if (!failed && config.remoteCreation?.state === 'completed') { failed = true; return false }
          return await put(revision, config)
        }
      }
      let beforeCreate: unknown
      const create = vi.fn(async () => {
        beforeCreate = await store.get(registered.id)
        if (mode === 'unknown-create-result') throw new Error('injected response loss after request')
        // An unavailable local Git target reliably fails the push without network access.
        return { fullName: 'owner/repo', cloneUrl: join(root, 'unavailable.git'), defaultBranch: request.defaultBranch, private: true }
      })
      Reflect.set(ctx.pactflow, 'gitea', { createRepository: create })
      const request = { workspaceId: registered.id, expectedRevision: 0,
        providerId: 'gitea', owner: 'owner', repo: 'repo', defaultBranch: mode === 'different-default-branch' ? 'release' : 'main', private: true,
        confirm: 'create-gitea-repository' as const }
      if (mode === 'concurrent-create') {
        const results = await Promise.allSettled([
          ctx.pactflow.createWorkspaceRemote(request), ctx.pactflow.createWorkspaceRemote(request),
        ])
        expect(results.map(result => result.status)).toEqual(['rejected', 'rejected'])
      } else await expect(ctx.pactflow.createWorkspaceRemote(request)).rejects.toThrow()
      expect(create).toHaveBeenCalledTimes(1)
      if (mode !== 'unknown-create-result') {
        expect(execFileSync('git', ['-C', workspace, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim())
          .toBe(join(root, 'unavailable.git'))
      }
      // Intent must precede the first external effect and survive either failure.
      expect(beforeCreate).toMatchObject({ remoteCreation: { owner: 'owner', repo: 'repo', defaultBranch: request.defaultBranch } })
      expect(await store.get(registered.id)).toMatchObject({ remoteCreation: { owner: 'owner', repo: 'repo' } })
      const saved = await store.get(registered.id)
      const { remoteCreation: _operation, ...discarded } = saved
      await expect(store.putIfRevision(saved.revision, { ...discarded, revision: saved.revision + 1 }))
        .rejects.toThrow(/cannot be discarded/)
      const updated = await ctx.pactflow.saveValidationProfiles({ workspaceId: registered.id,
        expectedRevision: saved.revision, profiles: [] })
      expect(updated.remoteCreation).toEqual(saved.remoteCreation)
      if (mode === 'unknown-create-result') {
        await expect(ctx.pactflow.createWorkspaceRemote({ ...request, expectedRevision: updated.revision }))
          .rejects.toThrow(/result is unknown/)
      } else {
        if (mode !== 'completion-write-failure') execFileSync('git', ['init', '--bare', join(root, 'unavailable.git')])
        if (mode === 'commit-drift') execFileSync('git', ['-C', workspace, 'commit', '--allow-empty', '-m', 'new local work'])
        if (mode === 'origin-drift') execFileSync('git', ['-C', workspace, 'remote', 'set-url', 'origin', remote])
        let otherCommit: string | undefined
        if (mode === 'remote-drift') {
          const other = join(root, 'other')
          execFileSync('git', ['clone', remote, other])
          execFileSync('git', ['-C', other, '-c', 'user.name=Other', '-c', 'user.email=other@example.invalid',
            'commit', '--allow-empty', '-m', 'other writer'])
          otherCommit = execFileSync('git', ['-C', other, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
          execFileSync('git', ['-C', other, 'push', join(root, 'unavailable.git'), 'HEAD:refs/heads/main'])
        }
        if (mode.endsWith('-drift')) {
          await expect(ctx.pactflow.createWorkspaceRemote({ ...request, expectedRevision: updated.revision }))
            .rejects.toThrow(/changed/)
          expect((await store.get(registered.id)).remoteCreation.state).toBe('created')
          expect(create).toHaveBeenCalledTimes(1)
          if (otherCommit !== undefined) expect(execFileSync('git', ['--git-dir', join(root, 'unavailable.git'),
            'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim()).toBe(otherCommit)
          return
        }
        const completed = await ctx.pactflow.createWorkspaceRemote({ ...request, expectedRevision: updated.revision })
        expect(completed.remoteCreation?.state).toBe('completed')
        expect(execFileSync('git', ['--git-dir', join(root, 'unavailable.git'), 'rev-parse', `refs/heads/${request.defaultBranch}`], { encoding: 'utf8' }).trim())
          .toBe(saved.remoteCreation.expectedCommit)
        expect(await ctx.pactflow.createWorkspaceRemote({ ...request, expectedRevision: completed.revision })).toEqual(completed)
      }
      expect(create).toHaveBeenCalledTimes(1)
    } finally {
      await ctx.fiber.dispose()
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
