import { randomUUID } from 'node:crypto'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle } from '@deepseek-ai/dsh-session'
import type { PACTFLOW_EVENT_TYPES } from '../domain.ts'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SubagentResult, SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type { PactFlowExecutionCapacity } from '../execution-capacity.ts'
import type { PactFlowGitWorkspace, PactFlowGitAuthSecret } from '../git-workspace.ts'
import type { PactFlowInfrastructure } from '../infrastructure.ts'
import type { PactFlowK3sWorker, PactFlowRunCleanupRecorder } from '../k3s-worker.ts'
import { pactFlowK3sSpecDigest } from '../k3s-worker.ts'
import {
  PactFlowRunId,
  type ClaimPactFlowNodeRequest,
  type DispatchPactFlowGitNodeRequest,
  type DispatchPactFlowK3sNodeRequest,
  type DispatchPactFlowLocalNodeRequest,
  type PactFlowClaimResult,
  type PactFlowGitBinding,
  type PactFlowGitResult,
  type PactFlowGitRunSpec,
  type PactFlowK3sResult,
  type PactFlowK3sRunSpec,
  type PactFlowModelConnectionSettings,
  type PactFlowNode,
  type PactFlowProject,
  type PactFlowRun,
  type PactFlowValidationProfile,
  type PactFlowWorkspaceProjectConfig,
  type RenewPactFlowRunRequest,
  type SettlePactFlowRunRequest,
} from '../types.ts'

/**
 * Host surface required by the dispatch seam. Members stay on the service
 * class; the host object routes calls back through instance methods so
 * instance-level overrides (tests) remain authoritative.
 */
export interface DispatchHost {
  /** Narrow ports instead of the whole Cordis Context (R12). */
  readonly agents: () => AgentRegistry | undefined
  readonly subagents: () => SubagentRuntime | undefined
  readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>
  readonly git: PactFlowGitWorkspace
  readonly executionCapacity: PactFlowExecutionCapacity
  readonly infrastructure: PactFlowInfrastructure | undefined
  readonly k3s: PactFlowK3sWorker | undefined
  readonly k3sByPool: Map<string, PactFlowK3sWorker>
  boundedOutcome(value: unknown): string
  subagentOutcome(result: SubagentResult): string
  livePactFlowSession(sessionId: string): Session
  requireProject(session: Session): PactFlowProject
  workspaceProjectForSession(session: Session): Promise<PactFlowWorkspaceProjectConfig | undefined>
  workspaceGitBinding(config: PactFlowWorkspaceProjectConfig | undefined): PactFlowGitBinding | undefined
  assertValidationProfilesCurrent(
    session: Session,
    binding: Pick<PactFlowGitRunSpec, 'validationCommands' | 'validationProfileIds' | 'validationProfileRevisions' | 'legacyUntrusted'>,
  ): Promise<readonly PactFlowValidationProfile[]>
  leaseDuration(value: number): number
  node(session: Session, rawId: string): PactFlowNode
  requireRevision(kind: string, id: string, current: number, expected: number): void
  resolveCredential(reference: string, label: string): Promise<string>
  claimNodeInSession(
    session: Session,
    request: ClaimPactFlowNodeRequest,
    options?: {
      readonly runId?: PactFlowRun['id']
      readonly git?: PactFlowGitRunSpec
      readonly k3s?: PactFlowK3sRunSpec
    },
  ): PactFlowClaimResult
  renewRun(sessionId: string, request: RenewPactFlowRunRequest): PactFlowClaimResult
  bindK3sRunInSession(session: Session, owned: PactFlowClaimResult, jobUid: string): PactFlowClaimResult
  settleRunInSession(
    session: Session,
    request: SettlePactFlowRunRequest,
    gitResult?: PactFlowGitResult,
    k3sResult?: PactFlowK3sResult,
    resultAt?: number,
  ): PactFlowClaimResult
  ensureK3sCleanup(session: Session, run: PactFlowRun): Promise<void>
  /** Register a discoverable, never-auto-cleaned responsibility for a failed local run. */
  retainLocalFailure(session: Session, run: PactFlowRun): void
  resolveGitAuth(spec: PactFlowGitRunSpec): Promise<PactFlowGitAuthSecret | undefined>
  workerForRun(spec: PactFlowK3sRunSpec): PactFlowK3sWorker
  /** Successful predecessor commits declared as code inputs for one node. */
  codeInputCommits(session: Session, node: PactFlowNode): readonly { readonly dependency: string; readonly branch: string; readonly commit: string }[]
  /** Durable creation-intent recorder for one Run, bound to the worker's connection identity. */
  runCleanupRecorder(k3s: PactFlowK3sWorker): PactFlowRunCleanupRecorder
  resolveK3sDispatch(poolId: string | undefined, templateId: string, modelConnectionId?: string): K3sDispatchRoute
  acquireExecutionOrCancel(
    session: Session,
    queueId: string,
    workspaceId: string | undefined,
    policy: PactFlowWorkspaceProjectConfig['worker'],
    profileId: string | undefined,
    poolId: string | undefined,
    signal?: AbortSignal,
  ): Promise<() => void>
  localExecution(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    requiresCwd: boolean,
  ): PactFlowLocalExecution
  executeClaimed(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    execution: PactFlowLocalExecution,
    claimed: PactFlowClaimResult,
    git?: PactFlowGitRunSpec,
    externalSignal?: AbortSignal,
  ): Promise<PactFlowClaimResult>
}

export async function acquireExecutionOrCancelImpl(
  host: DispatchHost,
  session: Session,
  queueId: string,
  workspaceId: string | undefined,
  policy: PactFlowWorkspaceProjectConfig['worker'],
  profileId: string | undefined,
  poolId: string | undefined,
  signal?: AbortSignal,
): Promise<() => void> {
  try {
    return await host.executionCapacity.acquire({
      workspaceId, policy, profileId, poolId,
      resolveInfrastructure: () => host.infrastructure,
      signal,
    })
  } catch (error) {
    host.events.append(session, 'pactflow/run-queue-cancelled', {
      v: 1, queueId, reason: host.boundedOutcome(error), cancelledAt: Date.now(),
    })
    throw error
  }
}

export interface K3sDispatchRoute {
  readonly worker: PactFlowK3sWorker
  readonly executionTemplateId: string
  readonly configurationSnapshot: string
  readonly modelConnection?: PactFlowModelConnectionSettings
  readonly poolId?: string
}

export function resolveK3sDispatchImpl(
  host: DispatchHost,
  poolId: string | undefined,
  templateId: string,
  modelConnectionId?: string,
): K3sDispatchRoute {
  if (host.infrastructure !== undefined) {
    const resolved = host.infrastructure.resolveExecution(poolId, templateId, modelConnectionId)
    const worker = host.k3sByPool.get(resolved.pool.id)
    if (worker === undefined) throw new Error(`PactFlow Worker Pool "${resolved.pool.id}" is not active`)
    return {
      worker, poolId: resolved.pool.id, executionTemplateId: resolved.executionTemplateId,
      configurationSnapshot: JSON.stringify({
        pool: resolved.pool,
        k3s: { ...resolved.k3s, templates: resolved.k3s.templates.filter(item => item.id === resolved.executionTemplateId) },
        modelConnection: resolved.modelConnection,
      }),
      ...(resolved.modelConnection === undefined ? {} : { modelConnection: resolved.modelConnection }),
    }
  }
  if (host.k3s === undefined) throw new Error('PactFlow K3s provider is not configured')
  if (poolId !== undefined) throw new Error('PactFlow legacy K3s provider does not support Worker Pool selection')
  return { worker: host.k3s, executionTemplateId: templateId, configurationSnapshot: templateId }
}

export function workerForRunImpl(host: DispatchHost, spec: PactFlowK3sRunSpec): PactFlowK3sWorker {
  if (spec.workerPoolId !== undefined) {
    const worker = host.k3sByPool.get(spec.workerPoolId)
    if (worker === undefined) throw new Error(`PactFlow Worker Pool "${spec.workerPoolId}" is not active`)
    return worker
  }
  if (host.k3s === undefined) throw new Error('PactFlow legacy K3s provider is not configured')
  return host.k3s
}

export async function dispatchK3sNodeWithSignalImpl(
  host: DispatchHost,
  sessionId: string,
  request: DispatchPactFlowK3sNodeRequest,
  signal?: AbortSignal,
): Promise<PactFlowClaimResult> {
  if (signal?.aborted) throw new Error('PactFlow K3s dispatch was cancelled before claim')
  const session = host.livePactFlowSession(sessionId)
  const project = host.requireProject(session)
  const workspaceProject = await host.workspaceProjectForSession(session)
  const projectGit = project.git ?? host.workspaceGitBinding(workspaceProject)
  const workspaceSnapshot = JSON.stringify(workspaceProject)
  if (projectGit === undefined) throw new Error('PactFlow project has no Git binding')
  await host.assertValidationProfilesCurrent(session, projectGit)
  if (projectGit.k3sGitSecretName === undefined) {
    throw new Error('PactFlow project has no K3s Git Secret binding')
  }
  const prompt = request.prompt.trim()
  const leaseDurationMs = host.leaseDuration(request.leaseDurationMs)
  const node = host.node(session, request.nodeId)
  host.requireRevision('node', node.id, node.revision, request.expectedRevision)
  if (node.state !== 'ready') throw new Error(`PactFlow node "${node.id}" is not ready`)
  const profiles = workspaceProject?.worker?.agentProfiles ?? []
  const workspaceProfile = request.agentProfileId === undefined
    ? profiles.filter(item => item.templateId === request.templateId
      && (request.modelConnectionId === undefined || item.modelConnectionId === request.modelConnectionId))
    : profiles.filter(item => item.id === request.agentProfileId)
  if (workspaceProject?.worker !== undefined && workspaceProfile.length !== 1) {
    throw new Error(request.agentProfileId === undefined
      ? `PactFlow dispatch must select one Agent Profile for Harness "${request.templateId}"`
      : `PactFlow Agent Profile "${request.agentProfileId}" is not configured`)
  }
  const selectedProfile = workspaceProfile[0]
  if (selectedProfile !== undefined && selectedProfile.templateId !== request.templateId) {
    throw new Error('PactFlow Agent Profile does not match the requested Harness')
  }
  const resolved = host.resolveK3sDispatch(
    request.workerPoolId ?? project.workerPoolId ?? workspaceProject?.worker?.workerPoolId,
    request.templateId,
    request.modelConnectionId ?? selectedProfile?.modelConnectionId,
  )
  const worker = resolved.worker
  await worker.preflight()
  const runId = PactFlowRunId(`run-${randomUUID()}`)
  const git = await host.git.plan(session.header.cwd, session.id, runId, node, projectGit, host.codeInputCommits(session, node))
  worker.preflightRun(git, prompt)
  const planned = worker.plan(
    runId, resolved.executionTemplateId, projectGit.k3sGitSecretName, leaseDurationMs, git, prompt,
  )
  const modelApiKey = resolved.modelConnection === undefined
    ? undefined
    : await host.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
  const k3sDraft: PactFlowK3sRunSpec = {
    ...planned,
    ...(workspaceProject === undefined ? {} : { projectConfigRevision: workspaceProject.revision }),
    ...(selectedProfile === undefined ? {} : { agentProfileId: selectedProfile.id }),
    ...(resolved.poolId === undefined ? {} : { workerPoolId: resolved.poolId }),
    ...(resolved.modelConnection === undefined ? {} : {
      modelConnectionId: resolved.modelConnection.id,
      modelSecretName: `${planned.jobName}-model`,
      ephemeralModelSecret: true,
    }),
  }
  const k3s: PactFlowK3sRunSpec = {
    ...k3sDraft,
    specDigest: pactFlowK3sSpecDigest(k3sDraft, git, prompt),
  }
  host.requireRevision('project', project.id, host.requireProject(session).revision, project.revision)
  const latestWorkspaceProject = await host.workspaceProjectForSession(session)
  if ((workspaceProject?.revision ?? 0) !== (latestWorkspaceProject?.revision ?? 0)
    || JSON.stringify(workspaceProject?.worker) !== JSON.stringify(latestWorkspaceProject?.worker)
    || JSON.stringify(workspaceProject?.validationProfiles) !== JSON.stringify(latestWorkspaceProject?.validationProfiles)
    || JSON.stringify(workspaceProject?.validationProfileIds) !== JSON.stringify(latestWorkspaceProject?.validationProfileIds)) {
    throw new Error('PactFlow dispatch Workspace configuration changed before claim')
  }
  const queueId = `queue-${randomUUID()}`
  host.events.append(session, 'pactflow/run-queued', {
    v: 1, queueId, sessionId: String(session.id), nodeId: node.id, requestedAt: Date.now(),
  })
  let releaseCapacity: (() => void) | undefined
  let runStarted = false
  // Any failure before `worker.run()` self-cleans discards the prepared Run's
  // in-memory secrets; a discarded plan never created external resources.
  const discardPrepared = (): void => { (worker as { discard?: (name: string) => void }).discard?.(planned.jobName) }
  try {
    releaseCapacity = await host.acquireExecutionOrCancel(
      session, queueId,
      workspaceProject?.worker === undefined ? undefined : workspaceProject.workspaceId,
      workspaceProject?.worker,
      selectedProfile?.id,
      resolved.poolId,
      signal,
    )
  } catch (error) {
    releaseCapacity?.()
    discardPrepared()
    throw error
  }
  try {
    try {
      await host.assertValidationProfilesCurrent(session, projectGit)
      const currentWorkspace = await host.workspaceProjectForSession(session)
      if (workspaceSnapshot !== JSON.stringify(currentWorkspace)) {
        throw new Error('PactFlow dispatch Workspace configuration changed while waiting')
      }
      host.requireRevision('project', project.id, host.requireProject(session).revision, project.revision)
      const currentRoute = host.resolveK3sDispatch(
        request.workerPoolId ?? project.workerPoolId ?? workspaceProject?.worker?.workerPoolId,
        request.templateId,
        request.modelConnectionId ?? selectedProfile?.modelConnectionId,
      )
      if (currentRoute.worker !== worker || currentRoute.configurationSnapshot !== resolved.configurationSnapshot) {
        throw new Error('PactFlow dispatch execution configuration changed while waiting')
      }
      if (signal?.aborted) throw new Error('PactFlow K3s dispatch was cancelled before claim')
    } catch (error) {
      host.events.append(session, 'pactflow/run-queue-cancelled', {
        v: 1, queueId, reason: host.boundedOutcome(error), cancelledAt: Date.now(),
      })
      throw error
    }
    let owned = host.claimNodeInSession(session, {
      nodeId: request.nodeId,
      expectedRevision: request.expectedRevision,
      provider: `k3s:${request.templateId}`,
      leaseDurationMs,
    }, { runId, git, k3s })
    try {
      // The remote container folds declared code inputs itself, so the local
      // worktree stays on the plain base and can fast-forward to its result.
      await host.git.materialize(session.header.cwd, git, { foldCodeInputs: false })
    } catch (error) {
      return host.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: host.boundedOutcome(error),
      })
    }

    const controller = new AbortController()
    const forwardAbort = (): void => controller.abort(signal?.reason ?? 'PactFlow K3s dispatch cancelled')
    if (signal !== undefined) {
      if (signal.aborted) forwardAbort()
      else signal.addEventListener('abort', forwardAbort, { once: true })
    }
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      owned = host.renewRun(session.id, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        leaseDurationMs,
      })
      timer = setInterval(() => {
        try {
          const liveOwned = owned
          if (liveOwned === undefined) return
          owned = host.renewRun(session.id, {
            runId: liveOwned.run.id,
            claimId: liveOwned.run.claimId,
            leaseDurationMs,
          })
        } catch {
          controller.abort('PactFlow K3s lease renewal failed')
        }
      }, Math.max(1_000, Math.floor(leaseDurationMs / 2)))
      let remoteResult: PactFlowK3sResult
      try {
        // From here `run()` owns the prepared secrets and releases them on every
        // terminal path, so the discard guard must stand down.
        runStarted = true
        remoteResult = await worker.run(
          k3s, git, prompt, controller.signal, modelApiKey, undefined,
          async (jobUid) => {
            owned = host.bindK3sRunInSession(session, owned, jobUid)
          },
          host.runCleanupRecorder(worker),
        )
        if (remoteResult.branch !== git.branch) throw new Error('PactFlow K3s Worker returned another branch')
      } catch (error) {
        const settled = host.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: controller.signal.aborted ? 'cancelled' : 'failed',
          outcome: host.boundedOutcome(error),
        })
        await host.ensureK3sCleanup(session, settled.run)
        return settled
      }
      let gitResult: PactFlowGitResult
      try {
        gitResult = await host.git.acceptRemoteResult(
          session.header.cwd,
          git,
          remoteResult.commit,
          await host.resolveGitAuth(git),
          await host.assertValidationProfilesCurrent(session, git),
        )
      } catch (error) {
        const settled = host.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: host.boundedOutcome(error),
        })
        await host.ensureK3sCleanup(session, settled.run)
        return settled
      }
      return host.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'succeeded',
        outcome: `K3s Worker ${remoteResult.podName} committed ${remoteResult.commit}`,
      }, gitResult, remoteResult, remoteResult.finishedAt)
    } finally {
      if (timer !== undefined) clearInterval(timer)
      if (signal !== undefined) signal.removeEventListener('abort', forwardAbort)
    }
  } finally {
    if (!runStarted) discardPrepared()
    releaseCapacity?.()
  }
}

/**
 * A08: the PactFlow preset's persona is a *read-only orchestrator* that explicitly
 * forbids writing, editing and Bash. A spawned Worker inherits that composition, so
 * without an override it obeys the orchestrator and produces no commit. When the
 * provider supports a per-child persona, the Host shadows that persona for the
 * child so the delegated task can actually run in its isolated task worktree.
 */
export const PACTFLOW_WORKER_PERSONA = [
  'You are a PactFlow Worker executing one bounded task in an isolated Git worktree.',
  'Your current working directory is already the task worktree on a dedicated task branch.',
  'You may read and modify files there, run commands, and commit your change to that branch.',
  'Do not merge, rebase, or switch branches, and do not push to the default branch.',
  'When the task is done, leave the worktree clean with your change committed.',
].join(' ')

/** A resolved local execution: the parent, the runtime, the prompt, and the worker persona when supported. */
export interface PactFlowLocalExecution {
  readonly parent: Agent
  readonly subagents: SubagentRuntime
  readonly prompt: string
  /** Present only when the provider advertises the `persona` capability. */
  readonly persona?: string
}

export function localExecutionImpl(
  host: DispatchHost,
  session: Session,
  request: DispatchPactFlowLocalNodeRequest,
  requiresCwd: boolean,
): PactFlowLocalExecution {
  const agents = host.agents()
  const subagents = host.subagents()
  const parent = agents?.get(session.id)
  if (parent === undefined) throw new Error(`session "${session.id}" has no live parent Agent`)
  if (subagents === undefined) throw new Error('PactFlow local dispatch requires the Subagent runtime')
  const provider = subagents.getProvider(request.provider)
  if (provider === undefined) {
    throw new Error(`PactFlow Subagent provider "${request.provider}" is not registered`)
  }
  if (requiresCwd && provider.capabilities?.cwd !== true) {
    throw new Error(`PactFlow Subagent provider "${request.provider}" cannot select a task worktree`)
  }
  const prompt = request.prompt.trim()
  if (prompt.length === 0) throw new Error('PactFlow local Worker prompt must be non-empty')
  return {
    parent, subagents, prompt,
    // Only request a persona when the provider supports it; DSH rejects it otherwise.
    ...provider.capabilities?.persona === true ? { persona: PACTFLOW_WORKER_PERSONA } : {},
  }
}

export async function dispatchGitNodeWithSignalImpl(
  host: DispatchHost,
  sessionId: string,
  request: DispatchPactFlowGitNodeRequest,
  signal?: AbortSignal,
): Promise<PactFlowClaimResult> {
  if (signal?.aborted) throw new Error('PactFlow Git dispatch was cancelled before claim')
  const session = host.livePactFlowSession(sessionId)
  const execution = host.localExecution(session, request, true)
  const project = host.requireProject(session)
  const workspaceProject = await host.workspaceProjectForSession(session)
  const binding = project.git ?? host.workspaceGitBinding(workspaceProject)
  if (binding === undefined) throw new Error('PactFlow project has no Git binding')
  await host.assertValidationProfilesCurrent(session, binding)
  const node = host.node(session, request.nodeId)
  host.requireRevision('node', node.id, node.revision, request.expectedRevision)
  if (node.state !== 'ready') throw new Error(`PactFlow node "${node.id}" is not ready`)
  // F07: the local path shares the same admission as K3s — queue, acquire a slot,
  // then recheck cancellation and revisions before claiming.
  const workspaceSnapshot = JSON.stringify(workspaceProject)
  const queueId = `queue-${randomUUID()}`
  host.events.append(session, 'pactflow/run-queued', {
    v: 1, queueId, sessionId: String(session.id), nodeId: node.id, requestedAt: Date.now(),
  })
  let releaseCapacity: (() => void) | undefined
  try {
    releaseCapacity = await host.acquireExecutionOrCancel(
      session, queueId,
      workspaceProject?.worker === undefined ? undefined : workspaceProject.workspaceId,
      workspaceProject?.worker,
      undefined,
      undefined,
      signal,
    )
  } catch (error) {
    releaseCapacity?.()
    throw error
  }
  try {
    try {
      await host.assertValidationProfilesCurrent(session, binding)
      if (workspaceSnapshot !== JSON.stringify(await host.workspaceProjectForSession(session))) {
        throw new Error('PactFlow dispatch Workspace configuration changed while waiting')
      }
      host.requireRevision('node', node.id, host.node(session, request.nodeId).revision, request.expectedRevision)
      host.requireRevision('project', project.id, host.requireProject(session).revision, project.revision)
      if (signal?.aborted) throw new Error('PactFlow Git dispatch was cancelled before claim')
    } catch (error) {
      host.events.append(session, 'pactflow/run-queue-cancelled', {
        v: 1, queueId, reason: host.boundedOutcome(error), cancelledAt: Date.now(),
      })
      throw error
    }
    const runId = PactFlowRunId(`run-${randomUUID()}`)
    const git = await host.git.plan(session.header.cwd, session.id, runId, node, binding, host.codeInputCommits(session, node))
    host.requireRevision('project', project.id, host.requireProject(session).revision, project.revision)
    const owned = host.claimNodeInSession(session, request, { runId, git })
    try {
      await host.git.materialize(session.header.cwd, git)
    } catch (error) {
      const settled = host.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: host.boundedOutcome(error),
      })
      // A05: keep the failed scene discoverable without auto-deleting it.
      host.retainLocalFailure(session, settled.run)
      return settled
    }
    return await host.executeClaimed(session, request, execution, owned, git, signal)
  } finally {
    releaseCapacity?.()
  }
}

export async function executeClaimedImpl(
  host: DispatchHost,
  session: Session,
  request: DispatchPactFlowLocalNodeRequest,
  execution: PactFlowLocalExecution,
  claimed: PactFlowClaimResult,
  git?: PactFlowGitRunSpec,
  externalSignal?: AbortSignal,
): Promise<PactFlowClaimResult> {
  let owned = claimed
  const controller = new AbortController()
  const forwardAbort = (): void => controller.abort(externalSignal?.reason ?? 'PactFlow dispatch cancelled')
  if (externalSignal !== undefined) {
    if (externalSignal.aborted) forwardAbort()
    else externalSignal.addEventListener('abort', forwardAbort, { once: true })
  }
  let child: SubagentRun
  try {
    child = await execution.subagents.start(request.provider, {
      label: owned.node.title,
      prompt: [{ type: 'text', text: execution.prompt }],
      parent: execution.parent,
      signal: controller.signal,
      ...git === undefined ? {} : { cwd: git.worktreePath },
      // A08: shadow the read-only orchestrator persona so the Worker can write.
      ...execution.persona === undefined ? {} : { persona: execution.persona },
    })
  } catch (error) {
    const settled = host.settleRunInSession(session, {
      runId: owned.run.id,
      claimId: owned.run.claimId,
      expectedNodeRevision: owned.node.revision,
      state: 'failed',
      outcome: host.boundedOutcome(error),
    })
    host.retainLocalFailure(session, settled.run)
    return settled
  }
  let timer: ReturnType<typeof setInterval> | undefined
  try {
    owned = host.renewRun(session.id, {
      runId: owned.run.id,
      claimId: owned.run.claimId,
      leaseDurationMs: request.leaseDurationMs,
    })
    const renewEvery = Math.max(1_000, Math.floor(request.leaseDurationMs / 2))
    timer = setInterval(() => {
      try {
        owned = host.renewRun(session.id, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          leaseDurationMs: request.leaseDurationMs,
        })
      } catch {
        controller.abort('PactFlow lease renewal failed')
      }
    }, renewEvery)
    let result: SubagentResult
    try {
      result = await child.result
    } catch (error) {
      const settled = host.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: host.boundedOutcome(error),
      })
      host.retainLocalFailure(session, settled.run)
      return settled
    }
    let gitResult: PactFlowGitResult | undefined
    if (result.stopReason === 'completed' && git !== undefined) {
      try {
        const localResult = await host.git.validateResult(git, await host.assertValidationProfilesCurrent(session, git))
        gitResult = await host.git.syncResult(
          session.header.cwd,
          git,
          localResult,
          await host.resolveGitAuth(git),
        )
      } catch (error) {
        // Diagnosability: a Git-side rejection alone ("produced no commit") hides
        // whether the Worker reported success or silently did nothing. Fold the
        // Worker's own bounded outcome into the failure so a human can tell them apart.
        const workerReport = host.subagentOutcome(result)
        const settled = host.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: host.boundedOutcome(`${host.boundedOutcome(error)} — Worker reported: ${workerReport}`),
        })
        host.retainLocalFailure(session, settled.run)
        return settled
      }
    }
    return host.settleRunInSession(session, {
      runId: owned.run.id,
      claimId: owned.run.claimId,
      expectedNodeRevision: owned.node.revision,
      state: result.stopReason === 'completed'
        ? 'succeeded'
        : result.stopReason === 'aborted' ? 'cancelled' : 'failed',
      outcome: host.subagentOutcome(result),
    }, gitResult)
  } finally {
    if (timer !== undefined) clearInterval(timer)
    if (externalSignal !== undefined) externalSignal.removeEventListener('abort', forwardAbort)
    await child.dispose()
  }
}
