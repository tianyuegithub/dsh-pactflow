import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime, { defineTool } from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PACTFLOW_EVENT_TYPES_V0_2 } from '../src/domain.ts'
import * as PactFlowAgentTools from '../presets/pactflow/plugin/index.js'
import { createGitFixture, serveAuthenticatedGit, type AuthenticatedGitServer } from './git-fixture.ts'
import { recordAuthorizedReview } from './review-fixture.ts'

async function harness(): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  return ctx
}

describe('PactFlow domain foundation', () => {
  it('initializes one project through the external producer and eager projection', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('project-1'), {
      meta: { agentPreset: 'pactflow' },
    })

    const project = ctx.pactflow.initialize(session.id, { name: '  Data Governance  ' })

    expect(project).toMatchObject({
      id: 'project-1',
      name: 'Data Governance',
      revision: 1,
    })
    expect(session.events.map(event => event.type)).toEqual([
      'session/external-event-producer',
      'pactflow/project-initialized',
    ])
    expect(session.events[0]?.data).toMatchObject({
      producer: 'dsh-pactflow',
      version: '0.3.0',
    })
    expect(ctx.pactflow.project(session.id)).toEqual({ project })
    expect(ctx.sessionProjections.snapshot(session).values.pactflowProject).toEqual({ project })
  })

  it('rejects wrong preset, blank names, duplicate initialization, and non-live ids', async () => {
    const ctx = await harness()
    const standard = ctx.sessions.create(SessionId('standard'), {
      meta: { agentPreset: 'standard' },
    })
    expect(() => ctx.pactflow.initialize(standard.id, { name: 'wrong' }))
      .toThrow(/not composed from the pactflow preset/)

    const pactflow = ctx.sessions.create(SessionId('pactflow'), {
      meta: { agentPreset: 'pactflow' },
    })
    expect(() => ctx.pactflow.initialize(pactflow.id, { name: '   ' }))
      .toThrow(/name must be non-empty/)
    ctx.pactflow.initialize(pactflow.id, { name: 'one' })
    expect(() => ctx.pactflow.initialize(pactflow.id, { name: 'two' }))
      .toThrow(/already owns a PactFlow project/)
    expect(() => ctx.pactflow.project('missing')).toThrow(/is not live/)
  })

  it('fails closed without the producer and cold-restores projections after exact reinstall', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-domain-'))
    try {
      const writer = await harness()
      await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const session = writer.sessions.create(SessionId('cold-project'), {
        meta: { agentPreset: 'pactflow' },
      })
      const project = writer.pactflow.initialize(session.id, { name: 'Cold project' })
      await writer.sessions.flush(session)

      const missing = new Context()
      await missing.plugin(SessionStore)
      await missing.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      await expect(missing.sessionPersistence.load(session.id))
        .rejects.toThrow(/required external session event producer "dsh-pactflow"/)

      const reader = await harness()
      await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const stored = await reader.sessionPersistence.load(session.id)
      reader.provide('sessionQuery', {
        readSession: () => Promise.resolve({ session: stored.meta, events: [...stored.events] }),
      } as never)
      await expect(reader.pactflow.snapshot(session.id)).resolves.toMatchObject({
        project: { project },
      })
      const restored = reader.sessions.prepare(session.id, {
        seed: structuredClone([...stored.events]),
        meta: structuredClone(stored.meta),
        seedSource: 'persistence',
      })
      expect(reader.sessionProjections.snapshot(restored).values.pactflowProject)
        .toEqual({ project })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('cold-restores the exact 0.2.0 producer tuple after upgrading to 0.2.1', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-v0-2-upgrade-'))
    try {
      const writer = new Context()
      await writer.plugin(SessionStore)
      await writer.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const events = writer.sessions.externalEventProducers.register({
        producer: 'dsh-pactflow',
        version: '0.2.0',
        eventTypes: PACTFLOW_EVENT_TYPES_V0_2,
      })
      const session = writer.sessions.create(SessionId('v0-2-project'), {
        meta: { agentPreset: 'pactflow' },
      })
      const project = {
        id: 'v0-2-project', name: '0.2.0 project', revision: 1,
        createdAt: 1_788_056_000_000, updatedAt: 1_788_056_000_000,
      }
      events.append(session, 'pactflow/project-initialized', { v: 1, project })
      await writer.sessions.flush(session)

      const reader = await harness()
      await reader.plugin(JsonlSessionPersistence, { root, compression: 'none' })
      const stored = await reader.sessionPersistence.load(session.id)
      const restored = reader.sessions.prepare(session.id, {
        seed: structuredClone([...stored.events]),
        meta: structuredClone(stored.meta),
        seedSource: 'persistence',
      })
      expect(reader.sessionProjections.snapshot(restored).values.pactflowProject)
        .toEqual({ project })
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('enforces sequential phases, revision CAS, and human review gates', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('workflow-project'), {
      meta: { agentPreset: 'pactflow' },
    })
    ctx.pactflow.initialize(session.id, { name: 'Workflow' })
    const backlog = ctx.pactflow.createNeed(session.id, {
      id: 'need-1',
      title: 'Ship workflow',
      description: 'Implement the stage machine',
    })
    expect(backlog.phase).toBe('backlog')

    const discussion = ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: 1, to: 'discussion',
    })
    expect(() => ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: 2, to: 'confirmed',
    })).toThrow(/requires latest requirement review approval/)
    recordAuthorizedReview(ctx.pactflow, session, { ...backlog, revision: discussion.revision }, {
      kind: 'requirement', decision: 'approved', note: '范围确认',
    })
    const confirmed = ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: discussion.revision, to: 'confirmed',
    })
    expect(() => ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: 2, to: 'design',
    })).toThrow(/revision conflict/)
    const design = ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: confirmed.revision, to: 'design',
    })
    expect(() => ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: design.revision, to: 'executing',
    })).toThrow(/illegal PactFlow phase transition/)
    recordAuthorizedReview(ctx.pactflow, session, { ...backlog, revision: design.revision }, {
      kind: 'design', decision: 'approved', note: '设计批准',
    })
    const planning = ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: design.revision, to: 'planning',
    })
    expect(planning).toMatchObject({ phase: 'planning', revision: 5 })
    expect(ctx.sessionProjections.snapshot(session).values.pactflowNeeds)
      .toMatchObject({ byId: { 'need-1': { phase: 'planning', revision: 5 } } })
  })

  it('shows legacy approved reviews without allowing them to unlock a new gate', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('legacy-review'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Legacy review' })
    const need = ctx.pactflow.createNeed(session.id, { id: 'legacy', title: 'Legacy', description: '' })
    const discussion = ctx.pactflow.transitionNeed(session.id, {
      needId: need.id, expectedRevision: need.revision, to: 'discussion',
    })
    session.append('pactflow/review-recorded', {
      v: 1,
      review: {
        id: 'legacy-review', needId: need.id, kind: 'requirement', decision: 'approved',
        note: 'old approval', recordedAt: Date.now(),
      },
    })
    expect(() => ctx.pactflow.transitionNeed(session.id, {
      needId: need.id, expectedRevision: discussion.revision, to: 'confirmed',
    })).toThrow(/requires latest requirement review approval/)
  })

  it('enforces acyclic dependencies, atomic claim/settle, and first terminal result', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('dag-project'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'DAG' })
    ctx.pactflow.createNeed(session.id, { id: 'need-a', title: 'Need A', description: '' })
    ctx.pactflow.createNeed(session.id, { id: 'need-b', title: 'Need B', description: '' })
    const root = ctx.pactflow.createNode(session.id, {
      id: 'root', needId: 'need-a', title: 'Root', dependencies: [],
    })
    const child = ctx.pactflow.createNode(session.id, {
      id: 'child', needId: 'need-a', title: 'Child', dependencies: ['root'],
    })
    expect(root.state).toBe('ready')
    expect(child.state).toBe('pending')
    expect(() => ctx.pactflow.updateNodeDependencies(session.id, {
      nodeId: 'root', expectedRevision: 1, dependencies: ['child'],
    })).toThrow(/would create a cycle/)

    const other = ctx.pactflow.createNode(session.id, {
      id: 'other', needId: 'need-b', title: 'Other', dependencies: [],
    })
    expect(() => ctx.pactflow.updateNodeDependencies(session.id, {
      nodeId: other.id, expectedRevision: other.revision, dependencies: ['root'],
    })).toThrow(/belongs to another need/)

    const claim = ctx.pactflow.claimNode(session.id, {
      nodeId: root.id, expectedRevision: root.revision, provider: 'local', leaseDurationMs: 60_000,
    })
    expect(claim).toMatchObject({ node: { state: 'claimed', revision: 2 }, run: { attempt: 1, state: 'claimed' } })
    expect(() => ctx.pactflow.claimNode(session.id, {
      nodeId: root.id, expectedRevision: 1, provider: 'local', leaseDurationMs: 60_000,
    })).toThrow(/revision conflict/)
    expect(() => ctx.pactflow.renewRun(session.id, {
      runId: claim.run.id, claimId: 'wrong', leaseDurationMs: 60_000,
    })).toThrow(/claim identity mismatch/)
    const running = ctx.pactflow.renewRun(session.id, {
      runId: claim.run.id, claimId: claim.run.claimId, leaseDurationMs: 60_000,
    })
    const settled = ctx.pactflow.settleRun(session.id, {
      runId: running.run.id,
      claimId: running.run.claimId,
      expectedNodeRevision: running.node.revision,
      state: 'succeeded',
      outcome: 'commit abc',
    })
    expect(settled.node.state).toBe('succeeded')
    expect(ctx.pactflow.dag(session.id).byId.child).toMatchObject({ state: 'ready', revision: 2 })
    expect(() => ctx.pactflow.settleRun(session.id, {
      runId: running.run.id,
      claimId: running.run.claimId,
      expectedNodeRevision: settled.node.revision,
      state: 'failed',
      outcome: 'late duplicate',
    })).toThrow(/already has a terminal result/)
  })

  it('rejects a result after its lease expires without changing node state', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T00:00:00Z'))
    try {
      const ctx = await harness()
      const session = ctx.sessions.create(SessionId('expired-project'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Expired' })
      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, {
        id: 'node', needId: 'need', title: 'Node', dependencies: [],
      })
      const claim = ctx.pactflow.claimNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'k3s', leaseDurationMs: 1_000,
      })
      vi.advanceTimersByTime(1_000)
      expect(() => ctx.pactflow.settleRun(session.id, {
        runId: claim.run.id,
        claimId: claim.run.claimId,
        expectedNodeRevision: claim.node.revision,
        state: 'succeeded',
        outcome: 'too late',
      })).toThrow(/after lease expiry/)
      expect(ctx.pactflow.dag(session.id).byId.node).toMatchObject({ state: 'claimed', revision: 2 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('reconciles an expired local Run once, restores the node to ready, and increments the next attempt', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T00:00:00Z'))
    try {
      const ctx = await harness()
      const session = ctx.sessions.create(SessionId('expired-local-project'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Expired local' })
      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const ready = ctx.pactflow.createNode(session.id, {
        id: 'node', needId: 'need', title: 'Node', dependencies: [],
      })
      const claimed = ctx.pactflow.claimNode(session.id, {
        nodeId: ready.id, expectedRevision: ready.revision, provider: 'spawn', leaseDurationMs: 1_000,
      })
      const running = ctx.pactflow.renewRun(session.id, {
        runId: claimed.run.id, claimId: claimed.run.claimId, leaseDurationMs: 1_000,
      })

      vi.advanceTimersByTime(1_000)
      const first = await ctx.pactflow.reconcileRuns(session.id)
      expect(first.runs.byId[running.run.id]).toMatchObject({
        state: 'failed',
        outcome: 'Local Worker lease expired after Host restart; prior outcome is unknown',
      })
      expect(first.dag.byId.node).toMatchObject({ state: 'ready', revision: 4 })

      const eventCount = session.events.length
      const repeated = await ctx.pactflow.reconcileRuns(session.id)
      expect(repeated.dag.byId.node).toMatchObject({ state: 'ready', revision: 4 })
      expect(session.events).toHaveLength(eventCount)

      const attempt2 = ctx.pactflow.claimNode(session.id, {
        nodeId: 'node', expectedRevision: 4, provider: 'k3s:dsh', leaseDurationMs: 60_000,
      })
      expect(attempt2).toMatchObject({
        node: { state: 'claimed', revision: 5 },
        run: { state: 'claimed', attempt: 2 },
      })
    } finally {
      vi.useRealTimers()
    }
  })

  it('schedules active local Run expiry when the PactFlow Agent is recreated', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-30T00:00:00Z'))
    try {
      const ctx = await harness()
      const session = ctx.sessions.create(SessionId('scheduled-local-recovery'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Scheduled local recovery' })
      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const ready = ctx.pactflow.createNode(session.id, {
        id: 'node', needId: 'need', title: 'Node', dependencies: [],
      })
      const claimed = ctx.pactflow.claimNode(session.id, {
        nodeId: ready.id, expectedRevision: ready.revision, provider: 'spawn', leaseDurationMs: 1_000,
      })
      const running = ctx.pactflow.renewRun(session.id, {
        runId: claimed.run.id, claimId: claimed.run.claimId, leaseDurationMs: 1_000,
      })

      ctx.emit('agent/created', { agent: { id: session.id, session } as Agent })
      expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[running.run.id]?.state).toBe('running')
      vi.advanceTimersByTime(999)
      expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[running.run.id]?.state).toBe('running')
      vi.advanceTimersByTime(1)
      expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[running.run.id]).toMatchObject({ state: 'failed' })
      expect(ctx.pactflow.dag(session.id).byId.node).toMatchObject({ state: 'ready', revision: 4 })
    } finally {
      vi.useRealTimers()
    }
  })

  it('safely retries only terminal failed or cancelled nodes with no active Run', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('retry-project'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Retry' })
    ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
    const ready = ctx.pactflow.createNode(session.id, {
      id: 'node', needId: 'need', title: 'Node', dependencies: [],
    })
    const claimed = ctx.pactflow.claimNode(session.id, {
      nodeId: ready.id, expectedRevision: ready.revision, provider: 'spawn', leaseDurationMs: 60_000,
    })
    expect(() => ctx.pactflow.retryNode(session.id, {
      nodeId: ready.id, expectedRevision: claimed.node.revision,
    })).toThrow(/still owns an active Run/)

    const failed = ctx.pactflow.settleRun(session.id, {
      runId: claimed.run.id,
      claimId: claimed.run.claimId,
      expectedNodeRevision: claimed.node.revision,
      state: 'failed',
      outcome: 'worker failed',
    })
    const retryable = ctx.pactflow.retryNode(session.id, {
      nodeId: ready.id, expectedRevision: failed.node.revision,
    })
    expect(retryable).toMatchObject({ state: 'ready', revision: 4 })
    expect(() => ctx.pactflow.retryNode(session.id, {
      nodeId: ready.id, expectedRevision: failed.node.revision,
    })).toThrow(/revision conflict/)
  })

  it('discovers projects only from Session headers and reads live projections', async () => {
    const ctx = await harness()
    const pactflow = ctx.sessions.create(SessionId('listed-pactflow'), { meta: { agentPreset: 'pactflow' } })
    const project = ctx.pactflow.initialize(pactflow.id, { name: 'Listed' })
    const standard = ctx.sessions.create(SessionId('listed-standard'), { meta: { agentPreset: 'standard' } })
    ctx.provide('sessionQuery', {
      listSessions: () => Promise.resolve([
        { header: pactflow.header, live: true, persisted: false },
        { header: standard.header, live: true, persisted: false },
      ]),
      readSession: () => Promise.reject(new Error('live project must not cold-read')),
    } as never)

    await expect(ctx.pactflow.listProjects()).resolves.toEqual([{
      sessionId: pactflow.id,
      live: true,
      persisted: false,
      project,
    }])
  })

  it('dispatches a local Subagent only after parent/provider preflight and settles its Run', async () => {
    const ctx = await harness()
    const session = ctx.sessions.create(SessionId('local-worker'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Local worker' })
    ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
    const node = ctx.pactflow.createNode(session.id, {
      id: 'worker-node', needId: 'need', title: 'Worker node', dependencies: [],
    })
    const parent = { id: session.id, session }
    let disposed = false
    let receivedPrompt = ''
    ctx.provide('agents', { get: () => parent } as never)
    ctx.provide('subagents', {
      getProvider: (name: string) => name === 'spawn' ? { name } : undefined,
      start: (_name: string, request: { prompt: readonly { type: string; text?: string }[] }) => {
        receivedPrompt = request.prompt[0]?.text ?? ''
        return Promise.resolve({
          id: SessionId('child'),
          localAgent: undefined,
          result: receivedPrompt === 'infrastructure failure'
            ? Promise.reject(new Error('worker transport disconnected'))
            : Promise.resolve({
              output: [{ type: 'text', text: 'implemented commit abc' }],
              stopReason: 'completed',
            }),
          dispose: () => { disposed = true; return Promise.resolve() },
        })
      },
    } as never)

    const settled = await ctx.pactflow.dispatchLocalNode(session.id, {
      nodeId: node.id,
      expectedRevision: node.revision,
      provider: 'spawn',
      leaseDurationMs: 60_000,
      prompt: 'Implement the node',
    })
    expect(receivedPrompt).toBe('Implement the node')
    expect(disposed).toBe(true)
    expect(settled).toMatchObject({
      node: { state: 'succeeded' },
      run: { state: 'succeeded', outcome: 'implemented commit abc' },
    })

    const untouched = ctx.pactflow.createNode(session.id, {
      id: 'untouched', needId: 'need', title: 'Untouched', dependencies: [],
    })
    await expect(ctx.pactflow.dispatchLocalNode(session.id, {
      nodeId: untouched.id,
      expectedRevision: untouched.revision,
      provider: 'missing',
      leaseDurationMs: 60_000,
      prompt: 'must not claim',
    })).rejects.toThrow(/not registered/)
    expect(ctx.pactflow.dag(session.id).byId.untouched).toMatchObject({ state: 'ready', revision: 1 })

    const infrastructure = ctx.pactflow.createNode(session.id, {
      id: 'infrastructure', needId: 'need', title: 'Infrastructure', dependencies: [],
    })
    const failed = await ctx.pactflow.dispatchLocalNode(session.id, {
      nodeId: infrastructure.id,
      expectedRevision: infrastructure.revision,
      provider: 'spawn',
      leaseDurationMs: 60_000,
      prompt: 'infrastructure failure',
    })
    expect(failed).toMatchObject({
      node: { state: 'failed' },
      run: { state: 'failed', outcome: 'worker transport disconnected' },
    })
  })

  it('binds a real Git checkout and accepts only a clean descendant Worker commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-git-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { remote, workspace } = createGitFixture(root)

      const ctx = await harness()
      const session = ctx.sessions.create(SessionId('git-worker'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Git worker' })
      const project = await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision,
        remote: 'origin',
        defaultBranch: 'main',
        validationCommands: [{ command: 'git', args: ['status', '--short'], timeoutMs: 5_000 }],
      })
      expect(project).toMatchObject({
        revision: 2,
        git: {
          remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1,
          validationCommands: [{ command: 'git', args: ['status', '--short'], timeoutMs: 5_000 }],
        },
      })
      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, {
        id: 'git-node', needId: 'need', title: 'Git node', dependencies: [],
      })
      const parent = { id: session.id, session }
      let childCwd = ''
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: (name: string) => name === 'spawn'
          ? { name, capabilities: { cwd: true } }
          : name === 'no-cwd' ? { name, capabilities: { cwd: false } } : undefined,
        start: (_name: string, request: { cwd?: string; prompt: readonly { type: string; text?: string }[] }) => {
          childCwd = request.cwd ?? ''
          if (request.prompt[0]?.text !== 'no commit') {
            execFileSync('git', ['-C', childCwd, 'config', 'user.name', 'PactFlow Worker'])
            execFileSync('git', ['-C', childCwd, 'config', 'user.email', 'worker@example.invalid'])
            execFileSync('git', ['-C', childCwd, 'commit', '--allow-empty', '-m', 'worker commit'])
          }
          return Promise.resolve({
            id: SessionId('git-child'), localAgent: undefined,
            result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
            dispose: () => Promise.resolve(),
          })
        },
      } as never)

      const settled = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn',
        leaseDurationMs: 60_000, prompt: 'commit the task',
      })
      expect(childCwd).toBe(settled.run.git?.worktreePath)
      expect(childCwd).toContain(join(root, '.dsh', 'pactflow', 'worktrees'))
      expect(settled).toMatchObject({
        node: { state: 'succeeded' },
        run: {
          state: 'succeeded',
          git: { remote: 'origin', remoteUrl: remote, defaultBranch: 'main' },
          gitResult: { branch: settled.run.git?.branch },
        },
      })
      expect(settled.run.gitResult?.commit).toMatch(/^[0-9a-f]{40,64}$/)
      expect(settled.run.gitResult).toMatchObject({
        remoteRef: `refs/remotes/origin/${settled.run.git?.branch}`,
      })
      expect(settled.run.gitResult?.syncedAt).toEqual(expect.any(Number))
      expect(settled.run.gitResult?.validations).toEqual([{
        command: 'git', args: ['status', '--short'], timeoutMs: 5_000,
        exitCode: 0, durationMs: expect.any(Number),
      }])
      const remoteCommit = execFileSync('git', [
        '--git-dir', remote, 'rev-parse', `refs/heads/${settled.run.git?.branch}^{commit}`,
      ], { encoding: 'utf8' }).trim()
      expect(remoteCommit).toBe(settled.run.gitResult?.commit)

      const noCommit = ctx.pactflow.createNode(session.id, {
        id: 'no-commit', needId: 'need', title: 'No commit', dependencies: [],
      })
      await expect(ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: noCommit.id, expectedRevision: noCommit.revision, provider: 'no-cwd',
        leaseDurationMs: 60_000, prompt: 'must not claim',
      })).rejects.toThrow(/cannot select a task worktree/)
      expect(ctx.pactflow.dag(session.id).byId['no-commit']).toMatchObject({ state: 'ready', revision: 1 })

      const missingCommit = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: noCommit.id, expectedRevision: noCommit.revision, provider: 'spawn',
        leaseDurationMs: 60_000, prompt: 'no commit',
      })
      expect(missingCommit).toMatchObject({
        node: { state: 'failed' },
        run: { state: 'failed', outcome: 'PactFlow Worker produced no commit' },
      })

      const currentProject = ctx.pactflow.project(session.id).project!
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: currentProject.revision,
        remote: 'origin',
        defaultBranch: 'main',
        validationCommands: [{
          command: process.execPath, args: ['-e', 'process.exit(7)'], timeoutMs: 5_000,
        }],
      })
      const invalid = ctx.pactflow.createNode(session.id, {
        id: 'invalid', needId: 'need', title: 'Invalid', dependencies: [],
      })
      const validationFailure = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: invalid.id, expectedRevision: invalid.revision, provider: 'spawn',
        leaseDurationMs: 60_000, prompt: 'validation failure',
      })
      expect(validationFailure).toMatchObject({
        node: { state: 'failed' },
        run: { state: 'failed', outcome: expect.stringMatching(/validation command failed.*exit 7/) },
      })
      expect(() => execFileSync('git', [
        '--git-dir', remote, 'show-ref', '--verify', `refs/heads/${validationFailure.run.git?.branch}`,
      ], { stdio: 'ignore' })).toThrow()
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('stores only an HTTPS credential reference and requires configured Credentials', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-git-auth-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    let gitServer: AuthenticatedGitServer | undefined
    try {
      const { remote, workspace } = createGitFixture(root)
      gitServer = await serveAuthenticatedGit(root, remote, 'pactflow-worker', 'secret-token-value')
      execFileSync('git', [
        '-C', workspace, 'remote', 'set-url', 'origin', gitServer.url,
      ])
      const ctx = await harness()
      const session = ctx.sessions.create(SessionId('git-auth'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const project = ctx.pactflow.initialize(session.id, { name: 'Git auth' })
      const request = {
        expectedRevision: project.revision,
        remote: 'origin',
        defaultBranch: 'main',
        username: 'pactflow-worker',
        credentialRef: 'PACTFLOW_GITEA_TOKEN',
        giteaBaseUrl: gitServer.url,
        giteaOwner: 'owner',
        giteaRepo: 'repo',
        giteaTokenCredentialRef: 'PACTFLOW_GITEA_API_TOKEN',
        giteaUsername: 'pactflow-worker',
      }
      await expect(ctx.pactflow.bindGit(session.id, request))
        .rejects.toThrow(/requires the Credentials service/)
      expect(ctx.pactflow.project(session.id).project?.revision).toBe(1)

      const resolveCredential = vi.fn(() => Promise.resolve({ value: 'secret-token-value', source: 'memory' }))
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: resolveCredential,
      } as never)
      const bound = await ctx.pactflow.bindGit(session.id, request)
      expect(bound.git?.auth).toEqual({
        kind: 'https-token', username: 'pactflow-worker', credentialRef: 'PACTFLOW_GITEA_TOKEN',
      })
      expect(bound.git?.gitea).toEqual({
        baseUrl: gitServer.url,
        owner: 'owner', repo: 'repo', tokenCredentialRef: 'PACTFLOW_GITEA_API_TOKEN',
        username: 'pactflow-worker',
      })
      expect(resolveCredential).not.toHaveBeenCalled()

      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, {
        id: 'auth-node', needId: 'need', title: 'Auth node', dependencies: [],
      })
      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: (_name: string, worker: { cwd?: string }) => {
          execFileSync('git', ['-C', worker.cwd!, 'config', 'user.name', 'PactFlow Worker'])
          execFileSync('git', ['-C', worker.cwd!, 'config', 'user.email', 'worker@example.invalid'])
          execFileSync('git', ['-C', worker.cwd!, 'commit', '--allow-empty', '-m', 'authenticated commit'])
          return Promise.resolve({
            id: SessionId('auth-child'), localAgent: undefined,
            result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
            dispose: () => Promise.resolve(),
          })
        },
      } as never)
      const settled = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn',
        leaseDurationMs: 60_000, prompt: 'commit through authenticated HTTP',
      })
      expect(settled.run.state).toBe('succeeded')
      expect(resolveCredential).toHaveBeenCalledTimes(1)
      expect(JSON.stringify(session.events)).not.toContain('secret-token-value')
    } finally {
      await gitServer?.close()
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves an auto-matched Gitea Basic Auth username through event validation and projection', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-gitea-username-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      execFileSync('git', [
        '-C', workspace, 'remote', 'set-url', 'origin', 'ssh://git@git.example:22/owner/repo.git',
      ])
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
            tokenCredentialRef: 'PACTFLOW_GITEA_PASSWORD', username: 'alice',
          }],
        },
      })
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
      } as never)
      const session = ctx.sessions.create(SessionId('gitea-basic-auth'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const project = ctx.pactflow.initialize(session.id, { name: 'Gitea Basic Auth' })
      const bound = await ctx.pactflow.bindGit(session.id, {
        expectedRevision: project.revision, remote: 'origin', defaultBranch: 'main',
      })
      expect(bound.git?.gitea).toMatchObject({
        baseUrl: 'https://git.example', owner: 'owner', repo: 'repo',
        tokenCredentialRef: 'PACTFLOW_GITEA_PASSWORD', username: 'alice',
      })
      expect(ctx.sessionProjections.stateOf(session, 'pactflowProject')?.project?.git?.gitea?.username)
        .toBe('alice')
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('registers the PactFlow tools only in the PactFlow Agent scope', async () => {
    const ctx = await harness()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const session = ctx.sessions.create(SessionId('tool-project'), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Tools' })
    ctx.pactflow.createNeed(session.id, { id: 'tool-need', title: 'Tool need', description: '' })
    const agent = { id: session.id, session } as Agent
    ctx.provide('approval', {
      request: ({ agent: requestingAgent, callId, reason }: { agent: Agent; callId: string; reason?: string }) => {
        const id = `approval-${String(requestingAgent.session.events.length)}`
        requestingAgent.session.append('approval/asked', {
          id, toolName: 'pactflow_record_review', callId, ...(reason === undefined ? {} : { reason }),
        })
        requestingAgent.session.append('approval/decided', { id, outcome: 'allowed-once' })
        return Promise.resolve('allowed-once' as const)
      },
    } as never)
    let scoped!: ReturnType<typeof createScope>
    await ctx.plugin(Object.assign((inner: Context) => {
      scoped = createScope(inner, agent)
    }, { inject: ['tools', 'pactflow'] }))
    await scoped.ctx.plugin(PactFlowAgentTools)

    expect(ctx.tools.schemas(agent).map(schema => schema.name).sort()).toEqual([
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
    ])
    expect(ctx.tools.schemas().map(schema => schema.name)).not.toContain('pactflow_view')
    const result = await ctx.tools.execute({
      callId: ToolCallId('pactflow-view'),
      name: 'pactflow_view',
      arguments: {},
      agent,
      signal: new AbortController().signal,
    })
    expect(result.isError).toBe(false)
    expect(result.content[0]).toMatchObject({ type: 'text' })
    const reviewResult = await ctx.tools.execute({
      callId: ToolCallId('pactflow-record-review'),
      name: 'pactflow_record_review',
      arguments: {
        need_id: 'tool-need', expected_revision: 1,
        kind: 'requirement', decision: 'approved', note: 'requirements verified',
      },
      agent,
      signal: new AbortController().signal,
    })
    expect(reviewResult.isError).toBe(false)
    expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.reviews ?? {}))
      .toContainEqual(expect.objectContaining({
        needId: 'tool-need', kind: 'requirement', decision: 'approved', note: 'requirements verified',
      }))
  })

  it('makes the PactFlow orchestrator read-only while preserving ordinary and Worker tools', async () => {
    const ctx = await harness()
    await ctx.plugin(SystemPrompt, {})
    await ctx.plugin(ToolRuntime)
    const output = {
      schema: { type: 'string' as const },
      render: (_args: unknown, value: string) => [{ type: 'text' as const, text: value }],
    }
    const tool = (name: string) => defineTool({
      name, description: name, parameters: {}, output,
      execute: () => Promise.resolve(`ran:${name}`),
    })
    const scopeUnder = async (
      key: Parameters<typeof createScope>[1],
      parent?: Parameters<typeof createScope>[2]['parent'],
    ): Promise<ReturnType<typeof createScope>> => {
      let scope!: ReturnType<typeof createScope>
      await ctx.plugin(Object.assign((inner: Context) => {
        scope = createScope(inner, key, parent === undefined ? {} : { parent })
      }, { inject: ['tools', 'pactflow'] }))
      return scope
    }
    for (const name of ['bash', 'write', 'read']) ctx.tools.register(tool(name))

    const presetKey = { agentPreset: 'pactflow' }
    const presetScope = await scopeUnder(presetKey)
    presetScope.ctx.tools.register(tool('edit'))
    await presetScope.ctx.plugin(PactFlowAgentTools)

    const session = ctx.sessions.create(SessionId('readonly-orchestrator'), {
      meta: { agentPreset: 'pactflow' },
    })
    const agent = { id: session.id, session } as Agent
    const agentScope = await scopeUnder(agent, presetKey)
    Reflect.set(agent, 'ctx', agentScope.ctx)
    agentEvents(ctx, agent).emit('agent/session-start', { source: 'resume' })

    const orchestratorTools = ctx.tools.schemas(agent).map(schema => schema.name)
    expect(orchestratorTools).toContain('read')
    expect(orchestratorTools).toContain('pactflow_dispatch_git')
    expect(orchestratorTools).toContain('pactflow_dispatch_k3s')
    expect(orchestratorTools).not.toContain('pactflow_dispatch_local')
    expect(orchestratorTools).not.toContain('bash')
    expect(orchestratorTools).not.toContain('write')
    expect(orchestratorTools).not.toContain('edit')

    const blocked = await ctx.tools.execute({
      callId: ToolCallId('readonly-bash'), name: 'bash', arguments: {}, agent,
      signal: new AbortController().signal,
    })
    expect(blocked).toMatchObject({ isError: true })
    expect(blocked.content[0]).toMatchObject({
      type: 'text',
      text: 'Error: 零脉编排器禁止直接调用 bash；请通过 pactflow_dispatch_git 或 pactflow_dispatch_k3s 在隔离任务分支执行。',
    })

    const ordinarySession = ctx.sessions.create(SessionId('ordinary-agent'), {
      meta: { agentPreset: 'standard' },
    })
    const ordinary = { id: ordinarySession.id, session: ordinarySession } as Agent
    const ordinaryScope = await scopeUnder(ordinary)
    Reflect.set(ordinary, 'ctx', ordinaryScope.ctx)
    expect(ctx.tools.schemas(ordinary).map(schema => schema.name).sort()).toEqual(['bash', 'read', 'write'])

    const workerSession = ctx.sessions.create(SessionId('pactflow-worker'), {
      meta: { agentPreset: 'standard' },
    })
    const worker = { id: workerSession.id, session: workerSession } as Agent
    const workerScope = await scopeUnder(worker, agent)
    Reflect.set(worker, 'ctx', workerScope.ctx)
    for (const name of ['bash', 'write', 'edit']) workerScope.ctx.tools.register(tool(name))
    expect(ctx.tools.schemas(worker).map(schema => schema.name)).toEqual(expect.arrayContaining([
      'bash', 'write', 'edit',
    ]))

    await workerScope.dispose()
    await ordinaryScope.dispose()
    await agentScope.dispose()
    await presetScope.dispose()
  })
})
