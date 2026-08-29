import { execFileSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow Gitea closing', () => {
  it('merges verified task refs through a protected PR and records deployment', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-closing-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    const { remote, workspace } = createGitFixture(root)
    const merger = join(root, 'merger')
    git(['clone', remote, merger])
    git(['-C', merger, 'config', 'user.name', 'Gitea Merge'])
    git(['-C', merger, 'config', 'user.email', 'gitea@example.invalid'])
    let pullHead = ''
    let mergeCommit = ''
    const server = createServer((request, response) => {
      void handleGitea(request, response).catch(() => {
        response.statusCode = 500
        response.end('{}')
      })
    })
    async function handleGitea(request: IncomingMessage, response: ServerResponse): Promise<void> {
      expect(request.headers.authorization).toBe('token gitea-test-token')
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && request.url?.endsWith('/branch_protections/main') === true) {
        response.end(JSON.stringify({ required_approvals: 0, status_check_contexts: [] }))
        return
      }
      if (request.method === 'GET' && request.url?.endsWith('/pulls/1') === true) {
        response.end(JSON.stringify({
          number: 1, html_url: `${baseUrl}/owner/repo/pulls/1`, merged: true,
          merge_commit_sha: mergeCommit,
        }))
        return
      }
      if (request.method === 'GET' && request.url?.includes('/pulls?') === true) {
        response.end('[]')
        return
      }
      if (request.method === 'POST' && request.url?.endsWith('/pulls/1/merge') === true) {
        await readBody(request)
        git(['-C', merger, 'fetch', 'origin'])
        git(['-C', merger, 'merge', '--no-ff', '--no-edit', `origin/${pullHead}`])
        mergeCommit = git(['-C', merger, 'rev-parse', 'HEAD^{commit}'])
        git(['-C', merger, 'push', 'origin', 'main'])
        git(['-C', merger, 'push', 'origin', '--delete', pullHead])
        response.end('{}')
        return
      }
      if (request.method === 'POST' && request.url?.endsWith('/pulls') === true) {
        const body = JSON.parse(await readBody(request)) as { head: string }
        pullHead = body.head
        response.statusCode = 201
        response.end(JSON.stringify({
          number: 1, html_url: `${baseUrl}/owner/repo/pulls/1`, merged: false,
        }))
        return
      }
      response.end(JSON.stringify({
        full_name: 'owner/repo', default_branch: 'main', private: true, archived: false,
        default_merge_style: 'merge',
      }))
    }
    await new Promise<void>((resolveListen, reject) => {
      server.once('error', reject)
      server.listen(0, '127.0.0.1', resolveListen)
    })
    const address = server.address() as AddressInfo
    const baseUrl = `http://127.0.0.1:${String(address.port)}`
    try {
      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService)
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: () => Promise.resolve({ value: 'gitea-test-token', source: 'memory' }),
      } as never)
      const session = ctx.sessions.create(SessionId('closing-session'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Closing' })
      await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
        giteaBaseUrl: baseUrl, giteaOwner: 'owner', giteaRepo: 'repo',
        giteaTokenCredentialRef: 'GITEA_TEST_TOKEN', validationCommands: [],
      })
      const need = ctx.pactflow.createNeed(session.id, {
        id: 'need', title: 'Close this need', description: 'closing acceptance',
      })
      const node = ctx.pactflow.createNode(session.id, {
        id: 'node', needId: need.id, title: 'Node', dependencies: [],
      })
      const parent = { id: session.id, session }
      ctx.provide('agents', { get: () => parent } as never)
      ctx.provide('subagents', {
        getProvider: () => ({ capabilities: { cwd: true } }),
        start: (_name: string, request: { cwd?: string }) => {
          git(['-C', request.cwd!, 'config', 'user.name', 'Worker'])
          git(['-C', request.cwd!, 'config', 'user.email', 'worker@example.invalid'])
          git(['-C', request.cwd!, 'commit', '--allow-empty', '-m', 'task commit'])
          return Promise.resolve({
            id: SessionId('closing-child'), localAgent: undefined,
            result: Promise.resolve({ output: [{ type: 'text', text: 'done' }], stopReason: 'completed' }),
            dispose: () => Promise.resolve(),
          })
        },
      } as never)
      const task = await ctx.pactflow.dispatchGitNode(session.id, {
        nodeId: node.id, expectedRevision: node.revision, provider: 'spawn',
        leaseDurationMs: 60_000, prompt: 'commit',
      })
      expect(task.run.state).toBe('succeeded')

      let current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: need.revision, to: 'discussion',
      })
      ctx.pactflow.recordReview(session.id, {
        needId: need.id, kind: 'requirement', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'confirmed',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'design',
      })
      ctx.pactflow.recordReview(session.id, {
        needId: need.id, kind: 'design', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'planning',
      })
      ctx.pactflow.recordReview(session.id, {
        needId: need.id, kind: 'plan', decision: 'approved', note: 'approved',
      })
      for (const phase of ['executing', 'code_review', 'verification'] as const) {
        current = ctx.pactflow.transitionNeed(session.id, {
          needId: need.id, expectedRevision: current.revision, to: phase,
        })
      }
      ctx.pactflow.recordReview(session.id, {
        needId: need.id, kind: 'verification', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'closing',
      })
      const closed = await ctx.pactflow.closeGitNeed(session.id, {
        needId: need.id, expectedRevision: current.revision,
      })
      expect(closed).toMatchObject({
        need: { phase: 'deployed' }, pullRequestNumber: 1,
        release: { branch: 'main', commit: mergeCommit },
        cleanupFailures: [],
      })
      expect(git(['--git-dir', remote, 'rev-parse', 'refs/heads/main^{commit}'])).toBe(mergeCommit)
      expect(() => git([
        '--git-dir', remote, 'show-ref', '--verify', `refs/heads/${task.run.git?.branch}`,
      ])).toThrow()
      await ctx.fiber.dispose()
    } finally {
      await new Promise<void>(resolveClose => server.close(() => resolveClose()))
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  }, 30_000)
})

async function readBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  return Buffer.concat(chunks).toString('utf8')
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}
