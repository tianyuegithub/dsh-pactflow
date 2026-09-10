import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

// Real-Git fixtures are slow under load; relax the per-test timeout without touching assertions.
vi.setConfig({ testTimeout: 20_000 })

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

describe('PactFlow dependency code inputs', () => {
  it('starts a code-input dependent node from its predecessor successful commit', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-dep-input-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { workspace } = createGitFixture(root)
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const session = ctx.sessions.create(SessionId('dep-input'), { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Dependency input' })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
      })
      const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
      const a = ctx.pactflow.createNode(session.id, { id: 'a', needId: need.id, title: 'A', dependencies: [] })
      const b = ctx.pactflow.createNode(session.id, {
        id: 'b', needId: need.id, title: 'B', dependencies: ['a'], codeInputs: ['a'],
      })

      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: async (_provider: string, request: { cwd?: string; label?: string }) => {
          const cwd = request.cwd!
          // The Host passes the node title as the subagent label.
          if (request.label === 'B') {
            // B must see A's file because B declares a code-input dependency on A.
            const exists = await readFile(join(cwd, 'api.txt'), 'utf8').then(() => true, () => false)
            if (!exists) throw new Error('B baseline is missing the predecessor file api.txt')
            await writeFile(join(cwd, 'consumer.txt'), 'uses api v1\n')
          } else {
            await writeFile(join(cwd, 'api.txt'), 'api v1\n')
          }
          git(['-C', cwd, 'config', 'user.name', 'Worker'])
          git(['-C', cwd, 'config', 'user.email', 'worker@example.invalid'])
          git(['-C', cwd, 'add', '-A'])
          git(['-C', cwd, 'commit', '--allow-empty', '-m', 'task commit'])
          return {
            id: SessionId(`child-${String(Math.random())}`), localAgent: undefined,
            result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
            dispose: () => Promise.resolve(),
          }
        },
      } as never)

      const runA = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: a.id, expectedRevision: a.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'write api',
      })
      expect(runA.run.state).toBe('succeeded')

      const runB = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: b.id, expectedRevision: ctx.pactflow.dag(session.id).byId[b.id]!.revision,
        provider: 'spawn', leaseDurationMs: 60_000, prompt: 'use api',
      })
      expect(runB.run.state, runB.run.outcome).toBe('succeeded')
      expect(runB.run.gitResult?.commit).not.toBe(runA.run.gitResult?.commit)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
