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

// A03-d: validation-sensitive changes must survive the event fold (they were
// previously stripped by the payload schema — "written but never readable") and
// must reach the human reviewer inside the native approval request.
async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  await ctx.plugin(ApprovalService)
  const session = ctx.sessions.create(SessionId('review-surface'), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Review surface' })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
  const agent = { id: session.id, session } as Agent
  const scope = createScope(ctx, agent)
  await scope.ctx.plugin(PactFlowAgentTools)
  session.append('turn/start', { turn: 1 })
  return { ctx, session, need, node, agent }
}

/** Settle one successful Git run for the need, optionally touching validation-sensitive files. */
function settleGitRun(harness: Awaited<ReturnType<typeof setup>>, sensitive: readonly string[], scanFailed = false) {
  const { session, node } = harness
  const now = Date.now()
  const commit = 'a'.repeat(40)
  const git = {
    remote: 'origin', remoteUrl: 'https://git.example/owner/repo.git', defaultBranch: 'main',
    baseCommit: commit, branch: 'pactflow/need/node/x', worktreePath: '/tmp/wt', validationCommands: [],
  }
  const claimedRevision = node.revision + 1
  session.append('pactflow/run-claimed', {
    v: 1,
    run: { id: 'run-1', nodeId: node.id, nodeRevision: claimedRevision, attempt: 1, provider: 'git',
      claimId: 'c1', state: 'claimed', leaseDeadline: now + 60_000, leaseDurationMs: 60_000, updatedAt: now, git },
    node: { id: node.id, needId: node.needId, title: node.title, state: 'claimed', revision: claimedRevision, dependencies: node.dependencies, updatedAt: now },
  })
  session.append('pactflow/run-settled', {
    v: 1,
    run: { id: 'run-1', nodeId: node.id, nodeRevision: claimedRevision, attempt: 1, provider: 'git',
      claimId: 'c1', state: 'succeeded', leaseDeadline: now + 60_000, leaseDurationMs: 60_000, updatedAt: now, git,
      gitResult: { branch: git.branch, commit, remoteRef: `refs/remotes/origin/${git.branch}`, syncedAt: now,
        validations: [], ...(sensitive.length === 0 ? {} : { validationSensitiveChanges: sensitive }),
        ...(scanFailed ? { validationSensitiveScanFailed: true } : {}) } },
    node: { id: node.id, needId: node.needId, title: node.title, state: 'succeeded', revision: claimedRevision + 1, dependencies: node.dependencies, updatedAt: now },
  })
}

describe('PactFlow review-visible validation integrity', () => {
  it('keeps validation-sensitive changes readable after the event fold', async () => {
    const harness = await setup()
    try {
      settleGitRun(harness, ['package.json', '.github/workflows/ci.yml'])
      const snapshot = await harness.ctx.pactflow.snapshot(harness.session.id)
      // Before the schema fix this read back as undefined (stripped on parse).
      expect(snapshot.runs.byId['run-1']?.gitResult?.validationSensitiveChanges)
        .toEqual(['package.json', '.github/workflows/ci.yml'])
    } finally { await harness.ctx.fiber.dispose() }
  })

  it('surfaces the delivery validation-sensitive file list in the approval request', async () => {
    const harness = await setup()
    try {
      settleGitRun(harness, ['package.json', 'vitest.config.ts'])
      let reason = ''
      harness.ctx.on('approval/request', request => {
        reason = request.reason ?? ''
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      const executed = await harness.ctx.tools.execute({
        callId: ToolCallId('review-call'), name: 'pactflow_record_review',
        arguments: { need_id: 'need', expected_revision: 1, kind: 'requirement', decision: 'approved', note: 'reviewed the delivered change' },
        agent: harness.agent, signal: new AbortController().signal,
      })
      expect(executed.isError).toBe(false)
      expect(reason).toContain('package.json')
      expect(reason).toContain('vitest.config.ts')
    } finally { await harness.ctx.fiber.dispose() }
  })

  it('states explicitly when no validation-sensitive file changed', async () => {
    const harness = await setup()
    try {
      settleGitRun(harness, [])
      let reason = ''
      harness.ctx.on('approval/request', request => {
        reason = request.reason ?? ''
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      const executed = await harness.ctx.tools.execute({
        callId: ToolCallId('review-call'), name: 'pactflow_record_review',
        arguments: { need_id: 'need', expected_revision: 1, kind: 'requirement', decision: 'approved', note: 'reviewed the delivered change' },
        agent: harness.agent, signal: new AbortController().signal,
      })
      expect(executed.isError).toBe(false)
      // Absence must be stated, not omitted — "not shown" and "none" must not blur.
      expect(reason).toMatch(/验证敏感文件改动：无/)
    } finally { await harness.ctx.fiber.dispose() }
  })

  it('never reports a failed scan as "none"', async () => {
    // The scan failing and the wiring being untouched are different facts. Folding
    // the first into the second hands the reviewer our failure as their assurance.
    const harness = await setup()
    try {
      settleGitRun(harness, [], true)
      let reason = ''
      harness.ctx.on('approval/request', request => {
        reason = request.reason ?? ''
        return Promise.resolve<ApprovalOutcome>('allowed-once')
      })
      const executed = await harness.ctx.tools.execute({
        callId: ToolCallId('review-call'), name: 'pactflow_record_review',
        arguments: { need_id: 'need', expected_revision: 1, kind: 'requirement', decision: 'approved', note: 'reviewed the delivered change' },
        agent: harness.agent, signal: new AbortController().signal,
      })
      expect(executed.isError).toBe(false)
      expect(reason).toContain('核查失败')
      expect(reason).not.toMatch(/验证敏感文件改动：无/)
    } finally { await harness.ctx.fiber.dispose() }
  })
})
