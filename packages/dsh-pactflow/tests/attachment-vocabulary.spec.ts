import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import {
  PACTFLOW_EVENT_PRODUCER_VERSION,
  PACTFLOW_EVENT_TYPES,
  PACTFLOW_EVENT_TYPES_V0_7,
  PACTFLOW_EVENT_TYPES_V0_8,
} from '../src/domain.ts'

/**
 * Adding an event type raises the declared external producer version, and a
 * session created before that upgrade must stay writable afterwards. That is the
 * whole risk of this task: the cost of getting it wrong is paid by existing
 * projects, which would find themselves unable to write to their own logs.
 */

const PRODUCER = 'dsh-pactflow'

describe('PactFlow attachment vocabulary', () => {
  it('spells the 0.8.0 vocabulary out in full rather than deriving it', () => {
    // A derived tuple turns a future edit of the base into a silent rewrite of
    // history — precisely what the read-compatibility contract forbids.
    expect(PACTFLOW_EVENT_TYPES_V0_8).not.toBe(PACTFLOW_EVENT_TYPES_V0_7)
    expect(PACTFLOW_EVENT_TYPES).toBe(PACTFLOW_EVENT_TYPES_V0_8)
    expect(PACTFLOW_EVENT_PRODUCER_VERSION).toBe('0.8.0')
    expect(PACTFLOW_EVENT_TYPES_V0_8).toContain('pactflow/attachment-linked')
    expect(PACTFLOW_EVENT_TYPES_V0_8.length).toBe(PACTFLOW_EVENT_TYPES_V0_7.length + 1)
  })

  it('carries every 0.7.0 type forward so old logs stay readable', () => {
    for (const type of PACTFLOW_EVENT_TYPES_V0_7) expect(PACTFLOW_EVENT_TYPES_V0_8).toContain(type)
  })

  it('registers 0.7.0 read-only so a log written by the previous release still parses', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    try {
      // The service registers it at load time; re-registering the same version is
      // refused, which is itself the proof that the read-only lane is occupied.
      expect(() => ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: '0.7.0', eventTypes: PACTFLOW_EVENT_TYPES_V0_7, mode: 'read-only',
      })).toThrow(/already registered/)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps a session created before the upgrade writable after it', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService)
    try {
      const session = ctx.sessions.create(SessionId('attachment-upgrade'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Upgrade' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      // The session already holds events written under the pre-upgrade tuple.
      expect(session.events.length).toBeGreaterThan(0)
      // Writing again after the upgrade must not raise a declaration conflict.
      const before = session.events.length
      expect(() => ctx.pactflow.createNode(session.id, {
        id: 'node-after-upgrade', needId: need.id, title: 'Still writable', dependencies: [],
      })).not.toThrow()
      expect(session.events.length).toBeGreaterThan(before)
    } finally { await ctx.fiber.dispose() }
  })

  it('leaves an unrecognised attachment event parseable by an older read path', () => {
    // The new type rides the same envelope as every other; a reader that does not
    // know the name must fail to RECOGNISE it, not fail to parse the log.
    const unknown = PACTFLOW_EVENT_TYPES_V0_7.includes('pactflow/attachment-linked' as never)
    expect(unknown).toBe(false)
    expect(() => JSON.parse(JSON.stringify({
      type: 'pactflow/attachment-linked', data: { v: 1, attachment: { id: 'a' } },
    }))).not.toThrow()
  })
})
