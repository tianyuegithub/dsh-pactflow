import { approveExecutionPlanFixture, unconfinedWorkerContextFixture } from './execution-plan-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

describe('PactFlow local failure retention', () => {
  it('records a retained, discoverable responsibility without deleting the failed scene', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-local-retain-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('local-retain'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Retain' })
      await ctx.pactflow.bindGit(session.id, { expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      const parent = { id: session.id, session, ctx: unconfinedWorkerContextFixture() }
      ctx.provide('agents', { get: () => parent } as never)
      // The worker fails after the worktree is materialized, leaving a real worktree on disk.
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: (_p: string, request: { cwd?: string }) => {
          void request
          return Promise.reject(new Error('local worker failed'))
        },
      } as never)

      await approveExecutionPlanFixture(ctx, session.id, 'commit', { kind: 'git', provider: 'spawn' }, node.id)
      const settled = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'commit',
      })
      expect(settled.run.state).toBe('failed')
      const worktree = settled.run.git!.worktreePath
      // The failed scene is kept on disk (uncommitted work may be worth diagnosing).
      await expect(access(worktree)).resolves.toBeUndefined()
      const cleanups = Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {})
      const retained = cleanups.find(record => record.retain === true && record.target === `git:${settled.run.git!.branch}`)
      expect(retained).toBeDefined()
      expect(retained?.state).toBe('pending')

      // Session recovery reconciliation keeps the retained record discoverable and the
      // failed scene on disk (the guard's skip semantics are pinned deterministically in
      // `cleanup-retention-guard.spec.ts`).
      await Reflect.get(ctx.pactflow, 'reconcileCleanups').call(ctx.pactflow, session)
      await expect(access(worktree)).resolves.toBeUndefined()
      const after = ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[retained!.id]
      expect(after).toMatchObject({ retain: true, target: `git:${settled.run.git!.branch}` })
      expect(after?.state).not.toBe('succeeded')
      void git
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not create a duplicate retained record when settled more than once', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-local-retain-once-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('local-retain-once'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Retain once' })
      await ctx.pactflow.bindGit(session.id, { expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      const parent = { id: session.id, session, ctx: unconfinedWorkerContextFixture() }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: () => Promise.reject(new Error('local worker failed')),
      } as never)
      await approveExecutionPlanFixture(ctx, session.id, 'commit', { kind: 'git', provider: 'spawn' }, node.id)
      const settled = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'commit',
      })
      const retain = Reflect.get(ctx.pactflow, 'retainLocalFailure').bind(ctx.pactflow) as (s: typeof session, r: typeof settled.run) => void
      retain(session, settled.run)
      retain(session, settled.run)
      const retained = Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {})
        .filter(record => record.retain === true)
      expect(retained).toHaveLength(1)
      void vi
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
