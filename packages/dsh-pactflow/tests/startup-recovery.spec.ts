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

describe('PactFlow startup discovery', () => {
  it('does not let a cancelled scan clear a newer inventory failure', async () => {
    const target = await harness()
    let finish!: (value: unknown[]) => void
    const records = new Promise<unknown[]>(resolve => { finish = resolve })
    try {
      const controller = new AbortController()
      const recover = Reflect.get(target.pactflow, 'recoverPersistedSessions').bind(target.pactflow)
      const pending = recover({ listSessions: () => records }, { resolveAgent: vi.fn() }, controller.signal)
      void pending.catch(() => {})
      controller.abort()
      const capacity = Reflect.get(target.pactflow, 'executionCapacity')
      capacity.setInventoryFailure('startup', 'newer recovery failed')
      finish([])
      await expect(pending).rejects.toThrow()
      await expect(capacity.acquire({ workspaceId: undefined, policy: undefined, profileId: undefined, poolId: undefined,
        signal: undefined, resolveInfrastructure: () => undefined })).rejects.toThrow('newer recovery failed')
    } finally { finish([]); await target.fiber.dispose() }
  })

  it('rejects admission after scan failure and clears the failure after a successful rescan', async () => {
    const target = await harness()
    try {
      const controller = { resolveAgent: vi.fn() }
      const query = { listSessions: vi.fn().mockRejectedValueOnce(new Error('storage unavailable')).mockResolvedValue([]) }
      const recover = Reflect.get(target.pactflow, 'recoverPersistedSessions').bind(target.pactflow)
      await expect(recover(query, controller, new AbortController().signal)).rejects.toThrow('storage unavailable')
      const capacity = Reflect.get(target.pactflow, 'executionCapacity')
      const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: undefined,
        signal: undefined, resolveInfrastructure: () => undefined }
      await expect(capacity.acquire(input)).rejects.toThrow(/startup recovery failed/)
      await recover(query, controller, new AbortController().signal)
      const release = await capacity.acquire(input)
      release()
      expect(controller.resolveAgent).not.toHaveBeenCalled()
    } finally { await target.fiber.dispose() }
  })

  it.each(['direct', 'injected'] as const)('resumes only cold roots with outstanding responsibility without sending model input: %s', async mode => {
    const source = await harness()
    const target = await harness()
    try {
      const pending = source.sessions.create(SessionId('pending-root'), { meta: { agentPreset: 'pactflow', cwd: '/isolated' } })
      source.pactflow.initialize(pending.id, { name: 'Pending' })
      const need = source.pactflow.createNeed(pending.id, { id: 'need', title: 'Need', description: '' })
      pending.append('pactflow/cleanup-recorded', { v: 1, record: { id: 'cleanup', needId: need.id,
        target: 'closing:test', state: 'failed', attempt: 1, nextRetryAt: Date.now() + 60_000 } })
      const idle = source.sessions.create(SessionId('idle-root'), { meta: { agentPreset: 'pactflow', cwd: '/isolated' } })
      source.pactflow.initialize(idle.id, { name: 'Idle' })
      const ordinary = source.sessions.create(SessionId('ordinary'), { meta: { agentPreset: 'standard', cwd: '/isolated' } })
      const stored = [pending, idle, ordinary].map(session => ({ session: session.header, events: [...session.events] }))
      const query = { listSessions: async () => stored.map(value => ({ header: value.session })),
        readSession: async (id: string) => stored.find(value => value.session.id === id)! }
      const send = vi.fn()
      const resolveAgent = vi.fn(async (id: string) => {
        const value = stored.find(item => item.session.id === id)!
        const session = target.sessions.create(SessionId(id), { seed: value.events, meta: value.session })
        return { agent: { id, session, send } }
      })
      if (mode === 'direct') {
        await Reflect.get(target.pactflow, 'recoverPersistedSessions').call(target.pactflow, query, { resolveAgent }, new AbortController().signal)
      } else {
        target.provide('sessionQuery', query as never)
        target.provide('sessionController', { resolveAgent } as never)
        await vi.waitFor(() => expect(target.sessions.get(pending.id)).toBeDefined())
      }
      expect(resolveAgent).toHaveBeenCalledTimes(1)
      expect(resolveAgent).toHaveBeenCalledWith(pending.id)
      expect(send).not.toHaveBeenCalled()
      expect(target.sessions.get(pending.id)).toBeDefined()
      expect(target.sessions.get(idle.id)).toBeUndefined()
      expect(target.sessions.get(ordinary.id)).toBeUndefined()
    } finally { await target.fiber.dispose(); await source.fiber.dispose() }
  })
})
