import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'

describe('PactFlow cleanup retry concurrency', () => {
  it('does not execute pre-merge cleanup intent before delivery proof', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('cleanup-release-gate'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Cleanup' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      session.append('pactflow/cleanup-recorded', { v: 1, record: { id: 'cleanup', needId: need.id,
        target: 'closing:test', requiresRelease: true, state: 'pending', attempt: 1 } })
      const action = vi.fn().mockResolvedValue(undefined)
      Reflect.set(ctx.pactflow, 'cleanupAction', action)
      expect(await ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' }))
        .toMatchObject({ state: 'failed', error: expect.stringContaining('verified release') })
      expect(action).not.toHaveBeenCalled()
      session.append('pactflow/release-recorded', { v: 1, release: { needId: need.id,
        commit: 'a'.repeat(40), branch: 'main', recordedAt: Date.now() } })
      expect(await ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' })).toMatchObject({ state: 'succeeded' })
      expect(action).toHaveBeenCalledTimes(1)
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['exact', 'legacy', 'mismatched'] as const)('handles %s persisted integration target without preparing or pushing branches again', async mode => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('cleanup-target'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Cleanup' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const closing = { branch: 'pactflow/closing/project/r1', commit: 'a'.repeat(40), worktreePath: '/isolated/closing-worktree' }
      session.append('pactflow/cleanup-recorded', { v: 1, record: {
        id: 'cleanup', needId: need.id, target: `closing:${mode === 'mismatched' ? 'other' : closing.branch}`,
        ...(mode === 'legacy' ? {} : { closing }),
        state: 'failed', attempt: 1, error: 'temporary failure',
      } })
      const prepareClosing = vi.fn().mockRejectedValue(new Error('must not prepare branches during cleanup'))
      const cleanupClosing = vi.fn().mockResolvedValue(undefined)
      Reflect.set(ctx.pactflow, 'git', { prepareClosing, cleanupClosing })
      const result = await ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' })
      if (mode !== 'exact') {
        expect(result).toMatchObject({ state: 'failed', error: expect.stringContaining('exact persisted target') })
        expect(prepareClosing).not.toHaveBeenCalled()
        expect(cleanupClosing).not.toHaveBeenCalled()
        return
      }
      expect(result).toMatchObject({ state: 'succeeded', closing })
      expect(prepareClosing).not.toHaveBeenCalled()
      expect(cleanupClosing).toHaveBeenCalledWith(undefined, closing)
      const checkpoint = ctx.sessionProjections.checkpoint(session)
      expect(ctx.sessionProjections.viewCheckpoint(checkpoint).pactflowDelivery?.cleanups.cleanup).toMatchObject({ closing })
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['new-failure', 'restored-failure', 'disposed'] as const)('automatically retries %s only when due', async mode => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('cleanup-due'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Cleanup' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      vi.useFakeTimers()
      session.append('pactflow/cleanup-recorded', { v: 1, record: {
        id: 'cleanup', needId: need.id, target: 'closing:test', state: 'failed', attempt: 1, error: 'temporary failure',
        ...(mode !== 'new-failure' ? { nextRetryAt: Date.now() + 5_000 } : {}),
      } })
      const action = vi.fn().mockResolvedValue(undefined)
      Reflect.set(ctx.pactflow, 'cleanupAction', action)
      if (mode === 'new-failure') {
        action.mockRejectedValueOnce(new Error('temporarily unavailable'))
        await ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' })
      } else {
        await Reflect.get(ctx.pactflow, 'reconcileCleanups').call(ctx.pactflow, session)
      }
      const due = mode === 'new-failure' ? 2_000 : 5_000
      if (mode === 'disposed') {
        expect(vi.getTimerCount()).toBe(1)
        await ctx.fiber.dispose()
        await vi.advanceTimersByTimeAsync(due)
        expect(action).not.toHaveBeenCalled()
        expect(vi.getTimerCount()).toBe(0)
        return
      }
      await vi.advanceTimersByTimeAsync(due - 1)
      expect(action).toHaveBeenCalledTimes(mode === 'new-failure' ? 1 : 0)
      await vi.advanceTimersByTimeAsync(1)
      expect(action).toHaveBeenCalledTimes(mode === 'new-failure' ? 2 : 1)
      expect(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups.cleanup)
        .toMatchObject({ state: 'succeeded', attempt: mode === 'new-failure' ? 3 : 2 })
      expect(vi.getTimerCount()).toBe(0)
    } finally { await ctx.fiber.dispose(); vi.useRealTimers() }
  })

  it('joins concurrent retries without executing cleanup twice or advancing attempts twice', async () => {
    const ctx = new Context()
    let finish!: () => void
    const gate = new Promise<void>(resolve => { finish = resolve })
    const pending: Promise<unknown>[] = []
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('cleanup-concurrency'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Cleanup' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      session.append('pactflow/cleanup-recorded', { v: 1, record: {
        id: 'cleanup', needId: need.id, target: 'closing:test', state: 'failed', attempt: 1, error: 'temporary failure',
      } })
      const action = vi.fn(() => gate)
      Reflect.set(ctx.pactflow, 'cleanupAction', action)
      pending.push(ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' }))
      pending.push(ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' }))
      void Promise.allSettled(pending)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(action).toHaveBeenCalledTimes(1)
      finish()
      const results = await Promise.all(pending)
      expect(results).toEqual([
        expect.objectContaining({ state: 'succeeded', attempt: 2 }),
        expect.objectContaining({ state: 'succeeded', attempt: 2 }),
      ])
      await ctx.pactflow.retryCleanup(session.id, { cleanupId: 'cleanup' })
      expect(action).toHaveBeenCalledTimes(1)
    } finally {
      finish()
      await Promise.allSettled(pending)
      await ctx.fiber.dispose()
    }
  })
})
