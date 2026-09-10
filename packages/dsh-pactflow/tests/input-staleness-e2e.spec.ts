import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

// F03 follow-up boundary: the detector is unit-tested; this records the *reachability*
// reality of the current node lifecycle, so the gap is explicit rather than assumed.
describe('PactFlow code-input staleness reachability', () => {
  it('reports no staleness for a dependent whose predecessor stays succeeded', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-stale-e2e-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('stale-e2e'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Stale' })
      await ctx.pactflow.bindGit(session.id, { expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main' })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const a = ctx.pactflow.createNode(session.id, { id: 'a', needId: need.id, title: 'A', dependencies: [] })
      ctx.pactflow.createNode(session.id, { id: 'b', needId: need.id, title: 'B', dependencies: ['a'], codeInputs: ['a'] })
      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      let sequence = 0
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: (_p: string, request: { cwd?: string }) => {
          sequence += 1
          git(['-C', request.cwd!, 'config', 'user.name', 'Worker'])
          git(['-C', request.cwd!, 'config', 'user.email', 'worker@example.invalid'])
          git(['-C', request.cwd!, 'commit', '--allow-empty', '-m', `task ${String(sequence)}`])
          return Promise.resolve({
            id: SessionId(`child-${String(sequence)}`), localAgent: undefined,
            result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
            dispose: () => Promise.resolve(),
          })
        },
      } as never)

      const runA = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: 'a', expectedRevision: a.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'A',
      })
      expect(runA.run.state).toBe('succeeded')
      const b = ctx.pactflow.dag(session.id).byId.b!
      const runB = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: 'b', expectedRevision: b.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'B',
      })
      expect(runB.run.state).toBe('succeeded')

      // The detector reports nothing while the predecessor's latest success is unchanged.
      expect(ctx.pactflow.staleCodeInputs(session.id, 'b')).toEqual([])

      // Reachability boundary: a succeeded node is intentionally NOT retryable, so the
      // "predecessor re-ran" trigger cannot occur through retry today. This is recorded
      // as an explicit gap (see the change's known-gaps), not silently assumed.
      const aNode = ctx.pactflow.dag(session.id).byId.a!
      expect(() => ctx.pactflow.retryNode(session.id, { nodeId: 'a', expectedRevision: aNode.revision }))
        .toThrow(/cannot retry from state succeeded/)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
