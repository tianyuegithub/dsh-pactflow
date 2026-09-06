import { execFileSync } from 'node:child_process'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { access, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowRunId } from '../src/types.ts'
import type { PactFlowGitRunSpec, PactFlowK3sRunSpec, PactFlowRun } from '../src/types.ts'
import { createGitFixture } from './git-fixture.ts'

const recoveryIdentity = { jobUid: 'recovery-job-uid', runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64), specDigest: '3'.repeat(64) }
const recoveryLabels = { 'pactflow.run': 'recovery', 'pactflow.run-nonce-hash': recoveryIdentity.runNonceHash.slice(0, 63),
  'pactflow.claim-token-hash': recoveryIdentity.claimTokenHash.slice(0, 63), 'pactflow.spec-digest': recoveryIdentity.specDigest.slice(0, 63) }
const recoveryAnnotations = { 'pactflow.dev/run-nonce-hash': recoveryIdentity.runNonceHash,
  'pactflow.dev/claim-token-hash': recoveryIdentity.claimTokenHash, 'pactflow.dev/spec-digest': recoveryIdentity.specDigest }

describe('PactFlow K3s cold reconciliation', () => {
  it.each(['empty', 'legacy', 'registered', 'missing-uid', 'missing-hash', 'missing-job', 'transient-recovery', 'transient-dispose', 'inventory-order'] as const)('reconciles a pre-existing Job with %s validation', async mode => {
    const legacyCommands = mode === 'legacy'
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
      let deletions = 0
      server = createKubeServer(jobName, branch, commit, finishedAt, () => { deletions++ }, mode === 'missing-job', mode.startsWith('transient-') ? 5 : 0)
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
      const registeredCommand = { command: process.execPath,
        args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'registered-execution'))}, 'verified')`], timeoutMs: 5_000 }
      if (mode === 'registered') {
        const registeredWorkspace = { id: 'recovery-workspace', path: workspace, title: 'Recovery', sessionIds: [session.id] }
        ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
        await ctx.pactflow.saveValidationProfiles({ workspaceId: registeredWorkspace.id, expectedRevision: 0,
          profiles: [{ ...registeredCommand, id: 'recovery-check', displayName: 'Recovery check' }] })
      }
      const gitSpec: PactFlowGitRunSpec = {
        remote: 'origin', remoteUrl: remote, defaultBranch: 'main', baseCommit, branch, worktreePath,
        validationCommands: legacyCommands ? [{ command: process.execPath,
          args: ['-e', `require('node:fs').writeFileSync(${JSON.stringify(join(root, 'unauthorized-execution'))}, 'executed')`],
          timeoutMs: 5_000 }] : mode === 'registered' ? [registeredCommand] : [],
        ...(mode === 'registered' ? { validationProfileIds: ['recovery-check'], validationProfileRevisions: { 'recovery-check': 1 } } : {}),
      }
      const k3sSpec: PactFlowK3sRunSpec = {
        ...recoveryIdentity, expectedBranch: branch, expectedBaseCommit: baseCommit,
        templateId: 'dsh', namespace: 'pactflow', jobName, configMapName: jobName,
        image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull',
        harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
        modelSecretName: 'model-secret', gitSecretName: 'git-secret',
        cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
        activeDeadlineSeconds: 600,
        finishedJobTtlSeconds: 86_400,
      }
      const node = { ...ready, state: 'claimed' as const, revision: 2, updatedAt: finishedAt - 1_000 }
      if (mode === 'missing-uid') Reflect.deleteProperty(k3sSpec, 'jobUid')
      if (mode === 'missing-hash') Reflect.deleteProperty(k3sSpec, 'claimTokenHash')
      const run: PactFlowRun = {
        id: runId, nodeId: node.id, nodeRevision: node.revision, attempt: 1, provider: 'k3s:dsh',
        claimId: 'claim-recovery', state: 'claimed', leaseDurationMs: 600_000,
        leaseDeadline: finishedAt + 300_000, updatedAt: finishedAt - 1_000, git: gitSpec, k3s: k3sSpec,
      }
      session.append('pactflow/run-claimed', { v: 1, run, node })

      const release = vi.fn()
      const reserve = vi.fn(() => release)
      if (mode.startsWith('transient-')) Reflect.set(ctx.pactflow, 'executionCapacity', { reserveExisting: reserve, pauseAdmission: () => () => {}, setInventoryFailure: () => {}, dispose: () => {} })
      const trace: string[] = []
      if (mode === 'inventory-order') {
        const second = ctx.pactflow.createNode(session.id, { id: 'second', needId: 'recovery', title: 'Second', dependencies: [] })
        session.append('pactflow/run-claimed', { v: 1,
          node: { ...second, revision: 2, state: 'claimed' },
          run: { ...run, id: PactFlowRunId('run-66666666-7777-8888-9999-000000000000'), nodeId: second.id,
            git: { ...gitSpec, branch: `${branch}-second`, worktreePath: join(root, 'second-worktree') },
            k3s: { ...k3sSpec, jobName: 'dsh-pf-second', jobUid: 'second-job-uid' } },
        })
        Reflect.set(ctx.pactflow, 'executionCapacity', {
          pauseAdmission: () => { trace.push('pause'); return () => { trace.push('resume') } },
          reserveExisting: () => { trace.push('reserve'); return () => { trace.push('release') } },
          setInventoryFailure: () => {}, dispose: () => {},
        })
        Reflect.set(ctx.pactflow, 'workerForRun', () => ({
          observe: async () => { trace.push('observe'); return { state: 'failed', finishedAt: Date.now(), outcome: 'isolated terminal result' } },
          cleanupRun: async () => {},
        }))
      }

      await ctx.pactflow.reconcileK3s(session.id)
      if (mode === 'inventory-order') {
        expect(trace.filter(value => value === 'reserve')).toHaveLength(2)
        expect(trace.indexOf('observe')).toBeGreaterThan(trace.lastIndexOf('reserve'))
        expect(trace.indexOf('resume')).toBeGreaterThan(trace.lastIndexOf('reserve'))
        expect(trace.filter(value => value === 'release')).toHaveLength(2)
        await ctx.fiber.dispose()
        return
      }
      if (mode === 'transient-dispose') {
        expect(release).not.toHaveBeenCalled()
        const deferred = Reflect.get(ctx.pactflow, 'deferredK3s')
        const timer = deferred.values().next().value.timer
        const clear = vi.spyOn(globalThis, 'clearTimeout')
        await ctx.fiber.dispose()
        expect(clear).toHaveBeenCalledWith(timer)
        clear.mockRestore()
        expect(deferred.size).toBe(0)
        expect(release).toHaveBeenCalledTimes(1)
        expect(deletions).toBe(0)
        expect(session.events.some(event => event.type === 'pactflow/run-settled')).toBe(false)
        return
      }
      if (mode === 'transient-recovery') {
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]?.state).toBe('claimed')
        expect(release).not.toHaveBeenCalled()
        await vi.waitFor(() => expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]?.state).toBe('succeeded'), { timeout: 10_000 })
        expect(reserve).toHaveBeenCalledTimes(1)
        expect(release).toHaveBeenCalledTimes(1)
      }
      if (mode === 'missing-job') {
        expect(deletions).toBe(1)
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]).toMatchObject({ state: 'failed' })
        expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.cleanups))
          .toEqual([expect.objectContaining({ runId, state: 'succeeded' })])
      } else if (mode === 'missing-uid' || mode === 'missing-hash') {
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]).toMatchObject({ state: 'failed', outcome: expect.stringContaining('identity') })
        expect(deletions).toBe(0)
        expect(Object.values(ctx.sessionProjections.stateOf(session, 'pactflowDelivery')!.cleanups))
          .toEqual([expect.objectContaining({ runId, state: 'failed', error: expect.stringContaining('identity') })])
      } else if (legacyCommands) {
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]).toMatchObject({
          state: 'failed', outcome: expect.stringMatching(/validation.*authorization/),
        })
        await expect(access(join(root, 'unauthorized-execution'))).rejects.toThrow()
      } else {
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]?.state).toBe('succeeded')
        expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]).toMatchObject({
          gitResult: { commit, branch },
          k3sResult: { commit, branch, finishedAt },
          outcome: expect.stringContaining('Recovered K3s Worker'),
        })
        if (mode === 'registered') {
          await expect(access(join(root, 'registered-execution'))).resolves.toBeUndefined()
          expect(ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId[runId]?.gitResult?.validations)
            .toEqual([expect.objectContaining({ ...registeredCommand, exitCode: 0 })])
        }
      }
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
  onDelete: () => void,
  missingJob = false,
  failedReads = 0,
): Server {
  return createServer((request, response) => {
    if (request.method === 'DELETE') onDelete()
    response.setHeader('content-type', 'application/json')
    if (request.method === 'GET' && request.url?.includes(`/jobs/${jobName}`) && failedReads > 0) {
      failedReads--
      response.statusCode = 503
      response.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', code: 503, status: 'Failure' }))
      return
    }
    if (missingJob) {
      response.statusCode = 404
      response.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', code: 404, status: 'Failure' }))
      return
    }
    if (request.url?.includes(`/jobs/${jobName}`) === true) {
      response.end(JSON.stringify({
        apiVersion: 'batch/v1', kind: 'Job', metadata: { name: jobName, uid: recoveryIdentity.jobUid,
          labels: recoveryLabels, annotations: recoveryAnnotations }, status: { succeeded: 1 },
      }))
      return
    }
    if (request.url?.includes('/pods') === true) {
      response.end(JSON.stringify({
        apiVersion: 'v1', kind: 'PodList', metadata: {}, items: [{
          apiVersion: 'v1', kind: 'Pod',
          metadata: { name: `${jobName}-pod`, uid: 'recovery-pod-uid', creationTimestamp: new Date(finishedAt).toISOString(),
            labels: recoveryLabels, annotations: recoveryAnnotations,
            ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: jobName, uid: recoveryIdentity.jobUid, controller: true }] },
          status: { containerStatuses: [{
            name: 'worker', ready: false, restartCount: 0, image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`,
            imageID: `docker-pullable://registry.invalid/worker@sha256:${'a'.repeat(64)}`,
            state: { terminated: {
              exitCode: 0, reason: 'Completed', startedAt: new Date(finishedAt - 1_000).toISOString(),
              finishedAt: new Date(finishedAt).toISOString(),
              message: JSON.stringify({
                schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit, branch, ...recoveryIdentity,
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
