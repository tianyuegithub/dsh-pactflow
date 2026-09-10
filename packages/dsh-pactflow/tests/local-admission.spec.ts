import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

interface Harness {
  readonly ctx: Context
  readonly sessionId: SessionId
  readonly nodeRevision: number
  readonly started: ReturnType<typeof vi.fn>
}

async function harness(root: string, name: string): Promise<Harness> {
  const { workspace } = createGitFixture(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  const session = ctx.sessions.create(SessionId(name), { meta: { agentPreset: 'pactflow', cwd: workspace } })
  const initialized = ctx.pactflow.initialize(session.id, { name: 'Local admission' })
  await ctx.pactflow.bindGit(session.id, {
    expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
  })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
  const started = vi.fn()
  const parent = { id: session.id, session }
  ctx.provide('agents', { get: () => parent } as never)
  ctx.provide('subagents', {
    getProvider: () => ({ capabilities: { cwd: true } }),
    start: (_name: string, request: { cwd?: string }) => {
      started()
      git(['-C', request.cwd!, 'config', 'user.name', 'Worker'])
      git(['-C', request.cwd!, 'config', 'user.email', 'worker@example.invalid'])
      git(['-C', request.cwd!, 'commit', '--allow-empty', '-m', 'local task commit'])
      return Promise.resolve({
        id: SessionId('local-child'), localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
        dispose: () => Promise.resolve(),
      })
    },
  } as never)
  return { ctx, sessionId: session.id, nodeRevision: node.revision, started }
}

describe('PactFlow local dispatch admission', () => {
  it('passes the local Git dispatch through the shared admission scheduler', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-local-admission-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { ctx, sessionId, nodeRevision } = await harness(root, 'admits-local')
      const capacity = Reflect.get(ctx.pactflow, 'executionCapacity') as { acquire: (...args: unknown[]) => unknown }
      const originalAcquire = capacity.acquire.bind(capacity)
      const acquire = vi.fn((...args: unknown[]) => originalAcquire(...args))
      capacity.acquire = acquire
      const settled = await ctx.pactflow.dispatchGitNode(sessionId, {
        nodeId: 'node', expectedRevision: nodeRevision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'commit',
      })
      expect(settled.run.state).toBe('succeeded')
      // The local path must pass through the same admission scheduler as K3s.
      expect(acquire).toHaveBeenCalledTimes(1)
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })

  it('does not claim or execute a local Git node while admission is paused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-local-paused-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    try {
      const { ctx, sessionId, nodeRevision, started } = await harness(root, 'paused-local')
      const session = ctx.sessions.create(SessionId('placeholder'), { meta: { agentPreset: 'pactflow' } })
      void session
      const capacity = Reflect.get(ctx.pactflow, 'executionCapacity') as { pauseAdmission(): () => void }
      const resume = capacity.pauseAdmission()
      const live = ctx.sessions.get(sessionId)!
      let settledState: string | undefined
      const pending = ctx.pactflow.dispatchGitNode(sessionId, {
        nodeId: 'node', expectedRevision: nodeRevision, provider: 'spawn', leaseDurationMs: 60_000, prompt: 'commit',
      }).then(result => { settledState = result.run.state; return result }, () => undefined)
      // While paused, neither a claim nor execution may happen. Wait long enough that a
      // bypassing path would have completed its real Git plan and claimed.
      await new Promise(resolveWait => setTimeout(resolveWait, 300))
      expect(live.events.some(event => event.type === 'pactflow/run-claimed')).toBe(false)
      expect(started).not.toHaveBeenCalled()
      expect(settledState).toBeUndefined()
      resume()
      await pending
      expect(settledState).toBe('succeeded')
    } finally {
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  })
})
