import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'
import {
  PACTFLOW_DEFAULT_RETENTION_BYTES,
  PACTFLOW_DEFAULT_RETENTION_MS,
  isRetentionOverdue,
  measureRetainedSceneBytes,
  summarizeRetainedScenes,
  summarizeRetentionCapacity,
} from '../src/retention-policy.ts'

const DAY = 24 * 60 * 60 * 1_000

describe('PactFlow failure-scene retention policy', () => {
  it('marks a retained scene overdue only past its retention window', () => {
    const record = { id: 'c1', retain: true, retainUntil: 1_000 + DAY }
    expect(isRetentionOverdue(record, 1_000 + DAY)).toBe(false)
    expect(isRetentionOverdue(record, 1_000 + DAY + 1)).toBe(true)
  })

  it('never treats a non-retained record as overdue', () => {
    expect(isRetentionOverdue({ id: 'c1' }, Date.now() + 10 * DAY)).toBe(false)
  })

  it('summarises retained scenes, listing only overdue ones separately', () => {
    const now = 1_000
    const summary = summarizeRetainedScenes([
      { id: 'fresh', retain: true, retainUntil: now + DAY },
      { id: 'old', retain: true, retainUntil: now - 1 },
      { id: 'ordinary', target: 'git:x' },
    ], now)
    expect(summary.total).toBe(2)
    expect(summary.overdue.map(record => record.id)).toEqual(['old'])
  })

  it('exposes a bounded default retention window', () => {
    expect(PACTFLOW_DEFAULT_RETENTION_MS).toBeGreaterThan(0)
    expect(PACTFLOW_DEFAULT_RETENTION_MS).toBeLessThanOrEqual(90 * DAY)
  })
})

describe('PactFlow retention disk capacity (A05 increment)', () => {
  it('sums recorded sizes and flags over-budget only when every scene is measured', () => {
    const now = 1_000
    // All measured: the total is a true total.
    const measured = summarizeRetentionCapacity([
      { id: 'a', retain: true, sizeBytes: 40 },
      { id: 'b', retain: true, sizeBytes: 70 },
      { id: 'ordinary', target: 'git:x', sizeBytes: 999 },
    ], 100, now)
    expect(measured.total).toBe(2)
    expect(measured.retainedBytes).toBe(110)
    expect(measured.measured).toBe(true)
    expect(measured.overBudget).toBe(true)
    expect(measured.maxBytes).toBe(100)

    // One unmeasured scene: the sum is a lower bound, so it must not claim a true total.
    const partial = summarizeRetentionCapacity([
      { id: 'a', retain: true, sizeBytes: 40 },
      { id: 'b', retain: true },
    ], 100, now)
    expect(partial.retainedBytes).toBe(40)
    expect(partial.measured).toBe(false)
    expect(partial.overBudget).toBe(false)
  })

  it('reports retainedBytes 0 / measured true when there is nothing retained', () => {
    const empty = summarizeRetentionCapacity([{ id: 'ordinary', target: 'git:x' }], 100, 1_000)
    expect(empty.total).toBe(0)
    expect(empty.retainedBytes).toBe(0)
    expect(empty.measured).toBe(true)
    expect(empty.overBudget).toBe(false)
  })

  it('measures a directory tree and caps the walk instead of running unbounded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-retention-bytes-'))
    try {
      writeFileSync(join(root, 'a.bin'), Buffer.alloc(1_000))
      writeFileSync(join(root, 'b.bin'), Buffer.alloc(2_000))
      const measured = measureRetainedSceneBytes(root, 1_000_000)
      expect(measured.bytes).toBe(3_000)
      expect(measured.capped).toBe(false)

      // Cap below the tree size: result is a lower bound and honest about capping.
      const capped = measureRetainedSceneBytes(root, 1_500)
      expect(capped.capped).toBe(true)
      expect(capped.bytes).toBeLessThanOrEqual(1_500 + 2_000)

      // A missing root is unmeasured-but-safe, not a throw on the failure path.
      expect(measureRetainedSceneBytes(join(root, 'nope')).bytes).toBe(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('exposes a bounded default byte budget', () => {
    expect(PACTFLOW_DEFAULT_RETENTION_BYTES).toBeGreaterThan(0)
  })
})

describe('PactFlow retention status end to end', () => {
  it('records a retention window on the retained scene and reports it read-only', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-retention-e2e-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('retention'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Retention' })
      await ctx.pactflow.bindGit(session.id, { expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: () => Promise.reject(new Error('local worker failed')),
      } as never)

      const settled = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'commit',
      })
      expect(settled.run.state).toBe('failed')

      const status = ctx.pactflow.retentionStatus(session.id)
      expect(status.total).toBe(1)
      // Freshly retained: not yet overdue.
      expect(status.overdue).toEqual([])
      // A05 capacity: the retained worktree is measured, so the total is a true total.
      expect(status.measured).toBe(true)
      expect(status.retainedBytes).toBeGreaterThan(0)
      expect(status.overBudget).toBe(false)
      expect(status.maxBytes).toBe(PACTFLOW_DEFAULT_RETENTION_BYTES)
      const cleanups = Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {})
      const retained = cleanups.find(record => record.retain === true)!
      expect(typeof retained.retainUntil).toBe('number')
      expect(retained.retainUntil!).toBeGreaterThan(Date.now())
      expect(typeof retained.sizeBytes).toBe('number')
      expect(retained.sizeBytes!).toBeGreaterThan(0)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
