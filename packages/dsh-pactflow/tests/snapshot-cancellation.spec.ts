import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'

async function harness() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  return ctx
}

describe('PactFlow snapshot cancellation', () => {
  it.each(['before-read', 'during-read'] as const)('stops %s without folding cancelled data', async mode => {
    const source = await harness()
    const target = await harness()
    try {
      const session = source.sessions.create(SessionId('cold-cancel'), { meta: { agentPreset: 'pactflow' } })
      source.pactflow.initialize(session.id, { name: 'Cold' })
      const stored = { session: session.header, events: [...session.events] }
      let finish!: (value: typeof stored) => void
      const read = vi.fn(() => mode === 'before-read' ? Promise.resolve(stored)
        : new Promise<typeof stored>(resolve => { finish = resolve }))
      target.provide('sessionQuery', { readSession: read } as never)
      const restore = vi.spyOn(target.sessionProjections, 'restore')
      const controller = new AbortController()
      if (mode === 'before-read') controller.abort()
      const pending = target.pactflow.snapshot(session.id, controller.signal)
      if (mode === 'during-read') {
        expect(read).toHaveBeenCalledTimes(1)
        controller.abort()
        finish(stored)
      }
      await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
      expect(restore).not.toHaveBeenCalled()
      expect(read).toHaveBeenCalledTimes(mode === 'before-read' ? 0 : 1)
    } finally { await target.fiber.dispose(); await source.fiber.dispose() }
  })
})
