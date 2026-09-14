import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import {
  PACTFLOW_COMMENT_RECENT_LIMIT,
  PACTFLOW_EVENT_PRODUCER_VERSION,
  PACTFLOW_EVENT_TYPES,
  PACTFLOW_EVENT_TYPES_V0_6,
  PACTFLOW_EVENT_TYPES_V0_7,
  pactFlowCommentExcerpt,
  pactFlowCommentSubjectKey,
  pactflowCollaborationProjection,
} from '../src/domain.ts'
import { pactFlowDiscussionView } from '../src/discussion-view.ts'
import { PACTFLOW_DEFAULT_RUN_BUDGET, evaluateAgentCommentBudget } from '../src/run-budget.ts'
import type { PactFlowCollaborationState, PactFlowComment } from '../src/types.ts'

// Comments are the first durable discussion surface. They carry no authority —
// no gate, no phase, no approval evidence — and they are log-only: nothing here
// may rewrite or delete one. The projection deliberately keeps counters plus a
// bounded tail so a busy Need does not grow the resident state.

const NEED = 'need-1' as never
const OTHER_NEED = 'need-2' as never
const NODE = 'node-1' as never
const OTHER_NODE = 'node-2' as never
const RUN = 'run-1' as never

let sequence = 0
const event = <T extends string>(type: T, data: unknown): SessionEvent =>
  ({ type, data, seq: ++sequence } as unknown as SessionEvent)

const needCreated = (id: unknown = NEED) =>
  event('pactflow/need-created', {
    v: 1,
    need: { id, title: 't', description: '', phase: 'backlog', revision: 1, createdAt: 1, updatedAt: 1 },
  })

const nodeCreated = (id: unknown, needId: unknown) =>
  event('pactflow/node-created', {
    v: 1,
    node: { id, needId, title: 'n', state: 'ready', revision: 1, dependencies: [], updatedAt: 1 },
  })

const comment = (overrides: Partial<PactFlowComment> = {}): PactFlowComment => ({
  id: `comment-${String(++sequence)}` as never,
  needId: NEED, author: 'human', body: 'hello', createdAt: 1,
  ...overrides,
})

const added = (value: PactFlowComment) => event('pactflow/comment-added', { v: 1, comment: value })
const voided = (commentId: unknown, needId: unknown = NEED) =>
  event('pactflow/comment-voided', { v: 1, commentId, needId, voidedAt: 2 })

const fold = (events: readonly SessionEvent[]): PactFlowCollaborationState =>
  events.reduce<PactFlowCollaborationState>(
    (state, next) => pactflowCollaborationProjection.apply(state, next) as PactFlowCollaborationState,
    pactflowCollaborationProjection.init() as PactFlowCollaborationState,
  )

describe('PactFlow comment vocabulary', () => {
  it('spells 0.7.0 out in full rather than deriving it from the prior tuple', () => {
    // A derived tuple turns a future edit of the base into a silent rewrite of
    // history, which is exactly what the read-compatibility contract forbids.
    expect(PACTFLOW_EVENT_TYPES_V0_7).not.toBe(PACTFLOW_EVENT_TYPES_V0_6)
    expect(PACTFLOW_EVENT_TYPES).toBe(PACTFLOW_EVENT_TYPES_V0_7)
    expect(PACTFLOW_EVENT_PRODUCER_VERSION).toBe('0.7.0')
    expect(PACTFLOW_EVENT_TYPES_V0_7).toContain('pactflow/comment-added')
    expect(PACTFLOW_EVENT_TYPES_V0_7).toContain('pactflow/comment-voided')
    // The new vocabulary is a strict superset of the one before it.
    for (const type of PACTFLOW_EVENT_TYPES_V0_6) expect(PACTFLOW_EVENT_TYPES_V0_7).toContain(type)
    expect(PACTFLOW_EVENT_TYPES_V0_7.length).toBe(PACTFLOW_EVENT_TYPES_V0_6.length + 2)
  })
})

describe('PactFlow comment ownership', () => {
  it('rejects a comment on a Need that does not exist', () => {
    expect(() => fold([added(comment())])).toThrow(/missing Need/)
  })

  it('rejects a comment on a node that does not exist', () => {
    expect(() => fold([needCreated(), added(comment({ nodeId: NODE }))])).toThrow(/missing node/)
  })

  it('rejects a comment whose node belongs to another Need', () => {
    expect(() => fold([
      needCreated(NEED), needCreated(OTHER_NEED),
      nodeCreated(OTHER_NODE, OTHER_NEED),
      added(comment({ needId: NEED, nodeId: OTHER_NODE })),
    ])).toThrow(/crosses Needs/)
  })

  it('accepts a comment on a node inside its own Need', () => {
    const state = fold([needCreated(), nodeCreated(NODE, NEED), added(comment({ nodeId: NODE }))])
    expect(state.counters[`node:${String(NODE)}`]).toEqual({ total: 1, agent: 0 })
  })
})

describe('PactFlow comment authority', () => {
  it('never advances a phase, a node or approval evidence', () => {
    // A comment saying "批准 / approved" is still just text.
    const state = fold([needCreated(), added(comment({ body: '同意，批准合并 approved' }))])
    expect(Object.keys(state.recent[String(NEED)] ?? [])).toHaveLength(1)
    // The projection holds discussion only: it has no phase, node or review field
    // to move, so a comment structurally cannot express approval.
    expect(Object.keys(state)).toEqual(
      expect.arrayContaining(['counters', 'recent', 'needIds', 'nodeNeeds', 'runNeeds']),
    )
    expect(state).not.toHaveProperty('reviews')
    expect(state).not.toHaveProperty('phase')
  })
})

describe('PactFlow comment counters and budget', () => {
  it('counts agent comments per subject and leaves humans uncounted', () => {
    const state = fold([
      needCreated(),
      added(comment({ author: 'agent' })),
      added(comment({ author: 'agent' })),
      added(comment({ author: 'human' })),
    ])
    expect(state.counters[`need:${String(NEED)}`]).toEqual({ total: 3, agent: 2 })
  })

  it('separates counters for the Need and for a node inside it', () => {
    const state = fold([
      needCreated(), nodeCreated(NODE, NEED),
      added(comment({ author: 'agent' })),
      added(comment({ author: 'agent', nodeId: NODE })),
    ])
    expect(state.counters[`need:${String(NEED)}`]).toEqual({ total: 1, agent: 1 })
    expect(state.counters[`node:${String(NODE)}`]).toEqual({ total: 1, agent: 1 })
  })

  it('refuses one more agent comment once the subject is at budget', () => {
    const cap = PACTFLOW_DEFAULT_RUN_BUDGET.maxAgentCommentsPerSubject
    expect(evaluateAgentCommentBudget(cap, cap - 1)).toEqual({ exhausted: false })
    const verdict = evaluateAgentCommentBudget(cap, cap)
    expect(verdict.exhausted).toBe(true)
    expect(verdict).toMatchObject({ reason: 'agent-comments' })
    // The refusal names both sides rather than failing anonymously.
    expect(verdict.exhausted && verdict.detail).toContain(String(cap))
  })

  it('rejects a nonsensical budget instead of silently allowing everything', () => {
    expect(() => evaluateAgentCommentBudget(0, 0)).toThrow(/positive integer/)
    expect(() => evaluateAgentCommentBudget(5, -1)).toThrow(/non-negative integer/)
  })

  it('derives the subject key from the narrowest target', () => {
    expect(pactFlowCommentSubjectKey({ needId: NEED })).toBe(`need:${String(NEED)}`)
    expect(pactFlowCommentSubjectKey({ needId: NEED, nodeId: NODE })).toBe(`node:${String(NODE)}`)
    expect(pactFlowCommentSubjectKey({ needId: NEED, runId: RUN })).toBe(`run:${String(RUN)}`)
  })
})

describe('PactFlow comment voiding', () => {
  it('marks in place without deleting or rewriting the original', () => {
    const target = comment({ body: 'wrong conclusion' })
    const state = fold([needCreated(), added(target), voided(target.id)])
    const tail = state.recent[String(NEED)]!
    expect(tail).toHaveLength(1)
    expect(tail[0]).toMatchObject({ id: target.id, voided: true, excerpt: 'wrong conclusion' })
    // Voiding is not deleting: the counter still reflects that it was written.
    expect(state.counters[`need:${String(NEED)}`]).toEqual({ total: 1, agent: 0 })
  })

  it('rejects a void aimed at a Need that does not exist', () => {
    expect(() => fold([voided('comment-x' as never, OTHER_NEED)])).toThrow(/missing Need/)
  })

  it('treats a void for an aged-out comment as a no-op that cannot inflate counters', () => {
    // Counters move only on comment-added, so a void with nothing resident to
    // mark changes nothing. Proving the target ever existed would need an index
    // of every id ever written — the unbounded growth this projection avoids.
    const state = fold([needCreated(), added(comment()), voided('comment-never-seen' as never)])
    expect(state.counters[`need:${String(NEED)}`]).toEqual({ total: 1, agent: 0 })
    expect(state.recent[String(NEED)]!.every(entry => !entry.voided)).toBe(true)
  })
})

describe('PactFlow comment projection bounds', () => {
  it('keeps the resident tail bounded as a Need accumulates comments', () => {
    const many = Array.from({ length: PACTFLOW_COMMENT_RECENT_LIMIT * 5 }, (_, index) =>
      added(comment({ body: `entry ${String(index)}` })))
    const state = fold([needCreated(), ...many])
    expect(state.recent[String(NEED)]).toHaveLength(PACTFLOW_COMMENT_RECENT_LIMIT)
    // Counters still tell the truth about the total.
    expect(state.counters[`need:${String(NEED)}`]).toEqual({ total: many.length, agent: 0 })
    // The tail is the most recent window, not the oldest one.
    expect(state.recent[String(NEED)]!.at(-1)!.excerpt).toBe(`entry ${String(many.length - 1)}`)
  })

  it('quotes a bounded excerpt rather than storing the body', () => {
    const body = 'x'.repeat(5_000)
    const excerpt = pactFlowCommentExcerpt(body)
    expect(excerpt.length).toBeLessThan(body.length)
    expect(excerpt.endsWith('…')).toBe(true)
    const state = fold([needCreated(), added(comment({ body }))])
    expect(state.recent[String(NEED)]![0]!.excerpt).toBe(excerpt)
  })

  it('leaves short bodies intact', () => {
    expect(pactFlowCommentExcerpt('short')).toBe('short')
  })

  it('folds the same event twice to the same state', () => {
    // Replay must be idempotent or cold recovery double-counts.
    const target = comment()
    const once = fold([needCreated(), added(target)])
    const twice = fold([needCreated(), added(target), added(target)])
    expect(twice).toEqual(once)
  })

  it('hides the Host-only ownership indexes from the client view', () => {
    const state = fold([needCreated(), added(comment())])
    const view = pactflowCollaborationProjection.wire!.view!(state as never) as Record<string, unknown>
    expect(Object.keys(view).sort()).toEqual(['counters', 'recent'])
  })
})

describe('PactFlow discussion view stays proportional to what it shows', () => {
  it('carries counters only for subjects whose comments are visible', () => {
    // Counters are keyed per subject and Runs are unbounded: a project that has
    // commented on hundreds of Runs would otherwise ship hundreds of counter keys
    // into every model snapshot forever, none ever reclaimed.
    const view = pactFlowDiscussionView({
      counters: {
        'need:need-1': { total: 1, agent: 0 },
        'run:run-old-1': { total: 1, agent: 1 },
        'run:run-old-2': { total: 1, agent: 1 },
      },
      recent: {
        'need-1': [{
          id: 'comment-1' as never, needId: 'need-1' as never, author: 'human',
          excerpt: 'visible', createdAt: 1, voided: false,
        }],
      },
    })
    expect(Object.keys(view.counters)).toEqual(['need:need-1'])
    expect(view.recent['need-1']).toHaveLength(1)
  })

  it('drops the counters of a Need whose every comment was voided', () => {
    const view = pactFlowDiscussionView({
      counters: { 'need:need-1': { total: 2, agent: 2 } },
      recent: {
        'need-1': [{
          id: 'comment-1' as never, needId: 'need-1' as never, author: 'agent',
          excerpt: 'retracted', createdAt: 1, voided: true,
        }],
      },
    })
    // Showing "2 comments" beside zero visible entries reads as a contradiction.
    expect(view.counters).toEqual({})
    expect(view.recent).toEqual({})
  })
})
