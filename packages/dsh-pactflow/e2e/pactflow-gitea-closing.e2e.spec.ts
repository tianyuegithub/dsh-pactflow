import { approveExecutionPlanFixture } from '../tests/execution-plan-fixture.ts'
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { recordAuthorizedReview } from '../tests/review-fixture.ts'

const realDescribe = process.env.DSH_GITEA_E2E === '1' ? describe : describe.skip
const apiBase = 'http://192.168.31.7:30000'
const owner = 'tianyue'
const repository = 'pactflow-acceptance'
const remoteUrl = 'ssh://git@192.168.31.7:30022/tianyue/pactflow-acceptance.git'

realDescribe('PactFlow real Gitea closing', () => {
  it('merges one verified task through a protected pull request and cleans transient refs', async () => {
    const token = process.env.PACTFLOW_GITEA_API_TOKEN
    if (token === undefined || token.length < 20) throw new Error('real Gitea E2E requires PACTFLOW_GITEA_API_TOKEN')
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-real-gitea-'))
    const workspace = join(root, 'workspace')
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    const suffix = randomUUID().slice(0, 8)
    const sessionId = SessionId(`gitea-closing-${suffix}`)
    const needId = `need-${suffix}`
    const nodeId = `node-${suffix}`
    const proofName = `pactflow-gitea-${suffix}.txt`
    let ctx: Context | undefined
    try {
      await requireMainProtection(token)
      git(['clone', remoteUrl, workspace])
      git(['-C', workspace, 'config', 'user.name', 'PactFlow Gitea E2E'])
      git(['-C', workspace, 'config', 'user.email', 'pactflow-gitea-e2e@example.invalid'])

      ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'e2e', writable: false }),
        resolve: () => Promise.resolve({ value: token, source: 'e2e' }),
      } as never)
      const session = ctx.sessions.create(sessionId, { meta: { agentPreset: 'pactflow', cwd: workspace } })
      const initialized = ctx.pactflow.initialize(session.id, { name: `Gitea closing ${suffix}` })
      const registeredWorkspace = { id: `gitea-workspace-${suffix}`, path: workspace, title: 'Gitea acceptance', sessionIds: [session.id] }
      ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
      await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 0,
        profiles: [{ id: 'git-diff-check', displayName: 'Git diff check', command: '/usr/bin/git',
          args: ['diff', '--check'], timeoutMs: 30_000 }] })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision,
        remote: 'origin',
        defaultBranch: 'main',
        giteaBaseUrl: apiBase,
        giteaOwner: owner,
        giteaRepo: repository,
        giteaTokenCredentialRef: 'PACTFLOW_GITEA_API_TOKEN',
        validationProfileIds: ['git-diff-check'],
      })
      await expect(ctx.pactflow.verifyGitea(session.id)).resolves.toMatchObject({
        fullName: `${owner}/${repository}`,
        defaultBranch: 'main',
        branchProtected: true,
        requiredApprovals: 0,
        statusChecks: [],
      })
      const need = ctx.pactflow.createNeed(session.id, {
        id: needId,
        title: `Real Gitea closing ${suffix}`,
        description: 'Real protected pull request acceptance',
      })
      const node = ctx.pactflow.createNode(session.id, {
        id: nodeId,
        needId: need.id,
        title: 'Create one proof commit',
        dependencies: [],
      })
      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: (_name: string, request: { cwd?: string }) => {
          const cwd = request.cwd
          if (cwd === undefined) throw new Error('real Gitea E2E expected a task worktree')
          git(['-C', cwd, 'config', 'user.name', 'PactFlow Gitea E2E Worker'])
          git(['-C', cwd, 'config', 'user.email', 'pactflow-gitea-e2e@example.invalid'])
          writeFileSync(join(cwd, proofName), `PactFlow real Gitea acceptance ${suffix}\n`)
          git(['-C', cwd, 'add', proofName])
          git(['-C', cwd, 'commit', '-m', `test: verify PactFlow Gitea closing ${suffix}`])
          return Promise.resolve({
            id: SessionId(`gitea-worker-${suffix}`),
            localAgent: undefined,
            result: Promise.resolve({
              output: [{ type: 'text', text: 'proof committed' }],
              stopReason: 'completed',
            }),
            dispose: () => Promise.resolve(),
          })
        },
      } as never)
      await approveExecutionPlanFixture(ctx, session.id, 'create the acceptance proof commit', { kind: 'git', provider: 'spawn' }, node.id)
      const task = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id,
        expectedRevision: node.revision,
        provider: 'spawn',
        leaseDurationMs: 60_000,
        prompt: 'create the acceptance proof commit',
      })
      expect(task.run.state).toBe('succeeded')

      let current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: need.revision, to: 'discussion',
      })
      // Approval and Worker are isolated fixtures; this suite proves real Git/Gitea, not human UI approval.
      recordAuthorizedReview(ctx.pactflow, session, current, {
        kind: 'requirement', decision: 'approved', note: 'Gitea 集成测试授权夹具',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'confirmed',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'design',
      })
      recordAuthorizedReview(ctx.pactflow, session, current, {
        kind: 'design', decision: 'approved', note: 'Gitea 集成测试授权夹具',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'planning',
      })
      recordAuthorizedReview(ctx.pactflow, session, current, {
        kind: 'plan', decision: 'approved', note: 'Gitea 集成测试授权夹具',
      })
      for (const phase of ['executing', 'code_review', 'verification'] as const) {
        current = ctx.pactflow.transitionNeed(session.id, {
          needId: need.id, expectedRevision: current.revision, to: phase,
        })
      }
      recordAuthorizedReview(ctx.pactflow, session, current, {
        kind: 'verification', decision: 'approved', note: 'Gitea 集成测试授权夹具',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'closing',
      })
      const closed = await ctx.pactflow.closeGitNeed(session.id, {
        needId: need.id,
        expectedRevision: current.revision,
      })
      expect(closed.need.phase).toBe('deployed')
      expect(closed.release.branch).toBe('main')
      expect(closed.cleanupFailures).toEqual([])
      const pull = await gitea<{
        merged: boolean
        merge_commit_sha: string
        html_url: string
        head: { ref: string }
      }>(
        token,
        `/repos/${owner}/${repository}/pulls/${String(closed.pullRequestNumber)}`,
      )
      expect(pull).toMatchObject({ merged: true, merge_commit_sha: closed.release.commit })
      expect(closed.release.serviceUrl).toBe(pull.html_url)
      expect(git(['-C', workspace, 'show', `${closed.release.commit}:${proofName}`])).toContain(suffix)
      expect(git(['ls-remote', '--heads', remoteUrl, task.run.git!.branch])).toBe('')
      expect(git(['ls-remote', '--heads', remoteUrl, pull.head.ref])).toBe('')
    } finally {
      if (ctx !== undefined) await ctx.fiber.dispose()
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  }, 120_000)
})

async function requireMainProtection(token: string): Promise<void> {
  const existing = await fetch(`${apiBase}/api/v1/repos/${owner}/${repository}/branch_protections/main`, {
    headers: { accept: 'application/json', authorization: `token ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  await existing.body?.cancel()
  if (existing.ok) return
  if (existing.status !== 404) throw new Error(`Gitea protection read failed with HTTP ${String(existing.status)}`)
  throw new Error('Gitea acceptance requires a preconfigured main protection rule; this test does not change repository permissions')
}

async function gitea<T>(token: string, suffix: string): Promise<T> {
  const response = await fetch(`${apiBase}/api/v1${suffix}`, {
    headers: { accept: 'application/json', authorization: `token ${token}` },
    signal: AbortSignal.timeout(10_000),
  })
  if (!response.ok) throw new Error(`Gitea readback failed with HTTP ${String(response.status)}`)
  return await response.json() as T
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}
