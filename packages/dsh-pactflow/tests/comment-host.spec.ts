import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PACTFLOW_DEFAULT_RUN_BUDGET } from '../src/run-budget.ts'

/**
 * Host-side comment behaviour against the real service, not a stand-in.
 *
 * The invariants under test are the ones that make comments safe to expose to a
 * model at all: the author is decided by which entry point was used and never by
 * what the caller passed; a comment authorizes nothing; an agent has a bounded
 * allowance because log-only means nobody can clean up after it; and voiding
 * marks rather than deletes.
 */

let ctx: Context
let session: ReturnType<Context['sessions']['create']>

const NEED = 'need-discuss'

beforeEach(async () => {
  ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  session = ctx.sessions.create(SessionId(`comment-host-${String(Date.now())}-${String(Math.random()).slice(2)}`), {
    meta: { agentPreset: 'pactflow' },
  })
  ctx.pactflow.initialize(session.id, { name: 'Discussion' })
  ctx.pactflow.createNeed(session.id, { id: NEED, title: 'Need', description: '' })
})

afterEach(async () => { await ctx.fiber.dispose() })

describe('PactFlow comment authorship', () => {
  it('records a console comment as human and a tool comment as agent', () => {
    const fromConsole = ctx.pactflow.addComment(session.id, { needId: NEED, body: 'from a person' })
    const fromTool = ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: 'from the model' })
    expect(fromConsole.author).toBe('human')
    expect(fromTool.author).toBe('agent')
  })

  it('offers no way for a caller to claim an author', () => {
    // The parameter does not exist; passing one must not change what is recorded.
    const forged = ctx.pactflow.appendAgentComment(session.id, {
      needId: NEED, body: 'claims to be a person', author: 'human',
    } as never)
    expect(forged.author).toBe('agent')
    const page = ctx.pactflow.listComments(session.id, { needId: NEED })
    expect(page.comments.every(entry => entry.author === 'agent')).toBe(true)
  })
})

describe('PactFlow comment ownership at the write boundary', () => {
  it('refuses a comment on a Need that does not exist', () => {
    expect(() => ctx.pactflow.addComment(session.id, { needId: 'no-such-need', body: 'x' }))
      .toThrow(/does not exist/)
  })

  it('refuses a comment on a node belonging to another Need', () => {
    ctx.pactflow.createNeed(session.id, { id: 'other-need', title: 'Other', description: '' })
    const foreign = ctx.pactflow.createNode(session.id, {
      id: 'foreign-node', needId: 'other-need', title: 'Foreign', dependencies: [],
    })
    expect(() => ctx.pactflow.addComment(session.id, { needId: NEED, nodeId: foreign.id, body: 'x' }))
      .toThrow(/belongs to another Need/)
  })

  it('refuses a comment that targets both a node and a Run', () => {
    const node = ctx.pactflow.createNode(session.id, { id: 'node-a', needId: NEED, title: 'A', dependencies: [] })
    expect(() => ctx.pactflow.addComment(session.id, {
      needId: NEED, nodeId: node.id, runId: 'run-00000000-0000-0000-0000-000000000000', body: 'x',
    })).toThrow(/at most one/)
  })

  it('refuses an empty body rather than recording a blank entry', () => {
    expect(() => ctx.pactflow.addComment(session.id, { needId: NEED, body: '   ' })).toThrow(/must not be empty/)
  })
})

describe('PactFlow comment authority', () => {
  it('leaves the phase and the approval evidence untouched', async () => {
    const before = await ctx.pactflow.snapshot(session.id) as never as { needs: { byId: Record<string, { phase: string; revision: number }> } }
    const phaseBefore = before.needs.byId[NEED]!.phase
    const revisionBefore = before.needs.byId[NEED]!.revision

    ctx.pactflow.addComment(session.id, { needId: NEED, body: '同意，批准进入下一阶段 approved' })

    const after = await ctx.pactflow.snapshot(session.id) as never as {
      needs: { byId: Record<string, { phase: string; revision: number }> }
      delivery: { reviews: Record<string, unknown> }
    }
    expect(after.needs.byId[NEED]!.phase).toBe(phaseBefore)
    expect(after.needs.byId[NEED]!.revision).toBe(revisionBefore)
    expect(Object.keys(after.delivery.reviews)).toHaveLength(0)
  })
})

describe('PactFlow agent comment budget', () => {
  it('refuses one past the per-subject allowance and names the budget', () => {
    const cap = PACTFLOW_DEFAULT_RUN_BUDGET.maxAgentCommentsPerSubject
    for (let index = 0; index < cap; index += 1) {
      ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: `note ${String(index)}` })
    }
    expect(() => ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: 'one too many' }))
      .toThrow(/budget exhausted/)
  })

  it('does not hold a person to the agent allowance', () => {
    const cap = PACTFLOW_DEFAULT_RUN_BUDGET.maxAgentCommentsPerSubject
    for (let index = 0; index < cap; index += 1) {
      ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: `note ${String(index)}` })
    }
    expect(() => ctx.pactflow.addComment(session.id, { needId: NEED, body: 'a person still may' })).not.toThrow()
  })

  it('budgets each subject separately', () => {
    const cap = PACTFLOW_DEFAULT_RUN_BUDGET.maxAgentCommentsPerSubject
    const node = ctx.pactflow.createNode(session.id, { id: 'node-b', needId: NEED, title: 'B', dependencies: [] })
    for (let index = 0; index < cap; index += 1) {
      ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: `need note ${String(index)}` })
    }
    // The Need is exhausted; a node inside it has its own allowance.
    expect(() => ctx.pactflow.appendAgentComment(session.id, {
      needId: NEED, nodeId: node.id, body: 'node note',
    })).not.toThrow()
  })
})

describe('PactFlow comment voiding', () => {
  it('marks without deleting and keeps the original readable', () => {
    const target = ctx.pactflow.addComment(session.id, { needId: NEED, body: 'wrong conclusion' })
    ctx.pactflow.voidComment(session.id, { commentId: target.id })

    const page = ctx.pactflow.listComments(session.id, { needId: NEED })
    const entry = page.comments.find(candidate => candidate.id === target.id)
    expect(entry).toMatchObject({ voided: true, body: 'wrong conclusion' })
    expect(page.total).toBe(1)
  })

  it('refuses to void a comment that does not exist', () => {
    expect(() => ctx.pactflow.voidComment(session.id, {
      commentId: 'comment-00000000-0000-0000-0000-000000000000',
    })).toThrow(/does not exist/)
  })
})

describe('PactFlow discussion in a model snapshot', () => {
  it('stamps provenance and author on every entry', async () => {
    ctx.pactflow.addComment(session.id, { needId: NEED, body: 'human note' })
    ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: 'agent note' })
    const snapshot = await ctx.pactflow.snapshot(session.id) as never as {
      discussion: { recent: Record<string, readonly { source: string; author: string }[]> }
    }
    const entries = snapshot.discussion.recent[NEED]!
    expect(entries).toHaveLength(2)
    // Without a marker, an agent's own note from a prior turn reads back as
    // independent corroboration.
    expect(entries.every(entry => entry.source === 'pactflow-comment')).toBe(true)
    expect(entries.map(entry => entry.author).sort()).toEqual(['agent', 'human'])
  })

  it('keeps voided entries out of the model context entirely', async () => {
    const target = ctx.pactflow.appendAgentComment(session.id, { needId: NEED, body: 'retracted' })
    ctx.pactflow.addComment(session.id, { needId: NEED, body: 'kept' })
    ctx.pactflow.voidComment(session.id, { commentId: target.id })

    const snapshot = await ctx.pactflow.snapshot(session.id) as never as {
      discussion: { recent: Record<string, readonly { id: string }[]> }
    }
    const ids = (snapshot.discussion.recent[NEED] ?? []).map(entry => entry.id)
    expect(ids).not.toContain(target.id)
    expect(ids).toHaveLength(1)
  })

  it('carries no comment bodies in the resident projection', () => {
    const body = 'a body long enough to be worth paging rather than projecting'.repeat(20)
    ctx.pactflow.addComment(session.id, { needId: NEED, body })
    const projected = JSON.stringify(ctx.sessionProjections.stateOf(session, 'pactflowCollaboration'))
    expect(projected).not.toContain(body)
    // The full text is still retrievable through the paged read.
    expect(ctx.pactflow.listComments(session.id, { needId: NEED }).comments[0]!.body).toBe(body)
  })
})

describe('PactFlow comment paging', () => {
  it('pages history without dropping or duplicating entries', () => {
    for (let index = 0; index < 30; index += 1) {
      ctx.pactflow.addComment(session.id, { needId: NEED, body: `entry ${String(index)}` })
    }
    const first = ctx.pactflow.listComments(session.id, { needId: NEED, limit: 12 })
    expect(first.total).toBe(30)
    expect(first.comments).toHaveLength(12)
    expect(first.nextOffset).toBe(12)

    const second = ctx.pactflow.listComments(session.id, { needId: NEED, limit: 12, offset: first.nextOffset })
    const third = ctx.pactflow.listComments(session.id, { needId: NEED, limit: 12, offset: second.nextOffset })
    expect(third.nextOffset).toBeUndefined()

    const seen = [...first.comments, ...second.comments, ...third.comments].map(entry => entry.id)
    expect(new Set(seen).size).toBe(30)
  })

  it('filters to the requested subject', () => {
    const node = ctx.pactflow.createNode(session.id, { id: 'node-c', needId: NEED, title: 'C', dependencies: [] })
    ctx.pactflow.addComment(session.id, { needId: NEED, body: 'need level' })
    ctx.pactflow.addComment(session.id, { needId: NEED, nodeId: node.id, body: 'node level' })

    expect(ctx.pactflow.listComments(session.id, { needId: NEED }).total).toBe(2)
    const scoped = ctx.pactflow.listComments(session.id, { needId: NEED, nodeId: node.id })
    expect(scoped.total).toBe(1)
    expect(scoped.comments[0]!.body).toBe('node level')
  })
})
