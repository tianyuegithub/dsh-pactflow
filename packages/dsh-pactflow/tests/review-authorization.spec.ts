import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import ApprovalService, { type ApprovalOutcome } from '@deepseek-ai/dsh-user-approval'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import * as PactFlowAgentTools from '../presets/pactflow/plugin/index.js'
import { recordAuthorizedReview } from './review-fixture.ts'

async function setup(withApproval = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  if (withApproval) await ctx.plugin(ApprovalService)
  const session = ctx.sessions.create(SessionId('authorization-test'), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Authorization' })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const agent = { id: session.id, session } as Agent
  const scope = createScope(ctx, agent)
  await scope.ctx.plugin(PactFlowAgentTools)
  session.append('turn/start', { turn: 1 })
  const execute = (note = 'Evidence checked', revision = need.revision) => ctx.tools.execute({
    callId: ToolCallId('review-call'), name: 'pactflow_record_review',
    arguments: { need_id: need.id, expected_revision: revision, kind: 'requirement', decision: 'changes-requested', note },
    agent, signal: new AbortController().signal,
  })
  return { ctx, session, need, execute }
}

describe('PactFlow human authorization boundaries', () => {
  it('shows the exact decision and evidence in the official approval request', async () => {
    const { ctx, session, execute } = await setup()
    try {
      let reason = ''
      ctx.on('approval/request', request => {
        reason = request.reason ?? ''
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      expect((await execute()).isError).toBe(false)
      expect(reason).toContain('changes-requested')
      expect(reason).toContain('Evidence checked')
      expect(reason).toContain('need')
      const review = Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.reviews)[0]!
      expect(review).toMatchObject({ decision: 'changes-requested', needRevision: 1, source: 'dsh-approval' })
      expect(session.events).toContainEqual(expect.objectContaining({ type: 'approval/decided', data: expect.objectContaining({ id: review.approvalRequestId, outcome: 'allowed-once' }) }))
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['rejected', 'cancelled', 'unavailable'] as const)('does not record a review when official approval returns %s', async outcome => {
    const { ctx, session, execute } = await setup()
    try {
      ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>(outcome))
      expect((await execute()).isError).toBe(true)
      expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.reviews)).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('fails without an Approval service', async () => {
    const { ctx, session, execute } = await setup(false)
    try {
      expect((await execute()).isError).toBe(true)
      expect(session.events.some(event => event.type === 'pactflow/review-recorded')).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['token=isolated-test-value', 'API_KEY: isolated-test-value', '密'.repeat(2731), '   '])('refuses unsafe or invalid evidence before requesting or recording approval (%#)', async note => {
    const { ctx, session, execute } = await setup()
    try {
      ctx.on('approval/request', () => Promise.resolve<ApprovalOutcome>('allowed-once'))
      expect((await execute(note)).isError).toBe(true)
      expect(session.events.some(event => event.type === 'approval/asked')).toBe(false)
      expect(session.events.some(event => event.type === 'pactflow/review-recorded')).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects a review if the Need changes while approval is pending', async () => {
    const { ctx, session, need, execute } = await setup()
    try {
      ctx.on('approval/request', () => {
        ctx.pactflow.transitionNeed(session.id, { needId: need.id, expectedRevision: 1, to: 'discussion' })
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      expect((await execute()).isError).toBe(true)
      expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.reviews)).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })

  it('cannot declare deployment through the public transition tool without Git closing', async () => {
    const { ctx, session, need: initial } = await setup()
    try {
      let need = initial
      for (const to of ['discussion', 'confirmed', 'design', 'planning', 'executing', 'code_review', 'verification', 'closing'] as const) {
        const kind = { confirmed: 'requirement', planning: 'design', executing: 'plan', closing: 'verification' }[to] as 'requirement' | 'design' | 'plan' | 'verification' | undefined
        if (kind !== undefined) recordAuthorizedReview(ctx.pactflow, session, need, { kind, decision: 'approved', note: 'isolated boundary evidence' })
        need = ctx.pactflow.transitionNeed(session.id, { needId: need.id, expectedRevision: need.revision, to })
      }
      expect(() => ctx.pactflow.transitionNeed(session.id, { needId: need.id, expectedRevision: need.revision, to: 'deployed' }))
        .toThrow(/closing/i)
      expect((await ctx.pactflow.snapshot(session.id)).needs.byId[need.id]?.phase).toBe('closing')
      expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.releases)).toEqual([])
    } finally { await ctx.fiber.dispose() }
  })
})
