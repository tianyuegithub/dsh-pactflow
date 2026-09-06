import { access, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'

describe('PactFlow validation profiles', () => {
  it('keeps unchanged profile revisions when another catalog entry changes', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    try {
      const normalize = Reflect.get(ctx.pactflow, 'normalizeValidationProfiles').bind(ctx.pactflow)
      const original = normalize([
        { id: 'first', displayName: 'First', command: 'git', args: ['status'], timeoutMs: 5000 },
        { id: 'second', displayName: 'Second', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
      ], [])
      const changed = normalize([{ ...original[0], args: ['status', '--short'] }, original[1]], original)
      expect(changed.map((profile: { revision: number }) => profile.revision)).toEqual([2, 1])
      expect(normalize(changed, changed)).toEqual(changed)
      expect(() => normalize([{ ...changed[0], revision: 1 }, changed[1]], changed)).toThrow(/revision is stale/)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps an existing binding authorized when the host saves an unrelated profile', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-profile-binding-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    try {
      const workspacePath = join(root, 'repo')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(workspacePath, { recursive: true })
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const registeredWorkspace = { id: 'binding-workspace', path: workspacePath, title: 'Binding', sessionIds: [] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
      // No workspace config exists yet; revision 0 is the CAS baseline for
      // the first save through the real host path.
      const session = ctx.sessions.create(SessionId('profile-binding'), { meta: { agentPreset: 'pactflow', cwd: workspacePath } })
      ctx.pactflow.initialize(session.id, { name: 'Binding' })
      const firstSave = await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 0,
        profiles: [
          { id: 'first', displayName: 'First', command: 'git', args: ['status'], timeoutMs: 5000 },
          { id: 'second', displayName: 'Second', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
        ] })
      // The real dispatch path carries the binding-time command snapshot and
      // the bound revision; the host rechecks both against the current catalog.
      const readSecondSnapshot = async () => {
        const rows = await ctx.pactflow.listWorkspaceProjects()
        const config = rows.find(row => row.workspaceId === registeredWorkspace.id)?.config
        return config?.validationProfiles?.find(profile => profile.id === 'second')!
      }
      const snapshot = await readSecondSnapshot()
      const binding = { validationCommands: [snapshot], validationProfileIds: ['second'], validationProfileRevisions: { second: snapshot.revision } }
      const assertCurrent = Reflect.get(ctx.pactflow, 'assertValidationProfilesCurrent').bind(ctx.pactflow)
      await expect(assertCurrent(session, binding)).resolves.toEqual([expect.objectContaining({ id: 'second', revision: 1 })])
      // The real host save path bumps only the edited entry; the untouched
      // binding must stay authorized afterwards.
      await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: firstSave.revision,
        profiles: [
          { id: 'first', displayName: 'First renamed', command: 'git', args: ['status', '--short'], timeoutMs: 5000 },
          { id: 'second', displayName: 'Second', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
        ] })
      await expect(assertCurrent(session, binding)).resolves.toEqual([expect.objectContaining({ id: 'second', revision: 1 })])
      // Editing the bound entry itself invalidates the stale binding.
      await expect(ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id,
        expectedRevision: firstSave.revision + 1,
        profiles: [
          { id: 'first', displayName: 'First renamed', command: 'git', args: ['status', '--short'], timeoutMs: 5000 },
          { id: 'second', displayName: 'Second changed', command: 'git', args: ['diff', '--check'], timeoutMs: 5000 },
        ] })).resolves.toMatchObject({ revision: firstSave.revision + 2 })
      await expect(assertCurrent(session, binding)).rejects.toThrow(/changed after Git binding|stale|authorization/)
    } finally {
      await ctx.fiber.dispose()
      if (priorHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects raw binding commands before persisting a project change', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-raw-binding-'))
    const ctx = new Context()
    try {
      const { workspace } = createGitFixture(root)
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('raw-binding'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Raw binding' })
      await expect(ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
        validationCommands: [{ command: process.execPath, args: ['-e', 'process.exit(0)'], timeoutMs: 5_000 }],
      })).rejects.toThrow(/raw validation commands/)
      expect(ctx.pactflow.project(session.id).project?.revision).toBe(project.revision)
    } finally { await ctx.fiber.dispose(); await rm(root, { recursive: true, force: true }) }
  })

  it.each([false, true])('does not execute persisted commands without registry authorization (claimed profile: %s)', async claimedProfile => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-raw-run-'))
    try {
      const { workspace, remote } = createGitFixture(root)
      const baseCommit = execFileSync('git', ['-C', workspace, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
      execFileSync('git', ['-C', workspace, 'commit', '--allow-empty', '-m', 'worker result'], { stdio: 'ignore' })
      const marker = join(root, 'unauthorized-execution')
      await expect(new PactFlowGitWorkspace().validateResult({
        remote: 'origin', remoteUrl: remote, defaultBranch: 'main', baseCommit,
        branch: 'main', worktreePath: workspace,
        validationCommands: [{ command: process.execPath, args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed')`], timeoutMs: 5_000 }],
        ...(claimedProfile ? { validationProfileIds: ['forged'], validationProfileRevisions: { forged: 1 } } : {}),
      })).rejects.toThrow(/validation.*authoriz/i)
      await expect(access(marker)).rejects.toThrow()
    } finally { await rm(root, { recursive: true, force: true }) }
  })

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
      const session = ctx.sessions.create(SessionId('profile-revision'), { meta: { agentPreset: 'pactflow', cwd: root } })
      const authorize = Reflect.get(ctx.pactflow, 'assertValidationProfilesCurrent').bind(ctx.pactflow)
      const snapshot: Pick<PactFlowGitRunSpec, 'validationCommands' | 'validationProfileIds' | 'validationProfileRevisions'> = {
        validationCommands: [{ command: 'git', args: ['status', '--short'], timeoutMs: 5_000 }],
        validationProfileIds: ['git-status'], validationProfileRevisions: { 'git-status': 1 },
      }
      await expect(authorize(session, snapshot)).resolves.toHaveLength(1)
      for (const changed of [
        { command: process.execPath, args: ['status', '--short'], timeoutMs: 5_000 },
        { command: 'git', args: ['status', '--porcelain'], timeoutMs: 5_000 },
        { command: 'git', args: ['status', '--short'], timeoutMs: 6_000 },
      ]) {
        await expect(authorize(session, { ...snapshot, validationCommands: [changed] })).rejects.toThrow(/authorization/)
      }
      await expect(ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 0, profiles: [],
      })).rejects.toThrow(/revision mismatch/)
      await expect(ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 1,
        profiles: [{ id: 'shell', displayName: 'Shell', command: '/bin/sh', args: ['-c', 'echo unsafe'], timeoutMs: 5_000 }],
      })).rejects.toThrow(/shell wrapper/)
      await ctx.pactflow.saveValidationProfiles({
        workspaceId: 'workspace-1', expectedRevision: 1,
        profiles: [{ id: 'git-status', displayName: 'Git status', command: 'git', args: ['status', '--porcelain'], timeoutMs: 5_000 }],
      })
      await expect(authorize(session, snapshot)).rejects.toThrow(/changed after Git binding/)
      await ctx.fiber.dispose()
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
