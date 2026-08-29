import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowRunId } from '../src/types.ts'
import type { PactFlowGitRunSpec, PactFlowK3sRunSpec, PactFlowRun } from '../src/types.ts'
import { createGitFixture } from './git-fixture.ts'

describe('PactFlow K3s cold reconciliation', () => {
  it('settles a pre-existing completed Job when the PactFlow Agent becomes live', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-pactflow-k3s-recovery-'))
    const priorDshHome = process.env.DSH_HOME
    process.env.DSH_HOME = join(root, '.dsh')
    let server: Server | undefined
    try {
      const { remote, workspace } = createGitFixture(root)
      const baseCommit = git(['-C', workspace, 'rev-parse', 'refs/remotes/origin/main^{commit}'])
      const branch = 'pactflow/recovery/node/recovered'
      const worktreePath = join(root, 'run-worktree')
      git(['-C', workspace, 'worktree', 'add', '-b', branch, worktreePath, baseCommit])
      const worker = join(root, 'worker')
      git(['clone', remote, worker])
      git(['-C', worker, 'switch', '-c', branch, baseCommit])
      git(['-C', worker, 'config', 'user.name', 'Recovery Worker'])
      git(['-C', worker, 'config', 'user.email', 'recovery@example.invalid'])
      git(['-C', worker, 'commit', '--allow-empty', '-m', 'recovered commit'])
      const commit = git(['-C', worker, 'rev-parse', 'HEAD^{commit}'])
      git(['-C', worker, 'push', 'origin', `HEAD:refs/heads/${branch}`])

      const finishedAt = Date.now()
      const jobName = 'dsh-pf-recovery'
      server = createKubeServer(jobName, branch, commit, finishedAt)
      await new Promise<void>((resolveListen, reject) => {
        server!.once('error', reject)
        server!.listen(0, '127.0.0.1', resolveListen)
      })
      const address = server.address() as AddressInfo
      const kubeconfig = join(root, 'kubeconfig.json')
      await writeFile(kubeconfig, JSON.stringify({
        apiVersion: 'v1', kind: 'Config',
        clusters: [{
          name: 'test',
          cluster: { server: `http://127.0.0.1:${String(address.port)}`, 'insecure-skip-tls-verify': true },
        }],
        users: [{ name: 'test', user: {} }],
        contexts: [{ name: 'test', context: { cluster: 'test', user: 'test' } }],
        'current-context': 'test',
      }))

      const ctx = new Context()
      await ctx.plugin(SessionStore)
      await ctx.plugin(SessionProjectionRegistry)
      await ctx.plugin(PactFlowService, {
        k3s: {
          namespace: 'pactflow', kubeconfig, imagePullSecret: 'pull', pollIntervalMs: 250,
          templates: [{
            id: 'dsh', harness: 'dsh', apiMode: 'openai-chat-completions',
            image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`,
            model: 'model', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
            cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
          }],
        },
      })
      const session = ctx.sessions.create(SessionId('recovery-session'), {
        meta: { agentPreset: 'pactflow', cwd: workspace },
      })
      ctx.pactflow.initialize(session.id, { name: 'Recovery' })
      ctx.pactflow.createNeed(session.id, { id: 'recovery', title: 'Recovery', description: '' })
      const ready = ctx.pactflow.createNode(session.id, {
        id: 'node', needId: 'recovery', title: 'Node', dependencies: [],
      })
      const runId = PactFlowRunId('run-11111111-2222-3333-4444-555555555555')
      const gitSpec: PactFlowGitRunSpec = {
        remote: 'origin', remoteUrl: remote, defaultBranch: 'main', baseCommit, branch, worktreePath,
        validationCommands: [],
      }
      const k3sSpec: PactFlowK3sRunSpec = {
        templateId: 'dsh', namespace: 'pactflow', jobName, configMapName: jobName,
        image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull',
        harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
        modelSecretName: 'model-secret', gitSecretName: 'git-secret',
        cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
        activeDeadlineSeconds: 600,
        finishedJobTtlSeconds: 86_400,
      }
      const node = { ...ready, state: 'claimed' as const, revision: 2, updatedAt: finishedAt - 1_000 }
      const run: PactFlowRun = {
        id: runId, nodeId: node.id, nodeRevision: node.revision, attempt: 1, provider: 'k3s:dsh',
        claimId: 'claim-recovery', state: 'claimed', leaseDurationMs: 600_000,
        leaseDeadline: finishedAt + 300_000, updatedAt: finishedAt - 1_000, git: gitSpec, k3s: k3sSpec,
      }
      session.append('pactflow/run-claimed', { v: 1, run, node })

      await ctx.pactflow.reconcileK3s(session.id)
      expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]?.state).toBe('succeeded')
      expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]).toMatchObject({
        gitResult: { commit, branch },
        k3sResult: { commit, branch, finishedAt },
        outcome: expect.stringContaining('Recovered K3s Worker'),
      })
      await ctx.fiber.dispose()
    } finally {
      await new Promise<void>(resolveClose => server?.close(() => resolveClose()) ?? resolveClose())
      if (priorDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = priorDshHome
      await rm(root, { recursive: true, force: true })
    }
  }, 20_000)
})

function createKubeServer(
  jobName: string,
  branch: string,
  commit: string,
  finishedAt: number,
): Server {
  return createServer((request, response) => {
    response.setHeader('content-type', 'application/json')
    if (request.url?.includes(`/jobs/${jobName}`) === true) {
      response.end(JSON.stringify({
        apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName }, status: { succeeded: 1 },
      }))
      return
    }
    if (request.url?.includes('/pods') === true) {
      response.end(JSON.stringify({
        apiVersion: 'v1', kind: 'PodList', metadata: {}, items: [{
          apiVersion: 'v1', kind: 'Pod',
          metadata: { name: `${jobName}-pod`, creationTimestamp: new Date(finishedAt).toISOString() },
          status: { containerStatuses: [{
            name: 'worker', ready: false, restartCount: 0, image: 'worker', imageID: 'worker',
            state: { terminated: {
              exitCode: 0, reason: 'Completed', startedAt: new Date(finishedAt - 1_000).toISOString(),
              finishedAt: new Date(finishedAt).toISOString(),
              message: JSON.stringify({
                schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit, branch,
                harnessVersion: 'test', agentExitCode: 0, pushExitCode: 0,
              }),
            } },
          }] },
        }],
      }))
      return
    }
    response.statusCode = 404
    response.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', code: 404, status: 'Failure' }))
  })
}

function git(args: readonly string[]): string {
  return execFileSync('git', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
}
