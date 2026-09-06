import { describe, expect, it } from 'vitest'
import { pactflowProjectProjection, pactflowRunsProjection, pactflowDeliveryProjection } from '../src/domain.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import PactFlowService from '../lib/index.js'

describe('PactFlow persisted projection schemas', () => {
  it('uses parsed payloads in live projections while leaving the immutable log untouched', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('parsed-live-state'), { meta: { agentPreset: 'pactflow' } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Parsed state' })
      const next = { ...project, revision: 2, extraUnvalidated: 'must not enter projection', git: {
        remote: 'origin', remoteUrl: 'ssh://git@example.invalid/org/repo.git', defaultBranch: 'main', revision: 1,
        boundAt: 1, validationCommands: [], extraUnvalidated: 'nested extra',
      } }
      session.append('pactflow/project-configured', { v: 1, project: next })
      const live = ctx.sessionProjections.stateOf(session, 'pactflowProject')!
      expect(live.project).not.toHaveProperty('extraUnvalidated')
      expect(live.project?.git).not.toHaveProperty('extraUnvalidated')
      const checkpoint = ctx.sessionProjections.checkpoint(session)
      expect(ctx.sessionProjections.viewCheckpoint(checkpoint).pactflowProject).toEqual(live)
      expect(session.events.at(-1)?.data).toMatchObject({ project: { extraUnvalidated: 'must not enter projection' } })
    } finally { await ctx.fiber.dispose() }
  })

  it('rebuilds the private Need index without adding fields to the public DAG', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('dag-index-upgrade'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'DAG' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      const view = { byId: { [node.id]: node } }
      expect(ctx.pactflow.dag(session.id)).toEqual(view)
      expect((await ctx.pactflow.snapshot(session.id)).dag).toEqual(view)
      expect((await ctx.pactflow.snapshot(session.id)).delivery).toEqual({ reviews: {}, documents: {}, releases: {}, cleanups: {} })
      const checkpoint = ctx.sessionProjections.checkpoint(session)
      expect(checkpoint.pactflowDag?.val).toMatchObject({ needIds: [need.id] })
      checkpoint.pactflowDag = { ...checkpoint.pactflowDag!, ver: 2, val: view }
      expect(ctx.sessionProjections.restoreFloor(checkpoint)).toBe(0)
      const restored = ctx.sessionProjections.restore(checkpoint, session.events, 0, session.header)
      expect(restored.checkpoint.pactflowDag?.val).toMatchObject({ needIds: [need.id] })
      expect(restored.snapshot.values.pactflowDag).toEqual(view)
      expect(restored.snapshot.values.pactflowDelivery).toEqual({ reviews: {}, documents: {}, releases: {}, cleanups: {} })
    } finally { await ctx.fiber.dispose() }
  })

  it('preserves the project resource pool through checkpoint and wire parsing', () => {
    const state = { project: { id: 'project', name: 'Project', revision: 1, createdAt: 1, updatedAt: 1, workerPoolId: 'pool' } }
    expect(pactflowProjectProjection.stateSchema.parse(state)).toEqual(state)
    expect(pactflowProjectProjection.wire!.viewSchema.parse(state)).toEqual(state)
  })

  it('preserves every K3s recovery identity and configuration field', () => {
    const state = { byId: { 'run-11111111-2222-3333-4444-555555555555': {
      id: 'run-11111111-2222-3333-4444-555555555555', nodeId: 'node', nodeRevision: 1,
      attempt: 1, provider: 'k3s:dsh', claimId: 'claim', state: 'running', leaseDeadline: 100, updatedAt: 1,
      k3s: {
        workerPoolId: 'pool', projectConfigRevision: 7, agentProfileId: 'profile', modelConnectionId: 'model-connection',
        ephemeralModelSecret: true, templateId: 'dsh', namespace: 'pactflow', jobName: 'job', configMapName: 'config',
        image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull', harness: 'dsh',
        apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
        modelSecretName: 'model-secret', gitSecretName: 'git-secret', inputSecretName: 'input-secret',
        runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64), specDigest: '3'.repeat(64), jobUid: 'job-uid',
        expectedBranch: 'task', expectedBaseCommit: 'b'.repeat(40), cpuRequest: '100m', memoryRequest: '128Mi',
        cpuLimit: '1', memoryLimit: '1Gi', activeDeadlineSeconds: 60, finishedJobTtlSeconds: 60,
      },
    } } }
    expect(pactflowRunsProjection.stateSchema.parse(state)).toEqual(state)
    expect(pactflowRunsProjection.wire!.viewSchema.parse(state)).toEqual(state)
  })

  it('invalidates previously lossy checkpoint versions so the event log is replayed', () => {
    expect(pactflowProjectProjection.stateVersion).toBeGreaterThan(1)
    expect(pactflowRunsProjection.stateVersion).toBeGreaterThan(1)
    expect(pactflowDeliveryProjection.stateVersion).toBeGreaterThan(1)
  })

  it('reconstructs omitted fields from the real Session log instead of a version-one cache', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('checkpoint-upgrade'), { meta: { agentPreset: 'pactflow' } })
      const initial = ctx.pactflow.initialize(session.id, { name: 'Checkpoint' })
      const project = { ...initial, revision: 2, workerPoolId: 'pool', git: {
        remote: 'origin', remoteUrl: 'ssh://git@example.invalid/org/repo.git', defaultBranch: 'main',
        revision: 1, boundAt: 1, validationCommands: [],
      } }
      session.append('pactflow/project-configured', { v: 1, project })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const closing = { branch: 'pactflow/closing/need/r1', commit: 'a'.repeat(40), worktreePath: '/isolated/closing' }
      const record = { id: 'cleanup', needId: need.id, target: `closing:${closing.branch}`, closing,
        requiresRelease: true, state: 'pending' as const, attempt: 1 }
      session.append('pactflow/cleanup-recorded', { v: 1, record })
      const checkpoint = ctx.sessionProjections.checkpoint(session)
      checkpoint.pactflowProject = { ...checkpoint.pactflowProject!, ver: 1, val: { project: initial } }
      const { closing: omitted, requiresRelease: omittedGate, ...oldRecord } = record
      void omitted
      void omittedGate
      checkpoint.pactflowDelivery = { ...checkpoint.pactflowDelivery!, ver: 1,
        val: { reviews: {}, documents: {}, releases: {}, cleanups: { cleanup: oldRecord } } }
      expect(ctx.sessionProjections.restoreFloor(checkpoint)).toBe(0)
      const restored = ctx.sessionProjections.restore(checkpoint, session.events, 0, session.header)
      expect(restored.snapshot.values.pactflowProject?.project).toEqual(project)
      expect(restored.snapshot.values.pactflowDelivery?.cleanups.cleanup).toEqual(record)
    } finally { await ctx.fiber.dispose() }
  })
})
