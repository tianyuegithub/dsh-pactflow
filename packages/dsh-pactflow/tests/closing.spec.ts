import { execFileSync } from 'node:child_process'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { createGitFixture } from './git-fixture.ts'
import { recordAuthorizedReview } from './review-fixture.ts'

describe('PactFlow Gitea closing', () => {
  it.each(['empty', 'registered', 'workspace', 'session-override', 'changed', 'legacy', 'ledger-failure', 'release-failure', 'release-drift'] as const)('checks %s validation authorization before protected PR closing', async mode => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-closing-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    const { remote, workspace } = createGitFixture(root)
    const merger = join(root, 'merger')
    git(['clone', remote, merger])
    git(['-C', merger, 'config', 'user.name', 'Gitea Merge'])
    git(['-C', merger, 'config', 'user.email', 'gitea@example.invalid'])
    let pullHead = ''
    let pullHeadCommit = ''
    let mergeCommit = ''
    let mergeCalls = 0
    const server = createServer((request, response) => {
      void handleGitea(request, response).catch(() => {
        response.statusCode = 500
        response.end('{}')
      })
    })
    async function handleGitea(request: IncomingMessage, response: ServerResponse): Promise<void> {
      expect(request.headers.authorization)
        .toBe(`Basic ${Buffer.from('alice:gitea-test-token').toString('base64')}`)
      response.setHeader('content-type', 'application/json')
      if (request.method === 'GET' && request.url?.endsWith('/branch_protections/main') === true) {
        response.end(JSON.stringify({ required_approvals: 0, status_check_contexts: [] }))
        return
      }
      if (request.method === 'GET' && request.url?.endsWith('/pulls/1') === true) {
        response.end(JSON.stringify({
          number: 1, html_url: `${baseUrl}/owner/repo/pulls/1`, merged: mergeCommit.length > 0,
          merge_commit_sha: mergeCommit,
          mergeable: true,
          head: { ref: pullHead, sha: pullHeadCommit },
          base: { ref: 'main' },
        }))
        return
      }
      if (request.method === 'GET' && request.url?.includes('/pulls?') === true) {
        response.end(JSON.stringify(pullHead === '' ? [] : [{ number: 1, html_url: `${baseUrl}/owner/repo/pulls/1`,
          merged: mergeCommit !== '', merge_commit_sha: mergeCommit, head: { ref: pullHead, sha: pullHeadCommit }, base: { ref: 'main' } }]))
        return
      }
      if (request.method === 'POST' && request.url?.endsWith('/pulls/1/merge') === true) {
        mergeCalls++
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
        git(['-C', merger, 'fetch', 'origin', pullHead])
        pullHeadCommit = git(['-C', merger, 'rev-parse', 'FETCH_HEAD^{commit}'])
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
      await ctx.plugin(PactFlowService, {
        infrastructure: {
          clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [],
          gitProviders: [{
            id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl,
            tokenCredentialRef: 'GITEA_TEST_TOKEN', username: 'alice',
          }],
        },
      })
      ctx.provide('credentials', {
        describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
        resolve: () => Promise.resolve({ value: 'gitea-test-token', source: 'memory' }),
      } as never)
      const session = ctx.sessions.create(SessionId('closing-session'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      const initialized = ctx.pactflow.initialize(session.id, { name: 'Closing' })
      const marker = join(root, 'registered-validation')
      const profile = { id: 'closing-check', displayName: 'Closing check', command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'verified')`], timeoutMs: 5_000 }
      const registeredWorkspace = { id: 'closing-workspace', path: workspace, title: 'Closing', sessionIds: [session.id] }
      if (mode !== 'empty') {
        ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
        await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 0, profiles: [profile],
          ...(mode === 'workspace' ? { selectedProfileIds: [profile.id] } : {}) })
      }
      if (mode === 'workspace' || mode === 'session-override') {
        const config = await ctx.pactflow.adoptWorkspaceGit({ workspaceId: registeredWorkspace.id, expectedRevision: 1 })
        expect(await Reflect.get(ctx.pactflow, 'workspaceProjects').putIfRevision(config.revision, { ...config, revision: config.revision + 1,
          git: { ...config.git!, giteaProviderId: 'gitea', owner: 'owner', repo: 'repo',
            ...(mode === 'session-override' ? { remote: 'workspace-unused' } : {}) } })).toBe(true)
      }
      if (mode === 'workspace') {
        expect(ctx.pactflow.project(session.id).project?.git).toBeUndefined()
        expect(await ctx.pactflow.verifyGitea(session.id)).toMatchObject({ branchProtected: true })
      } else await ctx.pactflow.bindGit(session.id, {
        expectedRevision: initialized.revision, remote: 'origin', defaultBranch: 'main',
        giteaBaseUrl: baseUrl, giteaOwner: 'owner', giteaRepo: 'repo',
        giteaTokenCredentialRef: 'GITEA_TEST_TOKEN', validationProfileIds: mode === 'empty' ? [] : [profile.id],
      })
      expect(ctx.pactflow.project(session.id).project?.git?.gitea?.username).toBeUndefined()
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
      expect(task.run.git?.remote).toBe('origin')
      if (mode === 'workspace') expect(ctx.pactflow.project(session.id).project?.git).toBeUndefined()

      let current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: need.revision, to: 'discussion',
      })
      recordAuthorizedReview(ctx.pactflow, session, { ...need, revision: current.revision }, {
        kind: 'requirement', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'confirmed',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'design',
      })
      recordAuthorizedReview(ctx.pactflow, session, { ...need, revision: current.revision }, {
        kind: 'design', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'planning',
      })
      recordAuthorizedReview(ctx.pactflow, session, { ...need, revision: current.revision }, {
        kind: 'plan', decision: 'approved', note: 'approved',
      })
      for (const phase of ['executing', 'code_review', 'verification'] as const) {
        current = ctx.pactflow.transitionNeed(session.id, {
          needId: need.id, expectedRevision: current.revision, to: phase,
        })
      }
      recordAuthorizedReview(ctx.pactflow, session, { ...need, revision: current.revision }, {
        kind: 'verification', decision: 'approved', note: 'approved',
      })
      current = ctx.pactflow.transitionNeed(session.id, {
        needId: need.id, expectedRevision: current.revision, to: 'closing',
      })
      if (mode !== 'empty') await rm(marker)
      if (mode === 'changed') {
        await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 1,
          profiles: [{ ...profile, timeoutMs: 6_000 }] })
      }
      if (mode === 'legacy') {
        const project = ctx.pactflow.project(session.id).project!
        session.append('pactflow/project-configured', { v: 1, project: { ...project, revision: project.revision + 1,
          git: { ...project.git!, validationProfileIds: [], validationProfileRevisions: {}, legacyUntrusted: true } } })
      }
      if (mode === 'changed' || mode === 'legacy') {
        await expect(ctx.pactflow.closeGitNeed(session.id, { needId: need.id, expectedRevision: current.revision }))
          .rejects.toThrow(/changed after Git binding|authorization/)
        await expect(access(marker)).rejects.toThrow()
        expect(pullHead).toBe('')
        expect(mergeCommit).toBe('')
        expect(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.releases).toEqual({})
        await ctx.fiber.dispose()
        return
      }
      if (mode === 'ledger-failure') {
        const events = Reflect.get(ctx.pactflow, 'events')
        Reflect.set(ctx.pactflow, 'events', { ...events, append: (...args: unknown[]) => {
          if (args[1] === 'pactflow/cleanup-recorded') throw new Error('cleanup ledger write failed')
          return events.append(...args)
        } })
        await expect(ctx.pactflow.closeGitNeed(session.id, { needId: need.id, expectedRevision: current.revision }))
          .rejects.toThrow('cleanup ledger write failed')
        expect(ctx.sessionProjections.stateOf(session, 'pactflowNeeds')?.byId[need.id]?.phase).toBe('closing')
        expect(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.releases).toEqual({})
        expect(mergeCommit).toBe('') // Persist responsibility before the irreversible merge.
        Reflect.set(ctx.pactflow, 'events', events)
      }
      if (mode === 'release-failure' || mode === 'release-drift') {
        const events = Reflect.get(ctx.pactflow, 'events')
        Reflect.set(ctx.pactflow, 'events', { ...events, append: (...args: unknown[]) => {
          if (args[1] === 'pactflow/release-recorded') throw new Error('release write failed')
          return events.append(...args)
        } })
        await expect(ctx.pactflow.closeGitNeed(session.id, { needId: need.id, expectedRevision: current.revision })).rejects.toThrow('release write failed')
        expect(mergeCalls).toBe(1)
        Reflect.set(ctx.pactflow, 'events', events)
        if (mode === 'release-drift') {
          git(['--git-dir', remote, 'update-ref', `refs/heads/${task.run.git!.branch}`, task.run.git!.baseCommit, task.run.gitResult!.commit])
          await expect(ctx.pactflow.closeGitNeed(session.id, { needId: need.id, expectedRevision: current.revision }))
            .rejects.toThrow('task branch changed after verification')
          expect(mergeCalls).toBe(1)
          expect(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.releases).toEqual({})
          await ctx.fiber.dispose()
          return
        }
      }
      const closed = await ctx.pactflow.closeGitNeed(session.id, {
        needId: need.id, expectedRevision: current.revision,
      })
      expect(closed).toMatchObject({
        need: { phase: 'deployed' }, pullRequestNumber: 1,
        release: { branch: 'main', commit: mergeCommit },
        cleanupFailures: [],
      })
      expect(mergeCalls).toBe(1)
      const cleanupIntents = session.events.filter(event => event.type === 'pactflow/cleanup-recorded'
        && event.data.record.state === 'pending' && event.data.record.attempt === 1)
      const releaseEvent = session.events.find(event => event.type === 'pactflow/release-recorded')!
      expect(cleanupIntents).toHaveLength(2) // Integration checkout and the local Git task, no fictional K3s Job.
      expect(cleanupIntents.every(event => event.seq < releaseEvent.seq)).toBe(true)
      expect(git(['--git-dir', remote, 'rev-parse', 'refs/heads/main^{commit}'])).toBe(mergeCommit)
      if (mode === 'registered' || mode === 'workspace' || mode === 'session-override') await expect(access(marker)).resolves.toBeUndefined()
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
