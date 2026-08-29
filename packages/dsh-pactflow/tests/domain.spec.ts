import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'

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
      version: '0.1.0',
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
    ctx.pactflow.recordReview(session.id, {
      needId: backlog.id, kind: 'requirement', decision: 'approved', note: '范围确认',
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
    ctx.pactflow.recordReview(session.id, {
      needId: backlog.id, kind: 'design', decision: 'approved', note: '设计批准',
    })
    const planning = ctx.pactflow.transitionNeed(session.id, {
      needId: backlog.id, expectedRevision: design.revision, to: 'planning',
    })
    expect(planning).toMatchObject({ phase: 'planning', revision: 5 })
    expect(ctx.sessionProjections.snapshot(session).values.pactflowNeeds)
      .toMatchObject({ byId: { 'need-1': { phase: 'planning', revision: 5 } } })
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
})
