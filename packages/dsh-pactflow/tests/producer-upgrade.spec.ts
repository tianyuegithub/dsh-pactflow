import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_EVENT_PRODUCER_VERSION,
  PACTFLOW_EVENT_TYPES_V0_6,
  PACTFLOW_EVENT_TYPES_V0_7,
  PACTFLOW_EVENT_TYPES_V0_8,
} from '../src/domain.ts'

/**
 * Sessions created before this release must stay writable after it.
 *
 * This is not a hypothetical: the 0.5.0 -> 0.6.0 bump permanently froze every
 * session created before it. The host required a session's persisted producer
 * declaration to match the writing handle exactly, so a 0.6.0 handle could never
 * write into a session that had already persisted 0.5.0 — plan confirmation,
 * node creation, dispatch and recovery all became unavailable on those sessions,
 * and read-only access was all that remained. Nobody had tested the path.
 *
 * The upstream declaration-upgrade channel now admits an upgrade when BOTH hold:
 * the new version is strictly greater than every persisted one, and the latest
 * persisted vocabulary is a subset of the new one. These cases pin both halves
 * against the real session runtime rather than asserting them on paper.
 *
 * Working assumption, stated honestly: this runs against the linked DSH fork,
 * where the upgrade channel is implemented. The upstream PR is not merged, so an
 * official release could still land a different design.
 */

const PRODUCER = 'dsh-pactflow'

const bootSession = async (ctx: Context, id: string) => {
  await ctx.plugin(SessionStore)
  return ctx.sessions.create(SessionId(id), { meta: { agentPreset: 'pactflow' } })
}

const declarations = (session: { events: readonly { type: string; data: unknown }[] }) =>
  session.events
    .filter(event => event.type === 'session/external-event-producer')
    .map(event => event.data as { producer: string; version: string; eventTypes: readonly string[] })
    .filter(declaration => declaration.producer === PRODUCER)

describe('PactFlow external producer upgrade', () => {
  it('keeps a session created under 0.6.0 writable after the upgrade to 0.7.0', async () => {
    const ctx = new Context()
    try {
      const session = await bootSession(ctx, 'producer-upgrade-old-session')

      // An "old" session: it already persisted a 0.6.0 declaration by writing.
      const legacy = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: '0.6.0', eventTypes: PACTFLOW_EVENT_TYPES_V0_6,
      })
      legacy.append(session, 'pactflow/need-created', {
        v: 1,
        need: { id: 'need-legacy' as never, title: 'Legacy', description: '', phase: 'backlog', revision: 1, createdAt: 1, updatedAt: 1 },
      })
      expect(declarations(session).map(entry => entry.version)).toEqual(['0.6.0'])

      // This release's handle writes one of the new event types into it.
      const current = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: PACTFLOW_EVENT_PRODUCER_VERSION, eventTypes: PACTFLOW_EVENT_TYPES_V0_8,
      })
      expect(() => current.append(session, 'pactflow/comment-added', {
        v: 1,
        comment: {
          id: 'comment-00000000-0000-0000-0000-000000000000' as never,
          needId: 'need-legacy' as never, author: 'human', body: 'still writable', createdAt: 2,
        },
      })).not.toThrow()

      // The upgrade is recorded rather than rewriting the old declaration.
      expect(declarations(session).map(entry => entry.version)).toEqual(['0.6.0', PACTFLOW_EVENT_PRODUCER_VERSION])
      expect(session.events.some(event => event.type === 'pactflow/comment-added')).toBe(true)
    } finally { await ctx.fiber.dispose() }
  })

  it('still refuses an upgrade that drops a previously declared event type', async () => {
    // The adversarial half: proves the case above exercises the upgrade gate
    // rather than a runtime that admits anything. Dropping one type from the
    // vocabulary breaks the superset condition, so the old session must freeze —
    // exactly the failure 0.5.0 -> 0.6.0 hit.
    const ctx = new Context()
    try {
      const session = await bootSession(ctx, 'producer-upgrade-narrowed')
      const legacy = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: '0.6.0', eventTypes: PACTFLOW_EVENT_TYPES_V0_6,
      })
      legacy.append(session, 'pactflow/need-created', {
        v: 1,
        need: { id: 'need-legacy' as never, title: 'Legacy', description: '', phase: 'backlog', revision: 1, createdAt: 1, updatedAt: 1 },
      })

      const narrowed = PACTFLOW_EVENT_TYPES_V0_8.filter(type => type !== 'pactflow/document-linked')
      const broken = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: '0.7.0', eventTypes: narrowed as never,
      })
      expect(() => broken.append(session, 'pactflow/comment-added', {
        v: 1,
        comment: {
          id: 'comment-00000000-0000-0000-0000-000000000001' as never,
          needId: 'need-legacy' as never, author: 'human', body: 'should not land', createdAt: 2,
        },
      })).toThrow(/conflicting declaration/)
    } finally { await ctx.fiber.dispose() }
  })

  it('still refuses a handle whose version does not advance the session', async () => {
    // Downgrade direction: a session already writing 0.7.0 must not accept an
    // older handle. Without this the ordering guarantee would be one-way only,
    // and a stale deployment could interleave two vocabularies in one log.
    const ctx = new Context()
    try {
      const session = await bootSession(ctx, 'producer-upgrade-not-advancing')
      const current = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: PACTFLOW_EVENT_PRODUCER_VERSION, eventTypes: PACTFLOW_EVENT_TYPES_V0_8,
      })
      current.append(session, 'pactflow/need-created', {
        v: 1,
        need: { id: 'need-current' as never, title: 'Current', description: '', phase: 'backlog', revision: 1, createdAt: 1, updatedAt: 1 },
      })

      const older = ctx.sessions.externalEventProducers.register({
        producer: PRODUCER, version: '0.6.0', eventTypes: PACTFLOW_EVENT_TYPES_V0_6,
      })
      expect(() => older.append(session, 'pactflow/need-updated', {
        v: 1,
        need: { id: 'need-current' as never, title: 'Downgraded', description: '', phase: 'backlog', revision: 2, createdAt: 1, updatedAt: 2 },
      })).toThrow(/conflicting declaration/)
    } finally { await ctx.fiber.dispose() }
  })

  it('carries every historical vocabulary forward so old logs stay readable', () => {
    // The superset condition above is what makes an upgrade possible at all;
    // breaking it silently would re-freeze old sessions.
    for (const type of PACTFLOW_EVENT_TYPES_V0_6) expect(PACTFLOW_EVENT_TYPES_V0_7).toContain(type)
    for (const type of PACTFLOW_EVENT_TYPES_V0_7) expect(PACTFLOW_EVENT_TYPES_V0_8).toContain(type)
  })
})
