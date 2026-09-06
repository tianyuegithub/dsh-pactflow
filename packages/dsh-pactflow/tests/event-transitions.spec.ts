import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowNeedId } from '../src/types.ts'
import { PactFlowNodeId } from '../src/types.ts'
import { PactFlowRunId } from '../src/types.ts'

describe('PactFlow event transition validation', () => {
  it.each(['review', 'document', 'release', 'cleanup-need', 'cleanup-run', 'cleanup-foreign'] as const)('rejects missing or foreign delivery reference: %s', async variant => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('delivery-reference-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Delivery' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const other = ctx.pactflow.createNeed(session.id, { id: 'other', title: 'Other', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
      const claimed = ctx.pactflow.claimNode(session.id, { nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000 })
      const missing = PactFlowNeedId('missing')
      if (variant === 'review') session.append('pactflow/review-recorded', { v: 1, review: {
        id: 'review' as never, needId: missing, kind: 'requirement', decision: 'approved', note: 'Note', recordedAt: 1 } })
      else if (variant === 'document') session.append('pactflow/document-linked', { v: 1, document: {
        id: 'document' as never, needId: missing, kind: 'design', uri: '/document', title: 'Document', linkedAt: 1 } })
      else if (variant === 'release') session.append('pactflow/release-recorded', { v: 1, release: {
        needId: missing, commit: 'a'.repeat(40), branch: 'main', recordedAt: 1 } })
      else session.append('pactflow/cleanup-recorded', { v: 1, record: { id: 'cleanup', target: 'k3s:job', state: 'pending', attempt: 1,
        needId: variant === 'cleanup-need' ? missing : variant === 'cleanup-foreign' ? other.id : need.id,
        ...(variant === 'cleanup-need' ? {} : { runId: variant === 'cleanup-run'
          ? PactFlowRunId('run-00000000-0000-0000-0000-000000000000') : claimed.run.id }) } })
      expect(() => ctx.sessionProjections.stateOf(session, 'pactflowDelivery')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['target', 'needId', 'requiresRelease', 'closing'] as const)('rejects cleanup identity changes to %s', async field => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('cleanup-identity-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Cleanup' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      ctx.pactflow.createNeed(session.id, { id: 'other', title: 'Other', description: '' })
      const record = { id: 'cleanup', needId: need.id, target: 'closing:pactflow/closing/need/r1',
        requiresRelease: true, closing: { branch: 'pactflow/closing/need/r1', commit: 'a'.repeat(40), worktreePath: '/isolated/first' },
        state: 'failed' as const, attempt: 1 }
      session.append('pactflow/cleanup-recorded', { v: 1, record })
      const changed = { target: 'closing:other', needId: PactFlowNeedId('other'), requiresRelease: false,
        closing: { ...record.closing, worktreePath: '/isolated/other' } }[field]
      session.append('pactflow/cleanup-recorded', { v: 1, record: { ...record, attempt: 2, state: 'pending', [field]: changed } })
      expect(() => ctx.sessionProjections.stateOf(session, 'pactflowDelivery')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })

  it('rejects a node whose Need was never created', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('missing-need-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Nodes' })
      session.append('pactflow/node-created', { v: 1, node: { id: PactFlowNodeId('node'), needId: PactFlowNeedId('missing'),
        title: 'Node', revision: 1, state: 'ready', dependencies: [], updatedAt: Date.now() } })
      expect(() => ctx.sessionProjections.stateOf(session, 'pactflowDag')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['resurrect', 'node-revision', 'provider-changed', 'git-changed'] as const)('rejects run event %s', async variant => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('invalid-run-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Runs' })
      ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
      let claimed = ctx.pactflow.claimNode(session.id, { nodeId: node.id, expectedRevision: node.revision, provider: 'spawn', leaseDurationMs: 60_000 })
      if (variant === 'resurrect') claimed = ctx.pactflow.settleRun(session.id, { runId: claimed.run.id,
        claimId: claimed.run.claimId, expectedNodeRevision: claimed.node.revision, state: 'failed', outcome: 'failed' })
      const nextNode = { ...claimed.node, revision: claimed.node.revision + 1, state: 'running' as const }
      const nextRun = { ...claimed.run, nodeRevision: nextNode.revision + (variant === 'node-revision' ? 1 : 0),
        state: 'running' as const, leaseDeadline: claimed.run.leaseDeadline + 1,
        ...(variant === 'provider-changed' ? { provider: 'other-provider' } : {}),
        ...(variant === 'git-changed' ? { git: { remote: 'origin', remoteUrl: 'ssh://git@example.invalid/org/repo.git',
          defaultBranch: 'main', baseCommit: 'a'.repeat(40), branch: 'pactflow/need/node/changed',
          worktreePath: '/isolated/changed', validationCommands: [] } } : {}),
      }
      session.append('pactflow/run-renewed', { v: 1, run: nextRun, node: nextNode })
      expect(() => ctx.sessionProjections.stateOf(session, 'pactflowRuns')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['missing-dependency', 'foreign-dependency', 'self-dependency', 'cycle', 'changed-need'] as const)('rejects node event %s', async variant => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('invalid-node-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Nodes' })
      ctx.pactflow.createNeed(session.id, { id: 'need-a', title: 'A', description: '' })
      ctx.pactflow.createNeed(session.id, { id: 'need-b', title: 'B', description: '' })
      const first = ctx.pactflow.createNode(session.id, { id: 'first', needId: 'need-a', title: 'First', dependencies: [] })
      ctx.pactflow.createNode(session.id, { id: 'foreign', needId: 'need-b', title: 'Foreign', dependencies: [] })
      ctx.pactflow.createNode(session.id, { id: 'second', needId: 'need-a', title: 'Second', dependencies: ['first'] })
      const dependency = { 'missing-dependency': 'missing', 'foreign-dependency': 'foreign', 'self-dependency': 'first', cycle: 'second', 'changed-need': undefined }[variant]
      session.append('pactflow/node-updated', { v: 1, node: { ...first, revision: 2,
        needId: variant === 'changed-need' ? PactFlowNeedId('need-b') : first.needId,
        dependencies: dependency === undefined ? [] : [PactFlowNodeId(dependency)] } })
      expect(() => ctx.sessionProjections.stateOf(session, 'pactflowDag')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })

  it.each(['skipped-phase', 'phase-changes-content', 'update-changes-phase', 'created-at-changed', 'initial-phase', 'initial-revision', 'valid-update'] as const)('validates %s during replay', async variant => {
    const ctx = new Context()
    try {
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('invalid-event'), { meta: { agentPreset: 'pactflow' } })
      ctx.pactflow.initialize(session.id, { name: 'Event validation' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      if (variant === 'initial-phase' || variant === 'initial-revision') {
        session.append('pactflow/need-created', { v: 1, need: { ...need, id: PactFlowNeedId('another'),
          phase: variant === 'initial-phase' ? 'executing' : 'backlog', revision: variant === 'initial-revision' ? 2 : 1 } })
      } else if (variant === 'skipped-phase') {
        session.append('pactflow/phase-transitioned', { v: 1, from: need.phase, need: { ...need, revision: 2, phase: 'deployed' } })
      } else if (variant === 'phase-changes-content') {
        session.append('pactflow/phase-transitioned', { v: 1, from: need.phase,
          need: { ...need, revision: 2, phase: 'discussion', description: 'unreviewed replacement' } })
      } else {
        session.append('pactflow/need-updated', { v: 1, need: { ...need, revision: 2,
          ...(variant === 'update-changes-phase' ? { phase: 'executing' as const }
            : variant === 'created-at-changed' ? { createdAt: need.createdAt + 1 } : { title: 'Updated title' }) } })
      }
      if (variant === 'valid-update') {
        expect(ctx.sessionProjections.stateOf(session, 'pactflowNeeds')?.byId[need.id])
          .toMatchObject({ title: 'Updated title', phase: 'backlog', revision: 2 })
      } else expect(() => ctx.sessionProjections.stateOf(session, 'pactflowNeeds')).toThrow()
    } finally { await ctx.fiber.dispose() }
  })
})
