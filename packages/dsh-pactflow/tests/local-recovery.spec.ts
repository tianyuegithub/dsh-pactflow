import { Context } from '@deepseek-ai/cordis'
import { execFileSync } from 'node:child_process'
import { appendFileSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rename, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { afterEach, describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { localGitEnvironment } from '../src/local-workspace.ts'
import type { PactFlowRecoveryCandidate } from '../src/types.ts'
import { approveExecutionPlanFixture, unconfinedWorkerContextFixture } from './execution-plan-fixture.ts'
import { createGitFixture } from './git-fixture.ts'

vi.setConfig({ testTimeout: 30_000 })

const prompt = 'recover and commit the retained candidate'
const candidateBody = 'retained candidate with trailing spaces   \n'
let sequence = 0
const active: Harness[] = []

function git(args: readonly string[]): string {
  return execFileSync('git', args, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    env: localGitEnvironment(),
  }).trim()
}

interface Harness {
  readonly root: string
  readonly previousDshHome: string | undefined
  readonly ctx: Context
  readonly session: Session
  readonly workspace: string
  readonly started: ReturnType<typeof vi.fn>
  readonly recoveredBodies: string[]
}

async function harness(label: string, failuresBeforeCommit = 1): Promise<Harness> {
  sequence += 1
  const root = await mkdtemp(join(tmpdir(), `pactflow-local-recovery-${label}-`))
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = join(root, '.dsh')
  const { workspace } = createGitFixture(root)
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  const session = ctx.sessions.create(SessionId(`local-recovery-${label}-${String(sequence)}`), {
    meta: { agentPreset: 'pactflow', cwd: workspace },
  })
  const initialized = ctx.pactflow.initialize(session.id, { name: 'Local recovery' })
  const registeredWorkspace = {
    id: `local-recovery-workspace-${label}-${String(sequence)}`,
    path: workspace,
    title: 'Local recovery',
    sessionIds: [session.id],
  }
  ctx.provide('workspaceRegistry', { list: () => [registeredWorkspace], get: () => registeredWorkspace } as never)
  await ctx.pactflow.saveValidationProfiles({
    workspaceId: registeredWorkspace.id,
    expectedRevision: 0,
    profiles: [{ id: 'git-status', displayName: 'Git status', command: 'git', args: ['status', '--short'], timeoutMs: 5_000 }],
  })
  await ctx.pactflow.bindGit(session.id, {
    expectedRevision: initialized.revision,
    remote: 'origin',
    defaultBranch: 'main',
    validationProfileIds: ['git-status'],
  })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: 'Recover retained work' })
  ctx.pactflow.createNode(session.id, { id: 'node', needId: need.id, title: 'Node', dependencies: [] })
  const started = vi.fn()
  const recoveredBodies: string[] = []
  const parent = { id: session.id, session, ctx: unconfinedWorkerContextFixture() }
  ctx.provide('agents', { get: () => parent } as never)
  ctx.provide('subagents', {
    list: () => ['spawn'],
    getProvider: (name: string) => name === 'spawn' ? { capabilities: { cwd: true } } : undefined,
    start: (_provider: string, request: { cwd?: string }) => {
      const call = started.mock.calls.length + 1
      started(request.cwd)
      if (call <= failuresBeforeCommit) {
        writeFileSync(join(request.cwd!, 'retained candidate.txt'), call === 1 ? candidateBody : `${candidateBody}attempt ${String(call)}\n`)
      } else {
        recoveredBodies.push(readFileSync(join(request.cwd!, 'retained candidate.txt'), 'utf8'))
        git(['-C', request.cwd!, 'add', 'retained candidate.txt'])
        git(['-C', request.cwd!, 'commit', '-m', 'recover retained candidate'])
      }
      return Promise.resolve({
        id: SessionId(`local-recovery-child-${String(sequence)}-${String(call)}`),
        localAgent: undefined,
        result: Promise.resolve({ output: [{ type: 'text', text: call === 1 ? 'completed without commit' : 'recovered and committed' }], stopReason: 'completed' }),
        dispose: () => Promise.resolve(),
      })
    },
  } as never)
  const value = { root, previousDshHome, ctx, session, workspace, started, recoveredBodies }
  active.push(value)
  return value
}

async function failWithRetainedCandidate(value: Harness) {
  const node = ctxNode(value)
  await approveExecutionPlanFixture(value.ctx, value.session.id, prompt, { kind: 'git', provider: 'spawn' }, node.id)
  const settled = await value.ctx.pactflow.dispatchGitNode(value.session.id, {
    nodeId: node.id,
    expectedRevision: node.revision,
    provider: 'spawn',
    leaseDurationMs: 60_000,
    prompt,
  })
  expect(settled.run.state).toBe('failed')
  expect(settled.run.git?.checkoutKind).toBe('isolated-clone')
  const cleanup = value.ctx.sessionProjections.stateOf(value.session, 'pactflowDelivery')
    ?.cleanups[`cleanup-${settled.run.id}-git-retained`]
  expect(cleanup).toMatchObject({ runId: settled.run.id, needId: 'need', retain: true })
  return settled
}

function ctxNode(value: Harness, id = 'node') {
  return value.ctx.pactflow.dag(value.session.id).byId[id]!
}

async function candidates(value: Harness, nodeId = 'node'): Promise<readonly PactFlowRecoveryCandidate[]> {
  return await value.ctx.pactflow.localRecoveryCandidates(value.session.id, nodeId)
}

function requireAvailable(candidate: PactFlowRecoveryCandidate | undefined): PactFlowRecoveryCandidate & { readonly available: true } {
  if (candidate === undefined || !candidate.available) throw new Error('expected an available recovery candidate')
  return candidate
}

afterEach(async () => {
  while (active.length > 0) {
    const value = active.pop()!
    await value.ctx.fiber.dispose()
    if (value.previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = value.previousDshHome
    await rm(value.root, { recursive: true, force: true })
  }
})

describe('PactFlow local recovery Host flow', () => {
  it('recovers one retained candidate into a new isolated Run and cold projection', async () => {
    const value = await harness('success')
    const failed = await failWithRetainedCandidate(value)
    const [candidateRow] = await candidates(value)
    expect(candidateRow).toEqual({
      runId: failed.run.id,
      nodeId: 'node',
      needId: 'need',
      available: true,
      baseCommit: failed.run.git!.baseCommit,
      sourceHead: failed.run.git!.baseCommit,
      digest: expect.stringMatching(/^[a-f0-9]{64}$/),
      changedFiles: 1,
    })
    const candidate = requireAvailable(candidateRow)
    expect(JSON.stringify(candidate)).not.toContain(candidateBody.trim())

    const sourcePath = failed.run.git!.worktreePath
    const sourceHead = git(['-C', sourcePath, 'rev-parse', 'HEAD'])
    const sourceDirty = git(['-C', sourcePath, 'status', '--porcelain=v1', '--untracked-files=all'])
    const sourceContent = readFileSync(join(sourcePath, 'retained candidate.txt'), 'utf8')
    const recovery = { runId: candidate.runId, digest: candidate.digest }
    await approveExecutionPlanFixture(value.ctx, value.session.id, prompt, { kind: 'git', provider: 'spawn', recovery }, 'node')
    const retried = value.ctx.pactflow.retryNode(value.session.id, {
      nodeId: 'node',
      expectedRevision: ctxNode(value).revision,
    })
    const recovered = await value.ctx.pactflow.dispatchGitNode(value.session.id, {
      nodeId: 'node',
      expectedRevision: retried.revision,
      provider: 'spawn',
      leaseDurationMs: 60_000,
      prompt,
      recovery,
    })

    expect(recovered.run).toMatchObject({
      state: 'succeeded',
      git: {
        checkoutKind: 'isolated-clone',
        recoveryInput: { runId: candidate.runId, digest: candidate.digest, sourceHead: candidate.sourceHead },
      },
      gitResult: {
        commit: expect.stringMatching(/^[a-f0-9]{40,64}$/),
        validations: [{ command: 'git', args: ['status', '--short'], timeoutMs: 5_000, exitCode: 0 }],
      },
    })
    expect(value.recoveredBodies).toEqual([candidateBody])
    expect((await value.ctx.pactflow.snapshot(value.session.id)).runs.byId[failed.run.id]?.state).toBe('failed')
    expect(git(['-C', sourcePath, 'rev-parse', 'HEAD'])).toBe(sourceHead)
    expect(git(['-C', sourcePath, 'status', '--porcelain=v1', '--untracked-files=all'])).toBe(sourceDirty)
    expect(readFileSync(join(sourcePath, 'retained candidate.txt'), 'utf8')).toBe(sourceContent)
    expect(git(['-C', value.workspace, 'rev-parse', 'HEAD'])).toBe(failed.run.git!.baseCommit)
    expect(git(['-C', value.workspace, 'rev-parse', recovered.run.gitResult!.remoteRef])).toBe(recovered.run.gitResult!.commit)

    const claimedEvent = value.session.events.find(event => event.type === 'pactflow/run-claimed'
      && event.data.run.id === recovered.run.id)
    expect(claimedEvent?.data.run.git).toMatchObject({ checkoutKind: 'isolated-clone', recoveryInput: recovered.run.git!.recoveryInput })
    const restored = value.ctx.sessionProjections.restore({}, value.session.events, 0, value.session.header).snapshot.values
    expect(restored.pactflowRuns?.byId[recovered.run.id]?.git).toMatchObject({
      checkoutKind: 'isolated-clone',
      recoveryInput: recovered.run.git!.recoveryInput,
    })
  })

  it('cancels the queue before claim when retained content changes after approval', async () => {
    const value = await harness('digest-drift')
    const failed = await failWithRetainedCandidate(value)
    const [candidateRow] = await candidates(value)
    expect(candidateRow?.available).toBe(true)
    const candidate = requireAvailable(candidateRow)
    const recovery = { runId: candidate.runId, digest: candidate.digest }
    await approveExecutionPlanFixture(value.ctx, value.session.id, prompt, { kind: 'git', provider: 'spawn', recovery }, 'node')
    appendFileSync(join(failed.run.git!.worktreePath, 'retained candidate.txt'), 'drift\n')
    const retried = value.ctx.pactflow.retryNode(value.session.id, {
      nodeId: 'node', expectedRevision: ctxNode(value).revision,
    })
    const claimsBefore = value.session.events.filter(event => event.type === 'pactflow/run-claimed').length

    await expect(value.ctx.pactflow.dispatchGitNode(value.session.id, {
      nodeId: 'node', expectedRevision: retried.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt, recovery,
    })).rejects.toThrow(/内容已变化/)
    expect(value.session.events.filter(event => event.type === 'pactflow/run-claimed')).toHaveLength(claimsBefore)
    expect(value.session.events.filter(event => event.type === 'pactflow/run-queue-cancelled')).toHaveLength(1)
    expect(value.started).toHaveBeenCalledTimes(1)
  })

  it('returns other candidates when one retained checkout is no longer readable', async () => {
    const value = await harness('partial-candidates', 2)
    const first = await failWithRetainedCandidate(value)
    await approveExecutionPlanFixture(value.ctx, value.session.id, prompt, { kind: 'git', provider: 'spawn' }, 'node')
    const retried = value.ctx.pactflow.retryNode(value.session.id, {
      nodeId: 'node', expectedRevision: ctxNode(value).revision,
    })
    const second = await value.ctx.pactflow.dispatchGitNode(value.session.id, {
      nodeId: 'node', expectedRevision: retried.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt,
    })
    expect(second.run.state).toBe('failed')
    expect((await candidates(value)).filter(candidate => candidate.available)).toHaveLength(2)

    await rename(second.run.git!.worktreePath, join(value.root, 'retained-checkout-backup'))
    const rows = await candidates(value)
    expect(rows).toHaveLength(2)
    expect(rows.find(candidate => candidate.runId === first.run.id)).toMatchObject({ available: true })
    expect(rows.find(candidate => candidate.runId === second.run.id)).toMatchObject({
      available: false,
      reason: expect.any(String),
    })
  })

  it('rejects a candidate retained for another node during plan confirmation', async () => {
    const value = await harness('cross-node')
    await failWithRetainedCandidate(value)
    const [candidateRow] = await candidates(value)
    expect(candidateRow?.available).toBe(true)
    const candidate = requireAvailable(candidateRow)
    const recovery = { runId: candidate.runId, digest: candidate.digest }
    const otherNeed = value.ctx.pactflow.createNeed(value.session.id, { id: 'other-need', title: 'Other', description: '' })
    const other = value.ctx.pactflow.createNode(value.session.id, { id: 'other-node', needId: otherNeed.id, title: 'Other node', dependencies: [] })
    await expect(approveExecutionPlanFixture(value.ctx, value.session.id, prompt,
      { kind: 'git', provider: 'spawn', recovery }, other.id)).rejects.toThrow(/当前需求节点已保留/)
  })

  it('excludes an unretained candidate and rejects it during dispatch', async () => {
    const value = await harness('not-retained')
    const failed = await failWithRetainedCandidate(value)
    const [candidateRow] = await candidates(value)
    expect(candidateRow?.available).toBe(true)
    const candidate = requireAvailable(candidateRow)
    const recovery = { runId: candidate.runId, digest: candidate.digest }
    await approveExecutionPlanFixture(value.ctx, value.session.id, prompt,
      { kind: 'git', provider: 'spawn', recovery }, 'node')
    const delivery = value.ctx.sessionProjections.stateOf(value.session, 'pactflowDelivery')!
    delete (delivery.cleanups as Record<string, unknown>)[`cleanup-${failed.run.id}-git-retained`]
    expect(await candidates(value)).toEqual([])
    const retried = value.ctx.pactflow.retryNode(value.session.id, {
      nodeId: 'node', expectedRevision: ctxNode(value).revision,
    })
    await expect(value.ctx.pactflow.dispatchGitNode(value.session.id, {
      nodeId: 'node', expectedRevision: retried.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt, recovery,
    })).rejects.toThrow(/当前需求节点已保留/)
    expect(value.started).toHaveBeenCalledTimes(1)
  })

  it('does not dispatch a recovery candidate omitted from the approved plan', async () => {
    const value = await harness('missing-plan-recovery')
    await failWithRetainedCandidate(value)
    const [candidateRow] = await candidates(value)
    expect(candidateRow?.available).toBe(true)
    const candidate = requireAvailable(candidateRow)
    await approveExecutionPlanFixture(value.ctx, value.session.id, prompt, { kind: 'git', provider: 'spawn' }, 'node')
    const retried = value.ctx.pactflow.retryNode(value.session.id, {
      nodeId: 'node', expectedRevision: ctxNode(value).revision,
    })
    await expect(value.ctx.pactflow.dispatchGitNode(value.session.id, {
      nodeId: 'node', expectedRevision: retried.revision, provider: 'spawn', leaseDurationMs: 60_000, prompt,
      recovery: { runId: candidate.runId, digest: candidate.digest },
    })).rejects.toThrow(/重新确认|授权/)
    expect(value.started).toHaveBeenCalledTimes(1)
  })
})
