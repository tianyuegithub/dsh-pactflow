import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowGitWorkspace } from '../src/git-workspace.ts'
import { createGitFixture } from './git-fixture.ts'
import { projectHandoverSummary } from '../src/project-handover.ts'

// A03-c: the host-owned closing baseline runs on the candidate commit BEFORE
// task validations, is marked with its own evidence source, and a failure
// blocks closing. Its authority is the owner's workspace config, not the task
// binding — so it cannot be skipped or weakened from the task side.
vi.setConfig({ testTimeout: 20_000 })

function git(workspace: string, args: readonly string[]): string {
  return execFileSync('git', ['-C', workspace, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}

async function closingScene() {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-host-baseline-'))
  const priorHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, '.dsh')
  const { workspace, remote } = createGitFixture(root)
  const branch = 'pactflow/need/node/task-a'
  git(workspace, ['switch', '-c', branch, 'main'])
  git(workspace, ['commit', '--allow-empty', '-m', 'task a'])
  const commit = git(workspace, ['rev-parse', 'HEAD'])
  git(workspace, ['push', 'origin', branch])
  git(workspace, ['switch', 'main'])
  const refs = [{ remoteRef: `refs/remotes/origin/${branch}`, expectedCommit: commit }]
  const gitWorkspace = new PactFlowGitWorkspace()
  const binding = { remote: 'origin', remoteUrl: remote, defaultBranch: 'main', revision: 1, boundAt: 1, validationCommands: [] }
  return { root, priorHome, gitWorkspace, workspace, binding, refs }
}

describe('PactFlow host-owned closing baseline', () => {
  it('executes the baseline on the candidate commit and marks the evidence source', async () => {
    const scene = await closingScene()
    try {
      const integration = await scene.gitWorkspace.prepareClosing(
        scene.workspace, 'session-a', 'need-a', 1, scene.binding, scene.refs, undefined, [],
        undefined,
        [{ command: 'git', args: ['status', '--porcelain=v1'], timeoutMs: 10_000 }],
      )
      expect(integration.baselineValidations).toEqual([
        { command: 'git', args: ['status', '--porcelain=v1'], timeoutMs: 10_000, exitCode: 0, source: 'host-baseline', durationMs: expect.any(Number) },
      ])
    } finally {
      process.env.DSH_HOME = scene.priorHome
      await rm(scene.root, { recursive: true, force: true })
    }
  })

  it('blocks closing and names the command when the baseline fails', async () => {
    const scene = await closingScene()
    try {
      await expect(scene.gitWorkspace.prepareClosing(
        scene.workspace, 'session-a', 'need-a', 1, scene.binding, scene.refs, undefined, [],
        undefined,
        [{ command: 'git', args: ['totally-unknown-subcommand'], timeoutMs: 10_000 }],
      )).rejects.toThrow(/host baseline validation failed and blocks closing.*totally-unknown-subcommand/)
    } finally {
      process.env.DSH_HOME = scene.priorHome
      await rm(scene.root, { recursive: true, force: true })
    }
  })

  it('leaves the closing result unchanged when no baseline is registered', async () => {
    const scene = await closingScene()
    try {
      const integration = await scene.gitWorkspace.prepareClosing(
        scene.workspace, 'session-a', 'need-a', 1, scene.binding, scene.refs,
      )
      expect(integration.baselineValidations).toBeUndefined()
    } finally {
      process.env.DSH_HOME = scene.priorHome
      await rm(scene.root, { recursive: true, force: true })
    }
  })

  it('surfaces the baseline execution count on the pending closing handover entry', () => {
    const summary = projectHandoverSummary({
      project: { project: null }, needs: { byId: {} }, dag: { byId: {} }, runs: { byId: {} },
      delivery: { reviews: {}, documents: {}, releases: {}, cleanups: {
        'cleanup-need-closing': { id: 'cleanup-need-closing', needId: 'need', target: 'closing:pactflow/closing/x',
          state: 'pending', attempt: 1,
          closing: { branch: 'pactflow/closing/x', commit: 'b'.repeat(40), worktreePath: '/tmp/wt',
            baselineValidations: [{ command: 'git', args: ['status'], timeoutMs: 5_000, exitCode: 0, durationMs: 3, source: 'host-baseline' }] } },
      } },
    } as never, { packageVersion: '0.2.1', eventProducerVersion: '0.3.0' })
    expect(summary.pendingCleanups[0]).toMatchObject({ id: 'cleanup-need-closing', baselineValidationsExecuted: 1 })
  })

  it('saves the baseline through the owner path with command bounds and clears on empty', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-host-baseline-store-'))
    const priorHome = process.env.DSH_HOME
    process.env.DSH_HOME = root
    const ctx = new Context()
    try {
      const workspacePath = join(root, 'repo')
      const { mkdir } = await import('node:fs/promises')
      await mkdir(workspacePath, { recursive: true })
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      const registeredWorkspace = { id: 'baseline-workspace', path: workspacePath, title: 'Baseline', sessionIds: [] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
      // Bounds: timeout outside 1s-1h is refused at save time.
      await expect(ctx.pactflow.saveHostBaseline({ workspaceId: 'baseline-workspace', expectedRevision: 0,
        commands: [{ command: 'git', args: ['status'], timeoutMs: 100 }] })).rejects.toThrow(/timeout must be/)
      // A valid save round-trips through the durable workspace config.
      const saved = await ctx.pactflow.saveHostBaseline({ workspaceId: 'baseline-workspace', expectedRevision: 0,
        commands: [{ command: 'git', args: ['status', '--porcelain=v1'], timeoutMs: 10_000 }] })
      expect(saved.hostBaselineCommands).toEqual([{ command: 'git', args: ['status', '--porcelain=v1'], timeoutMs: 10_000 }])
      // An empty submission clears the baseline.
      const cleared = await ctx.pactflow.saveHostBaseline({ workspaceId: 'baseline-workspace',
        expectedRevision: saved.revision, commands: [] })
      expect(cleared.hostBaselineCommands).toBeUndefined()
    } finally {
      process.env.DSH_HOME = priorHome
      await ctx.fiber.dispose()
    }
  })
})
