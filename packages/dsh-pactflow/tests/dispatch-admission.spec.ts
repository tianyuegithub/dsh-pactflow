import { approveExecutionPlanFixture } from './execution-plan-fixture.ts'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowInfrastructure } from '../src/infrastructure.ts'
import type { PactFlowInfrastructureSettings } from '../src/types.ts'

describe('PactFlow post-queue admission', () => {
  it.each(['pool', 'template', 'model', 'cluster', 'unchanged'] as const)('captures the selected %s configuration in the route snapshot', async mode => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    try {
      const settings: PactFlowInfrastructureSettings = {
        clusters: [{ id: 'cluster', displayName: 'Cluster', namespace: 'test', pollIntervalMs: 1000 }],
        registries: [{ id: 'registry', displayName: 'Registry', kind: 'harbor', endpoint: 'https://registry.invalid',
          project: 'test', tlsVerify: true, imagePullSecret: 'pull' }], gitProviders: [],
        templates: [{ id: 'dsh', displayName: 'DSH', harness: 'dsh', registryId: 'registry', repository: 'worker',
          artifactDigest: `sha256:${'a'.repeat(64)}`, cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi' }],
        modelConnections: [{ id: 'model', displayName: 'Model', apiMode: 'openai-chat-completions', model: 'original',
          baseUrl: 'https://model.invalid', apiKeyCredentialRef: 'TEST_MODEL_KEY' }],
        workerPools: [{ id: 'pool', displayName: 'Pool', clusterId: 'cluster', registryId: 'registry',
          templateIds: ['dsh'], maxConcurrency: 1, queuePolicy: 'fifo' }],
      }
      Reflect.get(ctx.pactflow, 'k3sByPool').set('pool', {})
      Reflect.set(ctx.pactflow, 'infrastructure', new PactFlowInfrastructure(settings))
      const resolve = Reflect.get(ctx.pactflow, 'resolveK3sDispatch').bind(ctx.pactflow)
      const before = resolve('pool', 'dsh', 'model').configurationSnapshot
      const next = { ...settings,
        ...(mode === 'pool' ? { workerPools: settings.workerPools.map(pool => ({ ...pool, maxConcurrency: 2 })) } : {}),
        ...(mode === 'template' ? { templates: settings.templates.map(template => ({ ...template, cpuLimit: '2' })) } : {}),
        ...(mode === 'model' ? { modelConnections: settings.modelConnections!.map(model => ({ ...model, model: 'changed' })) } : {}),
        ...(mode === 'cluster' ? { clusters: settings.clusters.map(cluster => ({ ...cluster, namespace: 'changed' })) } : {}),
      }
      Reflect.set(ctx.pactflow, 'infrastructure', new PactFlowInfrastructure(next))
      const after = resolve('pool', 'dsh', 'model').configurationSnapshot
      expect(after === before).toBe(mode === 'unchanged')
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['workspace', 'project', 'route', 'cancelled', 'unchanged'] as const)('rechecks %s before claim and releases its slot', async mode => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    const capacity = Reflect.get(ctx.pactflow, 'executionCapacity')
    const resume = capacity.pauseAdmission()
    const release = vi.fn()
    const acquire = capacity.acquire.bind(capacity)
    capacity.acquire = async (...args: unknown[]) => {
      const originalRelease = await acquire(...args)
      return () => { release(); originalRelease() }
    }
    try {
      const session = ctx.sessions.create(SessionId('queued-project'), { meta: { agentPreset: 'pactflow', cwd: '/isolated' } })
      const project = ctx.pactflow.initialize(session.id, { name: 'Queued' })
      const binding = { remote: 'origin', remoteUrl: '/isolated/remote', defaultBranch: 'main', revision: 1,
        boundAt: 1, validationCommands: [], k3sGitSecretName: 'pactflow-git-secret' }
      session.append('pactflow/project-configured', { v: 1, project: { ...project, revision: 2, git: binding } })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      let workspace = { revision: 1 }
      let snapshot = 'original-route'
      const worker = { preflight: vi.fn(), preflightRun: vi.fn(), plan: () => ({ templateId: 'dsh',
        namespace: 'test', jobName: 'job', configMapName: 'result', image: `registry.invalid/image@sha256:${'a'.repeat(64)}`,
        imagePullSecret: 'pull', harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model',
        baseUrl: 'https://model.invalid', modelSecretName: 'model-secret', gitSecretName: 'git-secret',
        cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
        activeDeadlineSeconds: 60, finishedJobTtlSeconds: 60,
        runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64) }), run: vi.fn() }
      const materialize = vi.fn().mockRejectedValue(new Error('isolated materialization boundary'))
      Reflect.set(ctx.pactflow, 'workspaceProjectForSession', async () => workspace)
      Reflect.set(ctx.pactflow, 'assertValidationProfilesCurrent', async () => [])
      Reflect.set(ctx.pactflow, 'resolveK3sDispatch', () => ({ worker, executionTemplateId: 'dsh', configurationSnapshot: snapshot }))
      Reflect.set(ctx.pactflow, 'git', { plan: async () => ({ ...binding, baseCommit: 'a'.repeat(40),
        branch: 'pactflow/task', worktreePath: '/isolated/task' }), materialize })
      const controller = new AbortController()
      await approveExecutionPlanFixture(ctx, session.id, 'task', { kind: 'k3s', templateId: 'dsh' }, node.id)
      const pending = ctx.pactflow.dispatchK3sNodeWithSignal(session.id, { nodeId: node.id,
        expectedRevision: node.revision, templateId: 'dsh', prompt: 'task', leaseDurationMs: 60_000 }, controller.signal)
      void pending.catch(() => {})
      await vi.waitFor(() => expect(session.events.some(event => event.type === 'pactflow/run-queued')).toBe(true))
      if (mode === 'workspace') workspace = { revision: 2 }
      if (mode === 'project') session.append('pactflow/project-configured', { v: 1,
        project: { ...project, revision: 3, git: { ...binding, revision: 2 } } })
      if (mode === 'route') snapshot = 'changed-route'
      // Cancellation after the scheduler has resolved, before the awaiting caller resumes.
      resume()
      if (mode === 'cancelled') controller.abort()
      if (mode === 'unchanged') {
        expect((await pending).run.state).toBe('failed')
        expect(materialize).toHaveBeenCalledTimes(1)
      } else {
        await expect(pending).rejects.toThrow(/changed|revision|cancelled/i)
        expect(materialize).not.toHaveBeenCalled()
        expect(session.events.filter(event => event.type === 'pactflow/run-claimed')).toHaveLength(0)
        expect(session.events.filter(event => event.type === 'pactflow/run-queue-cancelled')).toHaveLength(1)
      }
      expect(worker.run).not.toHaveBeenCalled()
      expect(release).toHaveBeenCalledTimes(1)
    } finally { resume(); await ctx.fiber.dispose() }
  })
})
