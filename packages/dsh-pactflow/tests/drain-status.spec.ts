import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'

// A12 uninstall drain: the only thing an operator can decide "is uninstalling safe
// now?" from. It must be read-only, must cover live AND cold sessions (the common
// uninstall case is a stopped host), and must never clean anything up itself.
async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  return ctx
}

/** Boot a PactFlow project session with one ready node and return its ids. */
function projectWithNode(ctx: Context, id: string) {
  const session = ctx.sessions.create(SessionId(id), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Drain' })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
  return { session, node }
}

function liveQuery(sessions: { header: { id: string } }[]) {
  return {
    listSessions: () => Promise.resolve(sessions.map(session => ({ header: session.header, live: true, persisted: false }))),
    readSession: () => Promise.reject(new Error('live project must not cold-read')),
  }
}

describe('PactFlow uninstall drain status', () => {
  it('reports safe-to-uninstall when no run is active and no cleanup is open', async () => {
    const ctx = await harness()
    try {
      const { session } = projectWithNode(ctx, 'drain-idle')
      ctx.provide('sessionQuery', liveQuery([session]) as never)
      await expect(ctx.pactflow.drainStatus()).resolves.toEqual({
        safeToUninstall: true, activeRuns: [], pendingCleanups: [],
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('reports not-safe and lists an active run with its session and run identity', async () => {
    const ctx = await harness()
    try {
      const { session, node } = projectWithNode(ctx, 'drain-active')
      const claimed = ctx.pactflow.claimNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'local', leaseDurationMs: 60_000,
      })
      ctx.provide('sessionQuery', liveQuery([session]) as never)
      const status = await ctx.pactflow.drainStatus()
      expect(status.safeToUninstall).toBe(false)
      expect(status.activeRuns).toEqual([
        { sessionId: session.id, runId: claimed.run.id, nodeId: node.id, state: 'claimed' },
      ])
      expect(status.pendingCleanups).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('reports not-safe and lists an unfinished cleanup responsibility, marking retained scenes', async () => {
    const ctx = await harness()
    try {
      const { session } = projectWithNode(ctx, 'drain-cleanup')
      session.append('pactflow/cleanup-recorded', { v: 1, record: {
        id: 'cleanup', needId: 'need', target: 'closing:test', state: 'failed', attempt: 1, retain: true,
      } })
      ctx.provide('sessionQuery', liveQuery([session]) as never)
      const status = await ctx.pactflow.drainStatus()
      expect(status.safeToUninstall).toBe(false)
      expect(status.pendingCleanups).toEqual([
        { sessionId: session.id, id: 'cleanup', target: 'closing:test', state: 'failed', retain: true },
      ])
      expect(status.activeRuns).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('binds the operator manual uninstall step to the Remote the Host actually exposes', () => {
    const source = readFileSync(resolve(import.meta.dirname, '../src/index.ts'), 'utf8')
    // The Host must actually register this Remote name...
    expect(source).toContain("@Remote('drainStatus')")
    // ...and the manual must reference the same name, so doc and code cannot drift.
    const opsDoc = readFileSync(
      resolve(import.meta.dirname, '../../..', 'docs', 'installation-operations-安装运维.md'), 'utf8',
    )
    expect(opsDoc).toContain('pactflow/drainStatus')
    expect(opsDoc).toMatch(/safeToUninstall/)
  })

  it('reads a cold session from disk (the common uninstall case) and is repeatable without side effects', async () => {
    const source = await harness()
    const target = await harness()
    try {
      const { session } = projectWithNode(source, 'drain-cold')
      source.pactflow.claimNode(session.id, { nodeId: 'node', expectedRevision: 1, provider: 'local', leaseDurationMs: 60_000 })
      const stored = [{ session: session.header, events: [...session.events] }]
      target.provide('sessionQuery', {
        listSessions: async () => stored.map(value => ({ header: value.session, live: false, persisted: true })),
        readSession: async (id: string) => stored.find(value => value.session.id === id)!,
      } as never)
      const first = await target.pactflow.drainStatus()
      const second = await target.pactflow.drainStatus()
      expect(first).toEqual(second)
      expect(first.safeToUninstall).toBe(false)
      expect(first.activeRuns).toHaveLength(1)
      // The cold-read path must not have created a live session as a side effect.
      expect(target.sessions.get(session.id)).toBeUndefined()
    } finally { await source.fiber.dispose(); await target.fiber.dispose() }
  })
})
