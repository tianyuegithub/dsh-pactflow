import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle, Session } from '@deepseek-ai/dsh-session'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SubagentResult, SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { KubeConfig } from '@kubernetes/client-node'
import {
  PACTFLOW_EVENT_TYPES,
  PACTFLOW_EVENT_TYPES_V0_1,
  PACTFLOW_EVENT_TYPES_V0_2,
  PACTFLOW_EVENT_TYPES_V0_2_1,
  PACTFLOW_EVENT_TYPES_V0_3,
  PACTFLOW_PROJECTIONS,
} from './domain.ts'
import { PactFlowGitWorkspace, type PactFlowGitAuthSecret } from './git-workspace.ts'
import { PactFlowGiteaClient } from './gitea.ts'
import {
  PACTFLOW_HARNESS_API_MODE,
  PactFlowK3sWorker,
  pactFlowK3sSpecDigest,
  type PactFlowK3sConfig,
} from './k3s-worker.ts'
import { PactFlowInfrastructure, pactFlowImageOf } from './infrastructure.ts'
import { PactFlowInfrastructureHealthStore } from './infrastructure-health.ts'
import { harborProjectName, harborRepositoryPathSegment, joinUrlPath, probeHttp, requestJson } from './infrastructure-probe.ts'
import { synchronizeHarnessTemplates } from './harness-discovery.ts'
import {
  PactFlowWorkspaceProjectStore,
  attachAndPushWorkspaceRemote,
  initializeWorkspaceGit,
  inspectWorkspaceGit,
} from './workspace-project.ts'
import { PactFlowProjectCapacity } from './project-capacity.ts'
import { PactFlowExecutionCapacity } from './execution-capacity.ts'
import { pactFlowReviewEvidenceDigest } from './review-authorization.ts'
import { PactFlowNeedId, PactFlowNodeId, PactFlowProjectId, PactFlowRunId } from './types.ts'
import type {
  BindPactFlowGitRequest,
  PactFlowAdoptWorkspaceGitRequest,
  PactFlowMigrateWorkspaceProjectRequest,
  ClosePactFlowNeedRequest,
  ClosePactFlowNeedResult,
  RetryPactFlowCleanupRequest,
  ClaimPactFlowNodeRequest,
  CreatePactFlowNeedRequest,
  CreatePactFlowNodeRequest,
  DispatchPactFlowGitNodeRequest,
  DispatchPactFlowK3sNodeRequest,
  DispatchPactFlowLocalNodeRequest,
  InitializePactFlowProjectRequest,
  PactFlowClaimResult,
  PactFlowCleanupRecord,
  PactFlowDagProjection,
  PactFlowGitResult,
  PactFlowGitBinding,
  PactFlowGiteaBinding,
  PactFlowGitRunSpec,
  PactFlowGiteaStatus,
  PactFlowHealth,
  PactFlowHarnessTemplateView,
  PactFlowHarnessProfileSettings,
  PactFlowHarborArtifactOption,
  PactFlowInfrastructureSettings,
  PactFlowInfrastructureProbeRequest,
  PactFlowInfrastructureProbeResult,
  PactFlowInfrastructureHealthRecord,
  PactFlowInfrastructureProbeStage,
  PactFlowInfrastructureDeletionImpact,
  PactFlowInfrastructureResourceKind,
  PactFlowDiscoveredModel,
  PactFlowModelConnectionSettings,
  PactFlowHarnessProbeRequest,
  PactFlowHarnessProbeResult,
  PactFlowApiProbeResult,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowKubeconfigView,
  PactFlowWorkerPoolStatus,
  PactFlowWorkspaceProjectConfig,
  PactFlowWorkspaceProjectView,
  PactFlowInitializeWorkspaceGitRequest,
  PactFlowSaveWorkspaceWorkerPolicyRequest,
  PactFlowCreateWorkspaceRemoteRequest,
  PactFlowSaveValidationProfilesRequest,
  PactFlowValidationProfile,
  PactFlowValidationProfileInput,
  PactFlowNeed,
  PactFlowNode,
  PactFlowPhase,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowProjectRecord,
  PactFlowRelease,
  PactFlowSnapshot,
  PactFlowReview,
  PactFlowRun,
  RecordPactFlowReviewRequest,
  RenewPactFlowRunRequest,
  RetryPactFlowNodeRequest,
  SettlePactFlowRunRequest,
  TransitionPactFlowNeedRequest,
  UpdatePactFlowNodeDependenciesRequest,
} from './types.ts'

export type { PactFlowHealth } from './types.ts'

export interface Config {
  readonly k3s?: false | PactFlowK3sConfig
  readonly infrastructure?: false | PactFlowInfrastructureSettings
}

interface PactFlowWorkspaceHandle {
  readonly id: unknown
  readonly path: string
  readonly title: string
  readonly sessionIds: readonly unknown[]
}

interface PactFlowWorkspaceRegistry {
  list(): readonly PactFlowWorkspaceHandle[]
  get(id: never): PactFlowWorkspaceHandle | undefined
}

const VERSION = '0.2.1'
const EVENT_PRODUCER_VERSION = '0.3.0'
const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url))
const PACTFLOW_SETTINGS_NS = settingsNamespace('pactflow')
const NEXT_PHASE: Readonly<Partial<Record<PactFlowPhase, PactFlowPhase>>> = {
  backlog: 'discussion',
  discussion: 'confirmed',
  confirmed: 'design',
  design: 'planning',
  planning: 'executing',
  executing: 'code_review',
  code_review: 'verification',
  verification: 'closing',
  closing: 'deployed',
}
const REVIEW_GATE: Readonly<Partial<Record<PactFlowPhase, PactFlowReview['kind']>>> = {
  confirmed: 'requirement',
  planning: 'design',
  executing: 'plan',
  closing: 'verification',
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    pactflow: PactFlowService
    pactflowPresetRoot: string
  }
}

/** Process-global Host service for the PactFlow product domain. */
export class PactFlowService extends TypertRemoteService {
  static inject = ['sessions', 'sessionProjections']
  static Config = z.object({
    k3s: z.union([z.const(false), z.object({
      namespace: z.string().default('pactflow'),
      kubeconfig: z.string(),
      context: z.string(),
      imagePullSecret: z.string().required(),
      pollIntervalMs: z.number().default(2_000),
      finishedJobTtlSeconds: z.number().default(86_400),
      templates: z.array(z.object({
        id: z.string().required(),
        harness: z.union(['claude', 'codex', 'opencode', 'dsh'] as const).required(),
        apiMode: z.union([
          'anthropic-messages', 'openai-responses', 'openai-chat-completions',
        ] as const).required(),
        image: z.string().required(),
        model: z.string().required(),
        baseUrl: z.string().required(),
        modelSecretName: z.string().required(),
        cpuRequest: z.string().required(),
        memoryRequest: z.string().required(),
        cpuLimit: z.string().required(),
        memoryLimit: z.string().required(),
      })).default([]),
    })]).default(false),
    infrastructure: z.union([z.const(false), z.object({
      clusters: z.array(z.object({
        id: z.string().required(), displayName: z.string().required(), namespace: z.string().required(),
        kubeconfig: z.string(), context: z.string(), pollIntervalMs: z.number().default(2_000),
        finishedJobTtlSeconds: z.number().default(86_400),
      })).default([]),
      registries: z.array(z.object({
        id: z.string().required(), displayName: z.string().required(), kind: z.const('harbor').required(),
        endpoint: z.string().required(), project: z.string(), harnessRepository: z.string().default('pactflow-worker'),
        tlsVerify: z.boolean().default(true),
        imagePullSecret: z.string(), username: z.string(),
        usernameCredentialRef: z.string(), passwordCredentialRef: z.string(),
      })).default([]),
      gitProviders: z.array(z.object({
        id: z.string().required(), displayName: z.string().required(), kind: z.const('gitea').required(),
        baseUrl: z.string().required(), tokenCredentialRef: z.string().required(), username: z.string(),
      })).default([]),
      templates: z.array(z.union([z.object({
        id: z.string().required(),
        harness: z.union(['claude', 'codex', 'opencode', 'dsh'] as const).required(),
        apiMode: z.union([
          'anthropic-messages', 'openai-responses', 'openai-chat-completions',
        ] as const).required(),
        image: z.string().required(), model: z.string().required(), baseUrl: z.string().required(),
        modelSecretName: z.string().required(), cpuRequest: z.string().required(),
        memoryRequest: z.string().required(), cpuLimit: z.string().required(), memoryLimit: z.string().required(),
      }), z.object({
        id: z.string().required(), displayName: z.string().required(),
        harness: z.union(['claude', 'codex', 'opencode', 'dsh'] as const).required(),
        registryId: z.string().required(), repository: z.string().required(), artifactDigest: z.string().required(),
        cpuRequest: z.string().required(), memoryRequest: z.string().required(),
        cpuLimit: z.string().required(), memoryLimit: z.string().required(),
      })])).default([]),
      modelConnections: z.array(z.object({
        id: z.string().required(), displayName: z.string().required(),
        apiMode: z.union([
          'anthropic-messages', 'openai-responses', 'openai-chat-completions',
        ] as const).required(),
        model: z.string().required(), baseUrl: z.string().required(), apiKeyCredentialRef: z.string().required(),
      })).default([]),
      workerPools: z.array(z.object({
        id: z.string().required(), displayName: z.string().required(), clusterId: z.string().required(),
        registryId: z.string().required(), templateIds: z.array(z.string()).default([]),
        maxConcurrency: z.number().default(1), queuePolicy: z.const('fifo').default('fifo'),
        imagePullSecret: z.string(),
      })).default([]),
    })]).default(false),
  })

  private readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>
  private readonly git = new PactFlowGitWorkspace()
  private readonly gitea = new PactFlowGiteaClient()
  private k3s: PactFlowK3sWorker | undefined
  private infrastructure: PactFlowInfrastructure | undefined
  private readonly k3sByPool = new Map<string, PactFlowK3sWorker>()
  private readonly reconcilingK3s = new Set<string>()
  private readonly localExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly infrastructureHealth = new PactFlowInfrastructureHealthStore()
  private readonly workspaceProjects = new PactFlowWorkspaceProjectStore()
  private readonly projectCapacity = new PactFlowProjectCapacity()
  private readonly executionCapacity = new PactFlowExecutionCapacity(this.projectCapacity)

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pactflow')
    this.k3s = config.k3s === undefined || config.k3s === false
      ? undefined
      : new PactFlowK3sWorker(config.k3s)
    this.infrastructure = this.infrastructureFrom(config.infrastructure)
    this.rebuildPoolWorkers()
    ctx.inject(['settings'], (settingsCtx) => {
      const scope = settingsCtx.settings.register(
        PACTFLOW_SETTINGS_NS,
        PactFlowService.Config as unknown as z<Config>,
        {
          base: config,
          applies: 'restart',
          validate: value => {
            void this.k3sFrom(value.k3s)
            void this.infrastructureFrom(value.infrastructure)
            if (value.k3s !== false && value.infrastructure !== false) {
              throw new Error('PactFlow legacy k3s and infrastructure settings cannot both be enabled')
            }
          },
        },
      )
      this.k3s = this.k3sFrom(scope.get().k3s)
      this.infrastructure = this.infrastructureFrom(scope.get().infrastructure)
      this.rebuildPoolWorkers()
      scope.watch(() => {
        settingsCtx.logger.info('PactFlow settings changed; restart the Profile to apply infrastructure resources')
      })
    })
    ctx.on('agent/created', ({ agent }) => {
      void this.reconcileSessionRuns(agent.session).catch((error: unknown) => {
        ctx.logger.warn('PactFlow Run recovery failed for session "%s": %s', agent.id, this.boundedOutcome(error))
      })
    })
    ctx.effect(() => () => {
      for (const timer of this.localExpiryTimers.values()) clearTimeout(timer)
      this.localExpiryTimers.clear()
    }, 'dsh-pactflow: clear local Run expiry timers')
    ctx.effect(() => () => this.executionCapacity.dispose(), 'dsh-pactflow: dispose Worker admission scheduler')
    ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: '0.1.0',
      eventTypes: PACTFLOW_EVENT_TYPES_V0_1,
      mode: 'read-only',
    })
    ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: '0.2.0',
      eventTypes: PACTFLOW_EVENT_TYPES_V0_2,
      mode: 'read-only',
    })
    ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: '0.2.1',
      eventTypes: PACTFLOW_EVENT_TYPES_V0_2_1,
      mode: 'read-only',
    })
    this.events = ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: EVENT_PRODUCER_VERSION,
      eventTypes: PACTFLOW_EVENT_TYPES_V0_3,
    })
    for (const projection of PACTFLOW_PROJECTIONS) ctx.sessionProjections.register(projection as never)
    ctx.provide('pactflowPresetRoot', PRESET_ROOT)
  }

  /**
   * Prove Host activation, package-root resolution, Typert transport, and P0 registration.
   * @returns non-secret installation health.
   */
  @Remote('health')
  health(): PactFlowHealth {
    return {
      plugin: 'dsh-pactflow',
      version: VERSION,
      mode: 'pactflow',
      presetRoot: PRESET_ROOT,
      externalEventTypes: this.events.declaration.eventTypes,
    }
  }

  /**
   * Initialize the one project owned by a PactFlow Session.
   * @param sessionId - exact live Session identity.
   * @param request - human project name.
   * @returns the durable project snapshot.
   */
  @Remote('initialize')
  initialize(sessionId: string, request: InitializePactFlowProjectRequest): PactFlowProject {
    const session = this.livePactFlowSession(sessionId)
    const current = this.ctx.sessionProjections.stateOf(session, 'pactflowProject')
    if (current?.project !== null && current?.project !== undefined) {
      throw new Error(`session "${session.id}" already owns a PactFlow project`)
    }
    const name = request.name.trim()
    if (name.length === 0) throw new Error('PactFlow project name must be non-empty')
    const now = Date.now()
    const project: PactFlowProject = {
      id: PactFlowProjectId(session.id),
      name,
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    this.events.append(session, 'pactflow/project-initialized', { v: 1, project })
    return project
  }

  /**
   * Read the current project projection without folding raw events in the caller.
   * @param sessionId - exact live Session identity.
   * @returns current project view.
   */
  @Remote('project')
  project(sessionId: string): PactFlowProjectProjection {
    const session = this.liveSession(sessionId)
    return this.ctx.sessionProjections.stateOf(session, 'pactflowProject') ?? { project: null }
  }

  /** Validate the Session workspace and bind its credential-free Git identity. */
  @Remote('bindGit')
  async bindGit(sessionId: string, request: BindPactFlowGitRequest): Promise<PactFlowProject> {
    const session = this.livePactFlowSession(sessionId)
    const current = this.requireProject(session)
    this.requireRevision('project', current.id, current.revision, request.expectedRevision)
    const validation = await this.resolveValidationSelection(session, request)
    let inspected = await this.git.inspectBinding(session.header.cwd, {
      ...request,
      ...(validation === undefined ? {} : { validationCommands: validation.commands }),
    })
    if (validation !== undefined) {
      inspected = {
        ...inspected,
        validationProfileIds: validation.ids,
        validationProfileRevisions: validation.revisions,
      }
    }
    if (inspected.gitea === undefined && this.infrastructure !== undefined) {
      const matched = this.infrastructure.matchGitea(inspected.remoteUrl)
      if (matched !== undefined) {
        inspected = {
          ...inspected,
          gitea: {
            baseUrl: matched.provider.baseUrl,
            owner: matched.owner,
            repo: matched.repo,
            tokenCredentialRef: matched.provider.tokenCredentialRef,
            ...matched.provider.username === undefined ? {} : { username: matched.provider.username },
          },
        }
      }
    }
    if (inspected.auth !== undefined) {
      const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
      if (credentials === undefined) throw new Error('PactFlow Git authentication requires the Credentials service')
      const info = await credentials.describe(credentialRef(inspected.auth.credentialRef))
      if (!info.configured) throw new Error('PactFlow Git credential reference is not configured')
    }
    if (inspected.gitea !== undefined) {
      const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
      if (credentials === undefined) throw new Error('PactFlow Gitea requires the Credentials service')
      const info = await credentials.describe(credentialRef(inspected.gitea.tokenCredentialRef))
      if (!info.configured) throw new Error('PactFlow Gitea token credential reference is not configured')
    }
    const workerPoolId = request.workerPoolId?.trim()
    if (workerPoolId !== undefined) {
      if (workerPoolId === '') throw new Error('PactFlow Worker Pool id must be non-empty')
      this.infrastructure?.resolve(workerPoolId, this.infrastructure.settings.workerPools
        .find(pool => pool.id === workerPoolId)?.templateIds[0] ?? '')
      if (this.infrastructure === undefined) throw new Error('PactFlow Worker Pool requires infrastructure settings')
    }
    const latest = this.requireProject(session)
    this.requireRevision('project', latest.id, latest.revision, request.expectedRevision)
    const now = Date.now()
    const project: PactFlowProject = {
      ...latest,
      git: { ...inspected, revision: (latest.git?.revision ?? 0) + 1, boundAt: now },
      ...workerPoolId === undefined ? {} : { workerPoolId },
      revision: latest.revision + 1,
      updatedAt: now,
    }
    this.events.append(session, 'pactflow/project-configured', { v: 1, project })
    return project
  }

  /** Verify the bound Gitea repository and default-branch protection without writing. */
  @Remote('verifyGitea')
  async verifyGitea(sessionId: string): Promise<PactFlowGiteaStatus> {
    const session = this.livePactFlowSession(sessionId)
    const git = this.requireProject(session).git
    if (git?.gitea === undefined) throw new Error('PactFlow project has no Gitea binding')
    const giteaBinding = this.effectiveGiteaBinding(git.gitea)
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) throw new Error('PactFlow Gitea requires the Credentials service')
    const token = await credentials.resolve(credentialRef(giteaBinding.tokenCredentialRef))
    if (token === undefined) throw new Error('PactFlow Gitea token credential reference is not configured')
    return await this.gitea.verify(giteaBinding, token.value, git.defaultBranch)
  }

  /** Merge verified task branches through a protected Gitea PR and deploy the Need state. */
  @Remote('closeGitNeed')
  async closeGitNeed(
    sessionId: string,
    request: ClosePactFlowNeedRequest,
  ): Promise<ClosePactFlowNeedResult> {
    const session = this.livePactFlowSession(sessionId)
    const project = this.requireProject(session)
    const binding = project.git
    if (binding?.gitea === undefined) throw new Error('PactFlow project has no Gitea binding')
    await this.assertValidationProfilesCurrent(session, binding)
    const giteaBinding = this.effectiveGiteaBinding(binding.gitea)
    const need = this.need(session, request.needId)
    this.requireRevision('need', need.id, need.revision, request.expectedRevision)
    if (need.phase !== 'closing' || !this.latestReviewApproved(session, need.id, 'verification', need.revision - 1)) {
      throw new Error('PactFlow closing requires the closing phase and latest verification approval')
    }
    const nodes = Object.values(this.dagState(session)).filter(node => node.needId === need.id)
    if (nodes.length === 0 || nodes.some(node => node.state !== 'succeeded')) {
      throw new Error('PactFlow closing requires every Need node to be succeeded')
    }
    const runs = Object.values(this.runState(session))
    const taskRuns = nodes.map((node) => {
      const run = runs.filter(candidate => candidate.nodeId === node.id
        && candidate.state === 'succeeded' && candidate.git !== undefined && candidate.gitResult !== undefined)
        .sort((left, right) => right.attempt - left.attempt)[0]
      if (run?.git === undefined || run.gitResult === undefined) {
        throw new Error(`PactFlow node "${node.id}" has no verified Git result`)
      }
      return run
    })
    if (this.isLegacyValidationBinding(binding) || taskRuns.some(run => this.isLegacyValidationBinding(run.git!))) {
      throw new Error('PactFlow closing refuses legacy-untrusted validation commands; bind Workspace validation profiles first')
    }
    const expectedTaskRefs = taskRuns.map(run => ({
      remoteRef: run.gitResult!.remoteRef,
      expectedCommit: run.gitResult!.commit,
    })).sort((left, right) => left.remoteRef.localeCompare(right.remoteRef))
    if (request.taskRefs !== undefined) {
      const supplied = [...request.taskRefs].sort((left, right) => left.remoteRef.localeCompare(right.remoteRef))
      if (JSON.stringify(supplied) !== JSON.stringify(expectedTaskRefs)) {
        throw new Error('PactFlow closing task refs do not match the verified Run commits')
      }
    }
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) throw new Error('PactFlow Gitea requires the Credentials service')
    const giteaToken = await credentials.resolve(credentialRef(giteaBinding.tokenCredentialRef))
    if (giteaToken === undefined) throw new Error('PactFlow Gitea token credential reference is not configured')
    const status = await this.gitea.verify(giteaBinding, giteaToken.value, binding.defaultBranch)
    if (!status.branchProtected || status.archived) {
      throw new Error('PactFlow closing requires an active protected Gitea default branch')
    }
    if (status.requiredApprovals > 0 || status.statusChecks.length > 0) {
      throw new Error('PactFlow closing cannot auto-merge while Gitea approvals or status checks are required')
    }
    const gitSecret = await this.resolveGitAuth(taskRuns[0]!.git!)
    const integration = await this.git.prepareClosing(
      session.header.cwd,
      session.id,
      need.id,
      need.revision,
      binding,
      expectedTaskRefs,
      gitSecret,
    )
    const existingPullRequest = await this.gitea.findPullRequest(
      giteaBinding, giteaToken.value, integration.branch, binding.defaultBranch,
    )
    const pullRequest = existingPullRequest ?? await this.gitea.createPullRequest(
      giteaBinding,
      giteaToken.value,
      {
        title: `PactFlow: ${need.title}`,
        body: `Need ${need.id}\n\nVerified task branches: ${taskRuns.length}`,
        head: integration.branch,
        base: binding.defaultBranch,
      },
    )
    const merged = pullRequest.merged
      ? pullRequest
      : await this.gitea.mergePullRequest(
        giteaBinding, giteaToken.value, pullRequest.number, integration.commit,
      )
    if (!merged.merged || merged.mergeCommit === undefined) {
      throw new Error('PactFlow Gitea PR did not report a merged commit')
    }
    const defaultCommit = await this.git.verifyClosingMerged(
      session.header.cwd, binding, integration.commit, gitSecret,
    )
    const release: PactFlowRelease = {
      needId: need.id,
      commit: defaultCommit,
      branch: binding.defaultBranch,
      serviceUrl: merged.htmlUrl,
      recordedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/release-recorded', { v: 1, release })
    const deployed = this.transitionNeed(session.id, {
      needId: need.id,
      expectedRevision: need.revision,
      to: 'deployed',
    })
    const cleanupRecords: PactFlowCleanupRecord[] = [
      { id: `cleanup-${need.id}-closing`, needId: need.id, target: `closing:${integration.branch}`, state: 'pending', attempt: 1 },
      ...taskRuns.flatMap(run => [
        { id: `cleanup-${run.id}-k3s`, needId: need.id, runId: run.id, target: `k3s:${run.k3s?.jobName ?? run.id}`, state: 'pending' as const, attempt: 1 },
        { id: `cleanup-${run.id}-git`, needId: need.id, runId: run.id, target: `git:${run.git!.branch}`, state: 'pending' as const, attempt: 1 },
      ]),
    ]
    const existingCleanups = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {}
    for (const record of cleanupRecords) {
      if (existingCleanups[record.id] === undefined) this.appendCleanupRecord(session, record)
    }
    const cleanupFailures: string[] = []
    const closingRecord = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[cleanupRecords[0]!.id]
      ?? cleanupRecords[0]!
    if (!await this.continueCleanupRecord(session, closingRecord, async () => {
      await this.git.cleanupClosing(session.header.cwd, integration)
    })) cleanupFailures.push(`closing:${integration.branch}`)
    for (const run of taskRuns) {
      const k3sRecord = cleanupRecords.find(record => record.runId === run.id && record.target.startsWith('k3s'))
      if (run.k3s !== undefined && k3sRecord !== undefined && (this.k3s !== undefined || this.infrastructure !== undefined)) {
        const persistedK3sRecord = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[k3sRecord.id] ?? k3sRecord
        if (!await this.continueCleanupRecord(session, persistedK3sRecord, async () => {
          await this.workerForRun(run.k3s!).cleanupRun(run.k3s!)
        })) cleanupFailures.push(`k3s:${run.k3s.jobName}`)
      } else if (k3sRecord !== undefined) {
        this.appendCleanupRecord(session, {
          ...k3sRecord, state: 'succeeded', attempt: k3sRecord.attempt,
        })
      }
      const gitRecord = cleanupRecords.find(record => record.runId === run.id && record.target.startsWith('git'))
      const persistedGitRecord = gitRecord === undefined ? undefined
        : this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[gitRecord.id] ?? gitRecord
      if (persistedGitRecord !== undefined && !await this.continueCleanupRecord(session, persistedGitRecord, async () => {
        await this.git.cleanupTaskRun(
          session.header.cwd, binding, run.git!, await this.resolveGitAuth(run.git!),
        )
      })) cleanupFailures.push(`git:${run.git!.branch}`)
    }
    return {
      need: deployed,
      release,
      pullRequestNumber: merged.number,
      pullRequestUrl: merged.htmlUrl,
      integrationBranch: integration.branch,
      integrationCommit: integration.commit,
      cleanupFailures,
    }
  }

  private appendCleanupRecord(session: Session, record: PactFlowCleanupRecord): void {
    this.events.append(session, 'pactflow/cleanup-recorded', { v: 1, record })
  }

  private async acquireExecutionOrCancel(
    session: Session,
    queueId: string,
    workspaceId: string | undefined,
    policy: PactFlowWorkspaceProjectConfig['worker'],
    profileId: string | undefined,
    poolId: string | undefined,
    signal?: AbortSignal,
  ): Promise<() => void> {
    try {
      return await this.executionCapacity.acquire({
        workspaceId, policy, profileId, poolId,
        resolveInfrastructure: () => this.infrastructure,
        signal,
      })
    } catch (error) {
      this.events.append(session, 'pactflow/run-queue-cancelled', {
        v: 1, queueId, reason: this.boundedOutcome(error), cancelledAt: Date.now(),
      })
      throw error
    }
  }

  private async runCleanupRecord(
    session: Session,
    record: PactFlowCleanupRecord,
    action: () => Promise<void>,
  ): Promise<boolean> {
    try {
      await action()
      const { error: previousError, nextRetryAt: previousRetryAt, ...identity } = record
      void previousError
      void previousRetryAt
      this.appendCleanupRecord(session, {
        ...identity, state: 'succeeded', attempt: record.attempt,
      })
      return true
    } catch (error) {
      const nextRetryAt = Date.now() + Math.min(3_600_000, 1_000 * (2 ** Math.min(record.attempt - 1, 10)))
      this.appendCleanupRecord(session, {
        ...record, state: 'failed', error: this.boundedOutcome(error), nextRetryAt,
      })
      this.ctx.logger.warn('PactFlow cleanup target "%s" failed: %s', record.target, this.boundedOutcome(error))
      return false
    }
  }

  private async continueCleanupRecord(
    session: Session,
    record: PactFlowCleanupRecord,
    action: () => Promise<void>,
  ): Promise<boolean> {
    if (record.state === 'succeeded') return true
    if (record.state === 'failed') {
      const retried = await this.retryCleanup(session.id, { cleanupId: record.id })
      return retried.state === 'succeeded'
    }
    return await this.runCleanupRecord(session, record, action)
  }

  private async ensureK3sCleanup(
    session: Session,
    run: PactFlowRun,
  ): Promise<void> {
    if (run.k3s === undefined) return
    const id = `cleanup-${run.id}-k3s`
    const current = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[id]
    const pending = current ?? {
      id, runId: run.id, needId: this.node(session, run.nodeId).needId,
      target: `k3s:${run.k3s.jobName}`, state: 'pending' as const, attempt: 1,
    }
    if (current === undefined) this.appendCleanupRecord(session, pending)
    if (pending.state === 'failed') {
      await this.retryCleanup(session.id, { cleanupId: pending.id })
    } else if (pending.state !== 'succeeded') await this.runCleanupRecord(session, pending, async () => {
      await this.workerForRun(run.k3s!).cleanupRun(run.k3s!)
    })
  }

  /** Explicitly retry one persisted cleanup responsibility after a failed close. */
  @Remote('retryCleanup')
  async retryCleanup(
    sessionId: string,
    request: RetryPactFlowCleanupRequest,
  ): Promise<PactFlowCleanupRecord> {
    const session = this.livePactFlowSession(sessionId)
    const current = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[request.cleanupId]
    if (current === undefined) throw new Error(`PactFlow cleanup "${request.cleanupId}" does not exist`)
    if (current.state === 'succeeded') return current
    const attempt = current.attempt + 1
    const { error: previousError, nextRetryAt: previousRetryAt, ...identity } = current
    void previousError
    void previousRetryAt
    const pending: PactFlowCleanupRecord = {
      ...identity, state: 'pending', attempt,
    }
    this.appendCleanupRecord(session, pending)
    await this.runCleanupRecord(session, pending, () => this.cleanupAction(session, pending))
    return this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[pending.id] ?? pending
  }

  private async cleanupAction(session: Session, record: PactFlowCleanupRecord): Promise<void> {
    const project = this.requireProject(session)
    const workspaceProject = await this.workspaceProjectForSession(session)
    const binding = project.git ?? this.workspaceGitBinding(workspaceProject)
    if (record.target === 'k3s' || record.target.startsWith('k3s:')) {
      const run = record.runId === undefined ? undefined : this.runState(session)[record.runId]
      if (run?.k3s === undefined) return
      await this.workerForRun(run.k3s).cleanupRun(run.k3s)
      return
    }
    if (record.target === 'git' || record.target.startsWith('git:')) {
      if (binding === undefined) throw new Error('PactFlow cleanup cannot resolve the project Git binding')
      const run = record.runId === undefined ? undefined : this.runState(session)[record.runId]
      if (run?.git === undefined) return
      await this.git.cleanupTaskRun(session.header.cwd, binding, run.git, await this.resolveGitAuth(run.git))
      return
    }
    if (record.target === 'closing' || record.target.startsWith('closing:')) {
      if (binding === undefined) throw new Error('PactFlow cleanup cannot resolve the project Git binding')
      if (record.needId === undefined) throw new Error('PactFlow closing cleanup has no Need id')
      const need = this.need(session, record.needId)
      const nodes = Object.values(this.dagState(session)).filter(node => node.needId === need.id)
      const runs = Object.values(this.runState(session))
      const taskRuns = nodes.map(node => runs.filter(run => run.nodeId === node.id
        && run.state === 'succeeded' && run.git !== undefined && run.gitResult !== undefined)
        .sort((left, right) => right.attempt - left.attempt)[0]).filter((run): run is PactFlowRun => run !== undefined)
      if (taskRuns.length !== nodes.length) throw new Error('PactFlow closing cleanup cannot reconstruct verified task runs')
      const integration = await this.git.prepareClosing(
        session.header.cwd, session.id, need.id, Math.max(1, need.revision - 1), binding,
        taskRuns.map(run => ({ remoteRef: run.gitResult!.remoteRef, expectedCommit: run.gitResult!.commit })),
        await this.resolveGitAuth(taskRuns[0]!.git!),
      )
      await this.git.cleanupClosing(session.header.cwd, integration)
      return
    }
    throw new Error(`PactFlow cleanup target "${record.target}" is unknown`)
  }

  private async reconcileCleanups(session: Session): Promise<void> {
    const cleanups = Object.values(this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {})
    for (const record of cleanups) {
      if (record.state === 'succeeded' || (record.nextRetryAt !== undefined && record.nextRetryAt > Date.now())) continue
      const current = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[record.id]
      if (current === undefined || current.state === 'succeeded') continue
      try { await this.retryCleanup(session.id, { cleanupId: current.id }) } catch (error) {
        this.ctx.logger.warn('PactFlow cleanup recovery failed for "%s": %s', current.id, this.boundedOutcome(error))
      }
    }
  }

  /** Create one backlog need under an initialized project. */
  @Remote('createNeed')
  createNeed(sessionId: string, request: CreatePactFlowNeedRequest): PactFlowNeed {
    const session = this.livePactFlowSession(sessionId)
    this.requireProject(session)
    const id = PactFlowNeedId(request.id)
    const needs = this.ctx.sessionProjections.stateOf(session, 'pactflowNeeds')?.byId ?? {}
    if (needs[id] !== undefined) throw new Error(`PactFlow need "${id}" already exists`)
    const title = request.title.trim()
    if (title.length === 0) throw new Error('PactFlow need title must be non-empty')
    const now = Date.now()
    const need: PactFlowNeed = {
      id,
      title,
      description: request.description.trim(),
      phase: 'backlog',
      revision: 1,
      createdAt: now,
      updatedAt: now,
    }
    this.events.append(session, 'pactflow/need-created', { v: 1, need })
    return need
  }

  /** Record one already-authorized human review decision used by a later phase gate. */
  recordReview(sessionId: string, request: RecordPactFlowReviewRequest): PactFlowReview {
    const session = this.livePactFlowSession(sessionId)
    const need = this.need(session, request.needId)
    const note = request.note.trim()
    if (note.length === 0) throw new Error('PactFlow review note must be non-empty')
    if (new TextEncoder().encode(note).length > 8_192 || /(?:api[_-]?key|token|password|secret)\s*[:=]\s*\S+/i.test(note)) {
      throw new Error('PactFlow review note contains a credential-like value or is too large')
    }
    if (request.source !== 'dsh-approval') throw new Error('PactFlow review requires DSH Approval authorization')
    if (!Number.isSafeInteger(request.needRevision) || request.needRevision !== need.revision) {
      throw new Error(`PactFlow review targets stale Need revision: expected ${String(need.revision)}, got ${String(request.needRevision)}`)
    }
    const expectedDigest = pactFlowReviewEvidenceDigest(
      session.id, need.id, need.revision, request.kind, request.decision, note,
    )
    if (!/^[0-9a-f]{64}$/.test(request.evidenceDigest) || request.evidenceDigest !== expectedDigest) {
      throw new Error('PactFlow review evidence digest does not match the requested decision')
    }
    const askedIndex = session.events.findIndex(event => event.type === 'approval/asked'
      && String(event.data.id) === request.approvalRequestId
      && event.data.toolName === 'pactflow_record_review'
      && event.data.reason?.includes(request.evidenceDigest))
    const decidedIndex = session.events.findIndex(event => event.type === 'approval/decided'
      && String(event.data.id) === request.approvalRequestId
      && event.data.outcome === 'allowed-once')
    if (askedIndex < 0 || decidedIndex <= askedIndex) {
      throw new Error('PactFlow review approval audit pair is missing or not allowed')
    }
    const priorReviews = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.reviews ?? {}
    if (Object.values(priorReviews).some(review => review.approvalRequestId === request.approvalRequestId)) {
      throw new Error('PactFlow review approval has already been consumed')
    }
    const review: PactFlowReview = {
      id: `review-${randomUUID()}` as PactFlowReview['id'],
      needId: need.id,
      kind: request.kind,
      decision: request.decision,
      note,
      recordedAt: Date.now(),
      approvalRequestId: request.approvalRequestId,
      needRevision: request.needRevision,
      evidenceDigest: request.evidenceDigest,
      source: request.source,
    }
    this.events.append(session, 'pactflow/review-recorded', { v: 1, review })
    return review
  }

  /** Move a need through exactly one legal phase after CAS and review checks. */
  @Remote('transitionNeed')
  transitionNeed(sessionId: string, request: TransitionPactFlowNeedRequest): PactFlowNeed {
    const session = this.livePactFlowSession(sessionId)
    const current = this.need(session, request.needId)
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 1) {
      throw new Error('expectedRevision must be a positive safe integer')
    }
    if (current.revision !== request.expectedRevision) {
      throw new Error(`PactFlow need "${current.id}" revision conflict: expected ${String(request.expectedRevision)}, current ${String(current.revision)}`)
    }
    const expectedNext = NEXT_PHASE[current.phase]
    if (expectedNext !== request.to) {
      throw new Error(`illegal PactFlow phase transition ${current.phase} -> ${request.to}; expected ${expectedNext ?? 'terminal'}`)
    }
    const gate = REVIEW_GATE[request.to]
    if (gate !== undefined && !this.latestReviewApproved(session, current.id, gate)) {
      throw new Error(`PactFlow transition to ${request.to} requires latest ${gate} review approval`)
    }
    const next: PactFlowNeed = {
      ...current,
      phase: request.to,
      revision: current.revision + 1,
      updatedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/phase-transitioned', { v: 1, need: next, from: current.phase })
    return next
  }

  /** Create one DAG node after validating same-need dependencies. */
  @Remote('createNode')
  createNode(sessionId: string, request: CreatePactFlowNodeRequest): PactFlowNode {
    const session = this.livePactFlowSession(sessionId)
    const need = this.need(session, request.needId)
    const id = PactFlowNodeId(request.id)
    const title = request.title.trim()
    if (title.length === 0) throw new Error('PactFlow node title must be non-empty')
    const dag = this.dagState(session)
    if (dag[id] !== undefined) throw new Error(`PactFlow node "${id}" already exists`)
    const dependencies = this.dependencies(dag, need.id, id, request.dependencies)
    const node: PactFlowNode = {
      id,
      needId: need.id,
      title,
      state: this.dependenciesSucceeded(dag, dependencies) ? 'ready' : 'pending',
      revision: 1,
      dependencies,
      updatedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/node-created', { v: 1, node })
    return node
  }

  /** Replace dependencies on an unclaimed node with cycle and revision checks. */
  @Remote('updateNodeDependencies')
  updateNodeDependencies(
    sessionId: string,
    request: UpdatePactFlowNodeDependenciesRequest,
  ): PactFlowNode {
    const session = this.livePactFlowSession(sessionId)
    const current = this.node(session, request.nodeId)
    this.requireRevision('node', current.id, current.revision, request.expectedRevision)
    if (current.state !== 'pending' && current.state !== 'ready') {
      throw new Error(`PactFlow node "${current.id}" dependencies cannot change from state ${current.state}`)
    }
    const dag = this.dagState(session)
    const dependencies = this.dependencies(dag, current.needId, current.id, request.dependencies)
    for (const dependency of dependencies) {
      if (this.reaches(dag, dependency, current.id, new Set())) {
        throw new Error(`PactFlow dependency ${dependency} -> ${current.id} would create a cycle`)
      }
    }
    const node: PactFlowNode = {
      ...current,
      dependencies,
      state: this.dependenciesSucceeded(dag, dependencies) ? 'ready' : 'pending',
      revision: current.revision + 1,
      updatedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/node-updated', { v: 1, node })
    return node
  }

  /** Restore one terminally failed node to ready without erasing its immutable Run history. */
  @Remote('retryNode')
  retryNode(sessionId: string, request: RetryPactFlowNodeRequest): PactFlowNode {
    const session = this.livePactFlowSession(sessionId)
    this.reconcileLocalSession(session)
    const current = this.node(session, request.nodeId)
    this.requireRevision('node', current.id, current.revision, request.expectedRevision)
    const active = Object.values(this.runState(session)).find(run => run.nodeId === current.id && !this.isTerminalRun(run))
    if (active !== undefined) {
      throw new Error(`PactFlow node "${current.id}" still owns an active Run "${active.id}"`)
    }
    if (current.state !== 'failed' && current.state !== 'cancelled') {
      throw new Error(`PactFlow node "${current.id}" cannot retry from state ${current.state}`)
    }
    const node: PactFlowNode = {
      ...current,
      state: this.dependenciesSucceeded(this.dagState(session), current.dependencies) ? 'ready' : 'pending',
      revision: current.revision + 1,
      updatedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/node-updated', { v: 1, node })
    return node
  }

  /** Claim one ready node and create its immutable-attempt Run in one event. */
  @Remote('claimNode')
  claimNode(sessionId: string, request: ClaimPactFlowNodeRequest): PactFlowClaimResult {
    const session = this.livePactFlowSession(sessionId)
    return this.claimNodeInSession(session, request)
  }

  /** Claim after every provider-specific preflight has completed. */
  private claimNodeInSession(
    session: Session,
    request: ClaimPactFlowNodeRequest,
    options: {
      readonly runId?: PactFlowRun['id']
      readonly git?: PactFlowGitRunSpec
      readonly k3s?: PactFlowK3sRunSpec
    } = {},
  ): PactFlowClaimResult {
    const current = this.node(session, request.nodeId)
    this.requireRevision('node', current.id, current.revision, request.expectedRevision)
    if (current.state !== 'ready') throw new Error(`PactFlow node "${current.id}" is not ready`)
    const provider = request.provider.trim()
    if (provider.length === 0) throw new Error('PactFlow Run provider must be non-empty')
    const duration = this.leaseDuration(request.leaseDurationMs)
    const now = Date.now()
    const node: PactFlowNode = {
      ...current,
      state: 'claimed',
      revision: current.revision + 1,
      updatedAt: now,
    }
    const prior = Object.values(this.runState(session)).filter(run => run.nodeId === node.id)
    const run: PactFlowRun = {
      id: options.runId ?? PactFlowRunId(`run-${randomUUID()}`),
      nodeId: node.id,
      nodeRevision: node.revision,
      attempt: prior.reduce((maximum, candidate) => Math.max(maximum, candidate.attempt), 0) + 1,
      provider,
      claimId: `claim-${randomUUID()}`,
      state: 'claimed',
      leaseDeadline: now + duration,
      leaseDurationMs: duration,
      updatedAt: now,
      ...options.git === undefined ? {} : { git: options.git },
      ...options.k3s === undefined ? {} : { k3s: options.k3s },
    }
    this.events.append(session, 'pactflow/run-claimed', { v: 1, run, node })
    return { node, run }
  }

  /** Bind the API-created Job UID to the already claimed Run before accepting any result. */
  private bindK3sRunInSession(
    session: Session,
    owned: PactFlowClaimResult,
    jobUid: string,
  ): PactFlowClaimResult {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(jobUid)) throw new Error('PactFlow K3s Job UID is invalid')
    const currentRun = this.run(session, owned.run.id)
    this.requireClaim(currentRun, owned.run.claimId)
    if (currentRun.k3s === undefined) throw new Error(`PactFlow Run "${currentRun.id}" has no K3s spec`)
    if (currentRun.k3s.runNonceHash === undefined || currentRun.k3s.claimTokenHash === undefined
      || currentRun.k3s.specDigest === undefined) {
      throw new Error(`PactFlow Run "${currentRun.id}" has no secure K3s binding fields`)
    }
    if (currentRun.k3s.jobUid !== undefined && currentRun.k3s.jobUid !== jobUid) {
      throw new Error(`PactFlow Run "${currentRun.id}" is already bound to another K3s Job`)
    }
    const currentNode = this.node(session, currentRun.nodeId)
    if (currentNode.revision !== currentRun.nodeRevision) {
      throw new Error(`PactFlow Run "${currentRun.id}" owns stale node revision`)
    }
    if (currentRun.k3s.jobUid === jobUid) return { node: currentNode, run: currentRun }
    const run: PactFlowRun = {
      ...currentRun,
      k3s: { ...currentRun.k3s, jobUid },
      updatedAt: Date.now(),
    }
    this.events.append(session, 'pactflow/run-bound', { v: 1, run, node: currentNode })
    return { node: currentNode, run }
  }

  /** Renew a live Run lease; the first renewal also moves its node to running. */
  @Remote('renewRun')
  renewRun(sessionId: string, request: RenewPactFlowRunRequest): PactFlowClaimResult {
    const session = this.livePactFlowSession(sessionId)
    const currentRun = this.run(session, request.runId)
    this.requireClaim(currentRun, request.claimId)
    if (this.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" is already terminal`)
    const now = Date.now()
    if (now >= currentRun.leaseDeadline) throw new Error(`PactFlow Run "${currentRun.id}" lease has expired`)
    const currentNode = this.node(session, currentRun.nodeId)
    if (currentNode.revision !== currentRun.nodeRevision) {
      throw new Error(`PactFlow Run "${currentRun.id}" owns stale node revision ${String(currentRun.nodeRevision)}`)
    }
    const node: PactFlowNode = currentNode.state === 'claimed'
      ? { ...currentNode, state: 'running', revision: currentNode.revision + 1, updatedAt: now }
      : currentNode
    if (node.state !== 'running' && node.state !== 'blocked') {
      throw new Error(`PactFlow Run "${currentRun.id}" cannot renew node state ${node.state}`)
    }
    const run: PactFlowRun = {
      ...currentRun,
      nodeRevision: node.revision,
      state: node.state,
      leaseDeadline: now + this.leaseDuration(request.leaseDurationMs),
      updatedAt: now,
    }
    this.events.append(session, 'pactflow/run-renewed', { v: 1, run, node })
    return { node, run }
  }

  /** Accept the first valid terminal result and ready newly unblocked dependents. */
  @Remote('settleRun')
  settleRun(sessionId: string, request: SettlePactFlowRunRequest): PactFlowClaimResult {
    const session = this.livePactFlowSession(sessionId)
    return this.settleRunInSession(session, request)
  }

  /** Settle one Run with optional Host-validated Git evidence. */
  private settleRunInSession(
    session: Session,
    request: SettlePactFlowRunRequest,
    gitResult?: PactFlowGitResult,
    k3sResult?: PactFlowK3sResult,
    resultAt?: number,
  ): PactFlowClaimResult {
    const currentRun = this.run(session, request.runId)
    this.requireClaim(currentRun, request.claimId)
    if (this.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" already has a terminal result`)
    const now = Date.now()
    const observedAt = resultAt ?? now
    if (!Number.isSafeInteger(observedAt) || observedAt < 0 || observedAt >= currentRun.leaseDeadline) {
      throw new Error(`PactFlow Run "${currentRun.id}" result arrived after lease expiry`)
    }
    const currentNode = this.node(session, currentRun.nodeId)
    this.requireRevision('node', currentNode.id, currentNode.revision, request.expectedNodeRevision)
    if (currentNode.revision !== currentRun.nodeRevision) {
      throw new Error(`PactFlow Run "${currentRun.id}" result targets stale node revision ${String(currentRun.nodeRevision)}`)
    }
    const node: PactFlowNode = {
      ...currentNode,
      state: request.state,
      revision: currentNode.revision + 1,
      updatedAt: now,
    }
    const run: PactFlowRun = {
      ...currentRun,
      state: request.state,
      updatedAt: now,
      outcome: request.outcome,
      ...gitResult === undefined ? {} : { gitResult },
      ...k3sResult === undefined ? {} : { k3sResult },
    }
    this.events.append(session, 'pactflow/run-settled', { v: 1, run, node })
    if (request.state === 'succeeded') this.readyDependents(session, node.needId)
    return { node, run }
  }

  /** Read the current DAG projection. */
  @Remote('dag')
  dag(sessionId: string): PactFlowDagProjection {
    const session = this.livePactFlowSession(sessionId)
    return this.ctx.sessionProjections.stateOf(session, 'pactflowDag') ?? { byId: {} }
  }

  /** Read one consistent synchronous cut across all PactFlow projections. */
  @Remote('snapshot')
  async snapshot(sessionId: string): Promise<PactFlowSnapshot> {
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session !== undefined) {
      this.requirePactFlowPreset(session)
      this.reconcileLocalSession(session)
      return this.snapshotOfLive(session)
    }
    const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
    if (query === undefined) throw new Error('cold PactFlow snapshots require sessionQuery')
    const stored = await query.readSession(SessionId(sessionId))
    const restored = this.ctx.sessionProjections.restore({}, stored.events, 0, stored.session).snapshot
    if ((restored.values.agentPreset ?? stored.session.agentPreset) !== 'pactflow') {
      throw new Error(`session "${sessionId}" is not composed from the pactflow preset`)
    }
    const values = restored.values
    return {
      project: values.pactflowProject ?? { project: null },
      needs: values.pactflowNeeds ?? { byId: {} },
      dag: values.pactflowDag ?? { byId: {} },
      runs: values.pactflowRuns ?? { byId: {} },
      delivery: values.pactflowDelivery ?? { reviews: {}, documents: {}, releases: {}, cleanups: {} },
    }
  }

  /** Read one consistent synchronous cut from a live Session. */
  private snapshotOfLive(session: Session): PactFlowSnapshot {
    return {
      project: this.ctx.sessionProjections.stateOf(session, 'pactflowProject') ?? { project: null },
      needs: this.ctx.sessionProjections.stateOf(session, 'pactflowNeeds') ?? { byId: {} },
      dag: this.ctx.sessionProjections.stateOf(session, 'pactflowDag') ?? { byId: {} },
      runs: this.ctx.sessionProjections.stateOf(session, 'pactflowRuns') ?? { byId: {} },
      delivery: this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')
        ?? { reviews: {}, documents: {}, releases: {}, cleanups: {} },
    }
  }

  /** Discover every live or persisted PactFlow root Session without a second registry. */
  @Remote('listProjects')
  async listProjects(): Promise<readonly PactFlowProjectRecord[]> {
    const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
    if (query === undefined) throw new Error('PactFlow project discovery requires sessionQuery')
    const records = await query.listSessions()
    const discovered = await Promise.all(records.map(async (record): Promise<PactFlowProjectRecord | undefined> => {
      const live = this.ctx.sessions.get(record.header.id)
      let project: PactFlowProject | null
      if (live !== undefined) {
        if (this.currentPreset(live) !== 'pactflow') return undefined
        project = this.ctx.sessionProjections.stateOf(live, 'pactflowProject')?.project ?? null
      } else {
        const stored = await query.readSession(record.header.id)
        const values = this.ctx.sessionProjections.restore({}, stored.events, 0, stored.session).snapshot.values
        if ((values.agentPreset ?? stored.session.agentPreset) !== 'pactflow') return undefined
        project = values.pactflowProject?.project ?? null
      }
      return {
        sessionId: record.header.id,
        live: record.live,
        persisted: record.persisted,
        project,
      }
    }))
    return discovered.filter((record): record is PactFlowProjectRecord => record !== undefined)
  }

  /** List every DSH Workspace with plugin-owned project configuration and live Git facts. */
  @Remote('listWorkspaceProjects')
  async listWorkspaceProjects(): Promise<readonly PactFlowWorkspaceProjectView[]> {
    const registry = this.requireWorkspaceRegistry()
    const configured = new Map((await this.workspaceProjects.list()).map(row => [row.workspaceId, row]))
    let sessionProjects: readonly PactFlowProjectRecord[] = []
    try { sessionProjects = await this.listProjects() } catch {}
    return await Promise.all(registry.list().map(async workspace => ({
      workspaceId: String(workspace.id), path: workspace.path, title: workspace.title,
      gitStatus: await inspectWorkspaceGit(workspace.path),
      ...(configured.get(String(workspace.id)) === undefined ? {} : { config: configured.get(String(workspace.id))! }),
      migrationCandidates: workspace.sessionIds.flatMap(sessionId => {
        const record = sessionProjects.find(candidate => candidate.sessionId === String(sessionId))
        return record?.project === null || record?.project === undefined ? [] : [{
          sessionId: String(sessionId), projectName: record.project.name, revision: record.project.revision,
        }]
      }),
    })))
  }

  /** Resolve the Workspace-level project configuration inherited by one live Session. */
  @Remote('workspaceProjectForSession')
  async workspaceProjectForSessionView(sessionId: string): Promise<PactFlowWorkspaceProjectConfig | null> {
    return await this.workspaceProjectForSession(this.liveSession(sessionId)) ?? null
  }

  /** List user-owned validation profiles without exposing any runtime credentials. */
  @Remote('listValidationProfiles')
  async listValidationProfiles(workspaceId: string): Promise<readonly PactFlowValidationProfile[]> {
    this.requireWorkspace(workspaceId)
    const config = await this.workspaceProjects.get(workspaceId)
    return config?.validationProfiles ?? []
  }

  /** Atomically replace the Workspace-owned validation profile catalog. */
  @Remote('saveValidationProfiles')
  async saveValidationProfiles(
    request: PactFlowSaveValidationProfilesRequest,
  ): Promise<PactFlowWorkspaceProjectConfig> {
    const workspace = this.requireWorkspace(request.workspaceId)
    const current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const profileInput = request.profiles ?? request.validationProfiles
    if (request.profiles !== undefined && request.validationProfiles !== undefined
      && JSON.stringify(request.profiles) !== JSON.stringify(request.validationProfiles)) {
      throw new Error('PactFlow validation profile payload was provided twice with different values')
    }
    const profiles = profileInput === undefined
      ? current?.validationProfiles ?? []
      : this.normalizeValidationProfiles(profileInput, current?.validationProfiles ?? [])
    if (request.selectedProfileIds !== undefined && request.validationProfileIds !== undefined
      && JSON.stringify(request.selectedProfileIds) !== JSON.stringify(request.validationProfileIds)) {
      throw new Error('PactFlow selected validation profiles were provided twice with different values')
    }
    const requestedSelectedProfileIds = request.selectedProfileIds ?? request.validationProfileIds
    const selectedProfileIds = requestedSelectedProfileIds === undefined
      ? current?.validationProfileIds
      : [...new Set(requestedSelectedProfileIds.map(value => value.trim()).filter(Boolean))]
    if (selectedProfileIds !== undefined && selectedProfileIds.some(id => !profiles.some(profile => profile.id === id))) {
      throw new Error('PactFlow Workspace selected validation profile is not in the saved catalog')
    }
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      ...(current?.git === undefined ? {} : { git: current.git }),
      ...(current?.worker === undefined ? {} : { worker: current.worker }),
      validationProfiles: profiles,
      ...(selectedProfileIds === undefined ? {} : { validationProfileIds: selectedProfileIds }),
      validationCommands: current?.validationCommands ?? [],
    }
    const written = await this.workspaceProjects.putIfRevision(request.expectedRevision, config)
    if (!written) throw new Error('PactFlow Workspace project revision changed while saving validation profiles')
    return config
  }

  /** Initialize a Workspace-local Git repository without staging or committing files. */
  @Remote('initializeWorkspaceGit')
  async initializeWorkspaceGitProject(
    request: PactFlowInitializeWorkspaceGitRequest,
  ): Promise<PactFlowWorkspaceProjectView> {
    if (request.confirm !== 'initialize-local-git') throw new Error('PactFlow local Git initialization requires confirmation')
    const workspace = this.requireWorkspace(request.workspaceId)
    if (workspace.path !== request.expectedPath) throw new Error('PactFlow Workspace path changed before Git initialization')
    await initializeWorkspaceGit(workspace.path)
    return await this.workspaceProjectView(workspace)
  }

  /** Adopt an existing origin remote into plugin-owned Workspace project configuration. */
  @Remote('adoptWorkspaceGit')
  async adoptWorkspaceGit(request: PactFlowAdoptWorkspaceGitRequest): Promise<PactFlowWorkspaceProjectConfig> {
    const workspace = this.requireWorkspace(request.workspaceId)
    const status = await inspectWorkspaceGit(workspace.path)
    if (!status.initialized || !status.hasCommit || status.remoteUrl === undefined) {
      throw new Error('PactFlow Workspace Git adoption requires a commit and origin remote')
    }
    const current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const matched = this.infrastructure?.matchGitea(status.remoteUrl)
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      git: {
        remote: 'origin', remoteUrl: status.remoteUrl, defaultBranch: status.branch ?? 'main', boundAt: now,
        ...(matched === undefined ? {} : {
          giteaProviderId: matched.provider.id, owner: matched.owner, repo: matched.repo,
        }),
      },
      ...(current?.worker === undefined ? {} : { worker: current.worker }),
      ...(current?.validationProfiles === undefined ? {} : { validationProfiles: current.validationProfiles }),
      ...(current?.validationProfileIds === undefined ? {} : { validationProfileIds: current.validationProfileIds }),
      validationCommands: current?.validationCommands ?? [],
    }
    if (!await this.workspaceProjects.putIfRevision(request.expectedRevision, config)) {
      throw new Error('PactFlow Workspace project revision changed while adopting Git')
    }
    return config
  }

  /** Create and attach one explicitly confirmed Gitea repository for a clean committed Workspace. */
  @Remote('createWorkspaceRemote')
  async createWorkspaceRemote(
    request: PactFlowCreateWorkspaceRemoteRequest,
  ): Promise<PactFlowWorkspaceProjectConfig> {
    if (request.confirm !== 'create-gitea-repository') throw new Error('PactFlow Gitea repository creation requires confirmation')
    const workspace = this.requireWorkspace(request.workspaceId)
    const status = await inspectWorkspaceGit(workspace.path)
    if (!status.initialized || !status.hasCommit || !status.clean || status.remoteUrl !== undefined) {
      throw new Error('PactFlow remote creation requires a clean committed repository without origin')
    }
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(request.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(request.repo)) {
      throw new Error('PactFlow Gitea owner or repository name is invalid')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(request.defaultBranch)) {
      throw new Error('PactFlow default branch is invalid')
    }
    const current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const provider = this.infrastructure?.settings.gitProviders.find(item => item.id === request.providerId)
    if (provider === undefined) throw new Error(`PactFlow Gitea provider "${request.providerId}" is not configured`)
    const token = await this.resolveCredential(provider.tokenCredentialRef, 'Gitea password or token')
    const created = await this.gitea.createRepository(provider.baseUrl, provider.username, token, {
      owner: request.owner, repo: request.repo, private: request.private, defaultBranch: request.defaultBranch,
    })
    await attachAndPushWorkspaceRemote(
      workspace.path, created.cloneUrl, provider.username ?? request.owner, token,
      status.branch ?? request.defaultBranch,
    )
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      git: {
        remote: 'origin', remoteUrl: created.cloneUrl, defaultBranch: request.defaultBranch,
        giteaProviderId: provider.id, owner: request.owner, repo: request.repo, boundAt: now,
      },
      ...(current?.worker === undefined ? {} : { worker: current.worker }),
      ...(current?.validationProfiles === undefined ? {} : { validationProfiles: current.validationProfiles }),
      ...(current?.validationProfileIds === undefined ? {} : { validationProfileIds: current.validationProfileIds }),
      validationCommands: current?.validationCommands ?? [],
    }
    if (!await this.workspaceProjects.putIfRevision(request.expectedRevision, config)) {
      throw new Error('PactFlow Workspace project revision changed while creating the remote')
    }
    return config
  }

  /** Save Workspace-level Worker quotas as references to validated global resources. */
  @Remote('saveWorkspaceWorkerPolicy')
  async saveWorkspaceWorkerPolicy(
    request: PactFlowSaveWorkspaceWorkerPolicyRequest,
  ): Promise<PactFlowWorkspaceProjectConfig> {
    const workspace = this.requireWorkspace(request.workspaceId)
    if (this.infrastructure === undefined) throw new Error('PactFlow Workspace Worker policy requires infrastructure settings')
    const pool = this.infrastructure.workerPool(request.worker.workerPoolId)
    if (pool.clusterId !== request.worker.clusterId) {
      throw new Error('PactFlow project Worker Pool does not belong to the selected K3s cluster')
    }
    if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(request.k3sGitSecretName)) {
      throw new Error('PactFlow project K3s Git Secret name is invalid')
    }
    const seenIds = new Set<string>()
    const seenCombinations = new Set<string>()
    for (const profile of request.worker.agentProfiles) {
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(profile.id)) throw new Error(`invalid Agent Profile id "${profile.id}"`)
      if (profile.displayName.trim() === '') throw new Error(`Agent Profile "${profile.id}" name is required`)
      if (seenIds.has(profile.id)) throw new Error(`duplicate Agent Profile id "${profile.id}"`)
      seenIds.add(profile.id)
      const combination = `${profile.templateId}\u0000${profile.modelConnectionId}`
      if (seenCombinations.has(combination)) throw new Error('duplicate Agent Profile Harness/model combination')
      seenCombinations.add(combination)
      if (!Number.isSafeInteger(profile.maxConcurrency) || profile.maxConcurrency < 1
        || profile.maxConcurrency > pool.maxConcurrency) {
        throw new Error(`Agent Profile "${profile.id}" Worker quantity must be 1-${String(pool.maxConcurrency)}`)
      }
      this.infrastructure.resolveExecution(pool.id, profile.templateId, profile.modelConnectionId)
    }
    if (request.worker.agentProfiles.length === 0) throw new Error('PactFlow project requires at least one Agent Profile')
    const totalWorkers = request.worker.agentProfiles.reduce((total, profile) => total + profile.maxConcurrency, 0)
    const current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      ...(current?.git === undefined ? {} : {
        git: { ...current.git, k3sGitSecretName: request.k3sGitSecretName },
      }),
      worker: { ...structuredClone(request.worker), maxConcurrency: totalWorkers },
      ...(current?.validationProfiles === undefined ? {} : { validationProfiles: current.validationProfiles }),
      ...(current?.validationProfileIds === undefined ? {} : { validationProfileIds: current.validationProfileIds }),
      validationCommands: current?.validationCommands ?? [],
    }
    if (!await this.workspaceProjects.putIfRevision(request.expectedRevision, config)) {
      throw new Error('PactFlow Workspace project revision changed while saving Worker policy')
    }
    return config
  }

  /** Promote one explicitly selected legacy Session Git binding into its Workspace project. */
  @Remote('migrateWorkspaceProject')
  async migrateWorkspaceProject(
    request: PactFlowMigrateWorkspaceProjectRequest,
  ): Promise<PactFlowWorkspaceProjectConfig> {
    if (request.confirm !== 'migrate-session-project') throw new Error('PactFlow Workspace migration requires confirmation')
    const workspace = this.requireWorkspace(request.workspaceId)
    if (!workspace.sessionIds.some(id => String(id) === request.sessionId)) {
      throw new Error('PactFlow migration Session does not belong to the Workspace')
    }
    const record = (await this.listProjects()).find(item => item.sessionId === request.sessionId)
    const legacy = record?.project
    if (legacy?.git === undefined) throw new Error('PactFlow migration candidate has no Git binding')
    const current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const matched = this.infrastructure?.matchGitea(legacy.git.remoteUrl)
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      git: {
        remote: legacy.git.remote, remoteUrl: legacy.git.remoteUrl,
        defaultBranch: legacy.git.defaultBranch, boundAt: legacy.git.boundAt,
        ...(legacy.git.k3sGitSecretName === undefined ? {} : { k3sGitSecretName: legacy.git.k3sGitSecretName }),
        ...(matched === undefined ? {} : {
          giteaProviderId: matched.provider.id, owner: matched.owner, repo: matched.repo,
        }),
      },
      ...(current?.worker === undefined ? {} : { worker: current.worker }),
      ...(current?.validationProfiles === undefined ? {} : { validationProfiles: current.validationProfiles }),
      ...(current?.validationProfileIds === undefined ? {} : { validationProfileIds: current.validationProfileIds }),
      validationCommands: legacy.git.validationCommands,
    }
    if (!await this.workspaceProjects.putIfRevision(request.expectedRevision, config)) {
      throw new Error('PactFlow Workspace project revision changed while migrating the Session project')
    }
    return config
  }

  /** List Host-configured Harness templates without returning Secret values. */
  @Remote('listK3sTemplates')
  listK3sTemplates(): readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[] {
    return this.infrastructure?.listTemplates() ?? this.k3s?.listTemplates() ?? []
  }

  /** List model endpoints independently selectable from compatible Harness profiles. */
  @Remote('listModelConnections')
  listModelConnections(): readonly PactFlowModelConnectionSettings[] {
    return this.infrastructure?.listModelConnections() ?? []
  }

  /** List non-secret Gitea provider identities for Workspace project setup. */
  @Remote('listGiteaProviders')
  listGiteaProviders(): readonly { readonly id: string; readonly displayName: string; readonly username?: string }[] {
    return (this.infrastructure?.settings.gitProviders ?? []).map(provider => ({
      id: provider.id, displayName: provider.displayName,
      ...(provider.username === undefined ? {} : { username: provider.username }),
    }))
  }

  /** List non-secret K3s cluster identities for Workspace execution targeting. */
  @Remote('listK3sClusters')
  listK3sClusters(): readonly { readonly id: string; readonly displayName: string }[] {
    return (this.infrastructure?.settings.clusters ?? []).map(cluster => ({
      id: cluster.id, displayName: cluster.displayName,
    }))
  }

  /** Validate one Host-selected kubeconfig and return names only. */
  @Remote('inspectKubeconfig')
  async inspectKubeconfig(path: string): Promise<PactFlowKubeconfigView> {
    if (!isAbsolute(path)) throw new Error('PactFlow kubeconfig path must be absolute')
    const resolved = await realpath(path)
    const info = await stat(resolved)
    if (!info.isFile()) throw new Error('PactFlow kubeconfig selection is not a regular file')
    const config = new KubeConfig()
    try { config.loadFromFile(resolved) } catch { throw new Error('PactFlow kubeconfig cannot be parsed') }
    const contexts = config.getContexts().map(context => context.name)
      .filter(name => name.length > 0)
      .sort((left, right) => left.localeCompare(right))
    if (contexts.length === 0) throw new Error('PactFlow kubeconfig has no contexts')
    const currentContext = config.getCurrentContext()
    return {
      path: resolved, contexts,
      ...(currentContext === '' ? {} : { currentContext }),
    }
  }

  /** List image-pull Secret names for a configured cluster without reading payloads. */
  @Remote('listImagePullSecrets')
  async listImagePullSecrets(
    clusterId: string,
    draft?: PactFlowInfrastructureSettings,
  ): Promise<readonly string[]> {
    const infrastructure = draft === undefined ? this.requireInfrastructure() : new PactFlowInfrastructure(draft)
    const cluster = infrastructure.cluster(clusterId)
    const worker = new PactFlowK3sWorker({
      namespace: cluster.namespace, pollIntervalMs: cluster.pollIntervalMs,
      imagePullSecret: 'pactflow-probe', templates: [],
      ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
      ...cluster.context === undefined ? {} : { context: cluster.context },
    })
    return await worker.listImagePullSecrets()
  }

  /** List project Git Secret names for one configured cluster without reading payloads. */
  @Remote('listK3sGitSecrets')
  async listK3sGitSecrets(clusterId: string): Promise<readonly string[]> {
    const cluster = this.requireInfrastructure().cluster(clusterId)
    const worker = new PactFlowK3sWorker({
      namespace: cluster.namespace, pollIntervalMs: cluster.pollIntervalMs,
      imagePullSecret: 'pactflow-probe', templates: [],
      ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
      ...cluster.context === undefined ? {} : { context: cluster.context },
    })
    return await worker.listGitSecrets()
  }

  /** List Harbor artifacts as repository/digest choices without returning credentials. */
  @Remote('listHarborArtifacts')
  async listHarborArtifacts(
    registryId: string,
    draft?: PactFlowInfrastructureSettings,
  ): Promise<readonly PactFlowHarborArtifactOption[]> {
    const infrastructure = draft === undefined ? this.requireInfrastructure() : new PactFlowInfrastructure(draft)
    const registry = infrastructure.registry(registryId)
    if (registry.project === undefined || registry.project.trim() === '') {
      throw new Error('PactFlow Harbor project must be configured before browsing artifacts')
    }
    const project = harborProjectName(registry.project)
    const harnessRepository = registry.harnessRepository?.trim() || 'pactflow-worker'
    const headers = await this.registryHeaders(
      registry.username, registry.usernameCredentialRef, registry.passwordCredentialRef,
    )
    const repositories: { readonly name?: string }[] = []
    for (let page = 1; page <= 20; page += 1) {
      const response = await requestJson<readonly { readonly name?: string }[]>({
        url: joinUrlPath(registry.endpoint, `/api/v2.0/projects/${encodeURIComponent(project)}/repositories?page_size=100&page=${String(page)}`),
        tlsVerify: registry.tlsVerify, ...headers === undefined ? {} : { headers },
      })
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Harbor repositories returned HTTP ${String(response.status)}`)
      }
      if (!Array.isArray(response.value)) throw new Error('Harbor repositories response is not an array')
      repositories.push(...response.value)
      if (response.value.length < 100) break
      if (page === 20) throw new Error('Harbor repositories exceeded the maximum page count')
    }
    const expectedNames = new Set([harnessRepository, `${project}/${harnessRepository}`])
    const entry = repositories.find(candidate => candidate.name !== undefined && expectedNames.has(candidate.name))
    if (entry?.name === undefined) {
      throw new Error(`Harbor Harness repository "${harnessRepository}" was not found in project "${project}"`)
    }
    const artifacts: { readonly digest?: string; readonly tags?: readonly { readonly name?: string }[] }[] = []
    for (let page = 1; page <= 20; page += 1) {
      const response = await requestJson<readonly {
        readonly digest?: string
        readonly tags?: readonly { readonly name?: string }[]
      }[]>({
        url: joinUrlPath(registry.endpoint, `/api/v2.0/projects/${encodeURIComponent(project)}/repositories/${harborRepositoryPathSegment(project, entry.name)}/artifacts?page_size=100&with_tag=true&page=${String(page)}`),
        tlsVerify: registry.tlsVerify, ...headers === undefined ? {} : { headers },
      })
      if (response.status < 200 || response.status >= 300) {
        throw new Error(`Harbor artifacts for "${entry.name}" returned HTTP ${String(response.status)}`)
      }
      if (!Array.isArray(response.value)) throw new Error('Harbor artifacts response is not an array')
      artifacts.push(...response.value)
      if (response.value.length < 100) break
      if (page === 20) throw new Error('Harbor artifacts exceeded the maximum page count')
    }
    const options: PactFlowHarborArtifactOption[] = []
    const seenDigests = new Set<string>()
    for (const artifact of artifacts) {
      if (artifact.digest === undefined || !/^sha256:[0-9a-f]{64}$/.test(artifact.digest)) continue
      if (seenDigests.has(artifact.digest)) continue
      seenDigests.add(artifact.digest)
      const tags = (artifact.tags ?? []).map(tag => tag.name).filter((name): name is string => name !== undefined)
      options.push({
        registryId, repository: harnessRepository, digest: artifact.digest, tags,
        label: `${harnessRepository}:${tags[0] ?? artifact.digest.slice(7, 19)}`,
      })
    }
    return options
  }

  /** Reuse DSH's provider discovery pipeline for one unsaved PactFlow model connection. */
  @Remote('discoverModels')
  async discoverModels(model: PactFlowModelConnectionSettings): Promise<readonly PactFlowDiscoveredModel[]> {
    const baseUrl = model.baseUrl.trim()
    if (baseUrl === '') throw new Error('PactFlow model discovery requires a model service URL')
    try { new URL(baseUrl) } catch { throw new Error('PactFlow model service URL is invalid') }
    const apiKey = await this.resolveCredential(model.apiKeyCredentialRef, 'model API key')
    const llm = this.ctx.get('llm') as undefined | {
      discoverModels(
        settingsNs: string,
        request: { readonly baseURL: string; readonly api: string; readonly apiKey: string },
      ): Promise<readonly { readonly id: string; readonly name?: string }[]>
    }
    if (llm === undefined) throw new Error('PactFlow model discovery requires the DSH LLM service')
    const api = model.apiMode === 'openai-chat-completions' ? 'openai-completions' : model.apiMode
    const discovered = await llm.discoverModels('llm-pi-ai', { baseURL: baseUrl, api, apiKey })
    const unique = new Map<string, PactFlowDiscoveredModel>()
    for (const item of discovered) {
      if (item.id.trim() === '' || unique.has(item.id)) continue
      unique.set(item.id, { id: item.id, ...(item.name === undefined ? {} : { name: item.name }) })
    }
    return [...unique.values()].sort((left, right) => left.id.localeCompare(right.id))
  }

  /** Return non-secret logical capacity counters for every configured Worker Pool. */
  @Remote('listWorkerPools')
  listWorkerPools(): readonly PactFlowWorkerPoolStatus[] {
    return this.infrastructure?.statuses().map(status => ({
      ...status, waiting: status.waiting + this.executionCapacity.waiting(status.id),
    })) ?? []
  }

  /** Run one real, read-only infrastructure connection probe with bounded stage evidence. */
  @Remote('probeInfrastructure')
  async probeInfrastructure(request: PactFlowInfrastructureProbeRequest): Promise<PactFlowInfrastructureProbeResult> {
    const startedAt = Date.now()
    const stages: PactFlowInfrastructureProbeStage[] = []
    try {
      stages.push({
        name: 'start', state: 'succeeded',
        detail: request.draft === undefined ? 'testing restart-applied settings' : 'testing current unsaved form values',
      })
      const infrastructure = request.draft === undefined
        ? this.requireInfrastructure()
        : new PactFlowInfrastructure(request.draft)
      if (request.kind === 'cluster') {
        const cluster = infrastructure.cluster(request.id)
        stages.push({ name: 'resolve-config', state: 'succeeded', detail: 'K3s cluster metadata accepted' })
        const worker = new PactFlowK3sWorker({
          namespace: cluster.namespace, pollIntervalMs: cluster.pollIntervalMs,
          imagePullSecret: 'pactflow-probe', templates: [],
          ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
          ...cluster.context === undefined ? {} : { context: cluster.context },
        })
        await worker.preflight()
        stages.push({ name: 'namespace-access', state: 'succeeded', detail: `namespace ${cluster.namespace} is accessible` })
      } else if (request.kind === 'registry') {
        const registry = infrastructure.registry(request.id)
        stages.push({ name: 'resolve-config', state: 'succeeded', detail: 'Harbor endpoint and TLS policy accepted' })
        const headers = await this.registryHeaders(
          registry.username, registry.usernameCredentialRef, registry.passwordCredentialRef,
        )
        const ping = await probeHttp({
          url: joinUrlPath(registry.endpoint, '/api/v2.0/ping'), tlsVerify: registry.tlsVerify,
          ...headers === undefined ? {} : { headers },
        })
        if (ping < 200 || ping >= 300) throw new Error(`Harbor ping returned HTTP ${String(ping)}`)
        stages.push({ name: 'harbor-ping', state: 'succeeded', detail: `Harbor API returned HTTP ${String(ping)}` })
        if (registry.project !== undefined && registry.project.trim() !== '') {
          const projectName = harborProjectName(registry.project)
          const project = await probeHttp({
            url: joinUrlPath(registry.endpoint, `/api/v2.0/projects/${encodeURIComponent(projectName)}`),
            tlsVerify: registry.tlsVerify, ...headers === undefined ? {} : { headers },
          })
          if (project < 200 || project >= 300) throw new Error(`Harbor project access returned HTTP ${String(project)}`)
          stages.push({ name: 'project-access', state: 'succeeded', detail: `project ${projectName} is accessible` })
        }
        const artifacts = await this.listHarborArtifacts(request.id, request.draft)
        const synchronized = synchronizeHarnessTemplates(
          request.id, registry.harnessRepository?.trim() || 'pactflow-worker', artifacts, [],
        )
        if (synchronized.missing.length > 0) {
          throw new Error(`Harbor Harness repository is missing ${synchronized.missing.join(', ')}`)
        }
        stages.push({
          name: 'harness-images', state: 'succeeded',
          detail: `repository ${registry.harnessRepository ?? 'pactflow-worker'} exposes ${String(synchronized.found.length)} Harness image families`,
        })
      } else if (request.kind === 'git-provider') {
        const provider = infrastructure.gitProvider(request.id)
        stages.push({ name: 'resolve-config', state: 'succeeded', detail: 'Gitea endpoint accepted' })
        const token = await this.resolveCredential(provider.tokenCredentialRef, 'Gitea password or token')
        const authorization = provider.username === undefined
          ? `token ${token}`
          : `Basic ${Buffer.from(`${provider.username}:${token}`).toString('base64')}`
        const response = await requestJson<{ readonly version?: unknown }>({
          url: joinUrlPath(provider.baseUrl, '/api/v1/version'),
          headers: { Authorization: authorization },
        })
        if (response.status < 200 || response.status >= 300) throw new Error(`Gitea version API returned HTTP ${String(response.status)}`)
        if (response.value === null || typeof response.value !== 'object'
          || typeof response.value.version !== 'string' || response.value.version.trim() === '') {
          throw new Error('Gitea version API returned no semantic version')
        }
        stages.push({ name: 'gitea-api', state: 'succeeded', detail: `Gitea API returned HTTP ${String(response.status)}` })
      } else if (request.kind === 'harness') {
        const template = infrastructure.listTemplates().find(candidate => candidate.id === request.id)
        if (template === undefined) throw new Error(`PactFlow Harness "${request.id}" is not configured`)
        if (!('registryId' in template)) throw new Error('legacy Harness template must be migrated before card testing')
        if (request.draft === undefined) {
          const registry = infrastructure.registry(template.registryId)
          const routes = infrastructure.harnessProbeRoutes(template.id)
          const targets: { readonly id: string; readonly label: string; readonly config: PactFlowK3sConfig }[] = []
          if (routes.length > 0) {
            for (const route of routes) {
              targets.push({
                id: route.pool.id,
                label: `${route.pool.displayName}/${route.pool.clusterId}`,
                config: route.k3s,
              })
            }
          } else {
            for (const cluster of infrastructure.settings.clusters) {
              const inspector = new PactFlowK3sWorker({
                namespace: cluster.namespace, pollIntervalMs: cluster.pollIntervalMs,
                imagePullSecret: 'pactflow-probe', templates: [],
                ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
                ...cluster.context === undefined ? {} : { context: cluster.context },
              })
              const pullSecrets = await inspector.listImagePullSecrets()
              const imagePullSecret = registry.imagePullSecret
                ?? (pullSecrets.length === 1 ? pullSecrets[0] : undefined)
              if (imagePullSecret === undefined) {
                throw new Error(`Harness image test for cluster "${cluster.id}" requires one unambiguous image-pull Secret`)
              }
              targets.push({
                id: cluster.id,
                label: cluster.displayName,
                config: {
                  namespace: cluster.namespace, pollIntervalMs: cluster.pollIntervalMs,
                  imagePullSecret, templates: [],
                  ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
                  ...cluster.context === undefined ? {} : { context: cluster.context },
                },
              })
            }
          }
          if (targets.length === 0) throw new Error('Harness image test requires a configured K3s cluster')
          let failed = false
          for (const target of targets) {
            const worker = new PactFlowK3sWorker({
              ...target.config,
              templates: [{
                id: template.id, harness: template.harness,
                apiMode: PACTFLOW_HARNESS_API_MODE[template.harness],
                image: pactFlowImageOf(registry, template), model: 'image-probe',
                baseUrl: 'http://127.0.0.1', modelSecretName: 'pactflow-image-probe',
                cpuRequest: template.cpuRequest, memoryRequest: template.memoryRequest,
                cpuLimit: template.cpuLimit, memoryLimit: template.memoryLimit,
              }],
            })
            try {
              await worker.preflight()
              const probe = await worker.probeImage(template.id, 180_000)
              stages.push(...probe.stages.map(stage => ({
                name: `harness-${target.id}-${stage.name}`,
                state: stage.state,
                detail: `${target.label}: ${stage.detail}`,
              })))
              failed ||= !probe.success
            } catch (error) {
              failed = true
              stages.push({
                name: `harness-${target.id}-connection`, state: 'failed',
                detail: `${target.label}: ${this.boundedOutcome(error)}`,
              })
            }
          }
          if (failed) throw new Error('Harness image Pod probe failed on one or more execution routes')
        } else {
          stages.push({
            name: 'harness-profile', state: 'succeeded',
            detail: 'Harness image reference and resource limits accepted',
          })
        }
      } else if (request.kind === 'model-connection') {
        const model = infrastructure.modelConnection(request.id)
        const apiKey = await this.resolveCredential(model.apiKeyCredentialRef, 'model API key')
        await this.probeModelConnection(model, apiKey)
        stages.push({ name: 'model-api', state: 'succeeded', detail: `model endpoint accepted ${model.apiMode}` })
      } else {
        const pool = infrastructure.workerPool(request.id)
        infrastructure.resolve(pool.id, pool.templateIds[0]!)
        stages.push({
          name: 'resource-graph', state: 'succeeded',
          detail: `cluster, registry, ${String(pool.templateIds.length)} templates, and capacity are valid`,
        })
      }
      const result = { kind: request.kind, id: request.id, success: true, durationMs: Date.now() - startedAt, stages }
      if (request.draft === undefined && this.infrastructure !== undefined) {
        await this.infrastructureHealth.record(this.infrastructure.settings, result)
      }
      return result
    } catch (error) {
      stages.push({ name: 'connection', state: 'failed', detail: this.boundedOutcome(error) })
      const result = { kind: request.kind, id: request.id, success: false, durationMs: Date.now() - startedAt, stages }
      if (request.draft === undefined && this.infrastructure !== undefined) {
        await this.infrastructureHealth.record(this.infrastructure.settings, result)
      }
      return result
    }
  }

  /** Read only current-fingerprint health results; changed configurations resolve to untested. */
  @Remote('listInfrastructureHealth')
  async listInfrastructureHealth(): Promise<readonly PactFlowInfrastructureHealthRecord[]> {
    return this.infrastructure === undefined ? [] : await this.infrastructureHealth.list(this.infrastructure.settings)
  }

  /** Report authoritative blockers and product-owned Credential refs before deletion. */
  @Remote('infrastructureDeletionImpact')
  async infrastructureDeletionImpact(
    kind: PactFlowInfrastructureResourceKind,
    id: string,
    draft?: PactFlowInfrastructureSettings,
  ): Promise<PactFlowInfrastructureDeletionImpact> {
    const infrastructure = draft === undefined ? this.requireInfrastructure() : new PactFlowInfrastructure(draft)
    const settings = infrastructure.settings
    const blockers: string[] = []
    const credentialRefs: string[] = []
    if (kind === 'cluster') {
      blockers.push(...settings.workerPools.filter(pool => pool.clusterId === id)
        .map(pool => `执行资源池「${pool.displayName}」`))
    } else if (kind === 'registry') {
      blockers.push(...settings.templates.filter(template => 'registryId' in template && template.registryId === id)
        .map(template => `Harness「${'displayName' in template ? template.displayName : template.id}」`))
      blockers.push(...settings.workerPools.filter(pool => pool.registryId === id)
        .map(pool => `执行资源池「${pool.displayName}」`))
      const registry = settings.registries.find(item => item.id === id)
      for (const ref of [registry?.usernameCredentialRef, registry?.passwordCredentialRef]) {
        if (ref !== undefined) credentialRefs.push(ref)
      }
    } else if (kind === 'harness') {
      blockers.push(...settings.workerPools.filter(pool => pool.templateIds.includes(id))
        .map(pool => `执行资源池「${pool.displayName}」`))
    } else if (kind === 'model-connection') {
      const model = settings.modelConnections?.find(item => item.id === id)
      if (model !== undefined) credentialRefs.push(model.apiKeyCredentialRef)
    } else if (kind === 'git-provider') {
      const provider = settings.gitProviders.find(item => item.id === id)
      if (provider !== undefined) {
        credentialRefs.push(provider.tokenCredentialRef)
        const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
        if (query !== undefined) {
          const projects = await this.listProjects()
          blockers.push(...projects.filter(record => record.project?.git?.gitea?.tokenCredentialRef === provider.tokenCredentialRef)
            .map(record => `项目「${record.project?.name ?? record.sessionId}」`))
        }
      }
    } else {
      const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
      if (query !== undefined) {
        const projects = await this.listProjects()
        blockers.push(...projects.filter(record => record.project?.workerPoolId === id)
          .map(record => `项目「${record.project?.name ?? record.sessionId}」`))
      }
    }
    return { kind, id, blockers: [...new Set(blockers)], credentialRefs: [...new Set(credentialRefs)] }
  }

  /** Reconcile nonterminal K3s Runs for one live PactFlow Session on demand. */
  @Remote('reconcileK3s')
  async reconcileK3s(sessionId: string): Promise<PactFlowSnapshot> {
    const session = this.livePactFlowSession(sessionId)
    await this.reconcileK3sSession(session)
    return this.snapshotOfLive(session)
  }

  /** Reconcile every persisted nonterminal Run owned by one live PactFlow Session. */
  @Remote('reconcileRuns')
  async reconcileRuns(sessionId: string): Promise<PactFlowSnapshot> {
    const session = this.livePactFlowSession(sessionId)
    await this.reconcileSessionRuns(session)
    return this.snapshotOfLive(session)
  }

  /** Run one real Harness connectivity probe with explicit visible inputs. */
  @Remote('probeHarness')
  async probeHarness(request: PactFlowHarnessProbeRequest): Promise<PactFlowHarnessProbeResult> {
    const resolved = this.resolveK3sDispatch(undefined, request.templateId, request.modelConnectionId)
    const worker = resolved.worker
    await worker.preflight()
    const apiKey = resolved.modelConnection === undefined
      ? undefined
      : await this.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
    return await worker.probe(resolved.executionTemplateId, request.prompt, request.timeoutMs, apiKey)
  }

  /** Run one direct API protocol probe with a visible redacted request payload. */
  @Remote('probeApi')
  async probeApi(request: PactFlowHarnessProbeRequest): Promise<PactFlowApiProbeResult> {
    const resolved = this.resolveK3sDispatch(undefined, request.templateId, request.modelConnectionId)
    const worker = resolved.worker
    await worker.preflight()
    const apiKey = resolved.modelConnection === undefined
      ? undefined
      : await this.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
    return await worker.probeApi(resolved.executionTemplateId, request.prompt, request.timeoutMs, apiKey)
  }

  /** Run one Git-backed node in a K3s Job and locally verify its pushed commit. */
  @Remote('dispatchK3sNode')
  async dispatchK3sNode(
    sessionId: string,
    request: DispatchPactFlowK3sNodeRequest,
  ): Promise<PactFlowClaimResult> {
    return await this.dispatchK3sNodeWithSignal(sessionId, request)
  }

  /** Internal Agent path carrying the live exec.signal through queue and Job cancellation. */
  async dispatchK3sNodeWithSignal(
    sessionId: string,
    request: DispatchPactFlowK3sNodeRequest,
    signal?: AbortSignal,
  ): Promise<PactFlowClaimResult> {
    if (signal?.aborted) throw new Error('PactFlow K3s dispatch was cancelled before claim')
    const session = this.livePactFlowSession(sessionId)
    const project = this.requireProject(session)
    const workspaceProject = await this.workspaceProjectForSession(session)
    const projectGit = project.git ?? this.workspaceGitBinding(workspaceProject)
    if (projectGit === undefined) throw new Error('PactFlow project has no Git binding')
    await this.assertValidationProfilesCurrent(session, projectGit)
    if (projectGit.k3sGitSecretName === undefined) {
      throw new Error('PactFlow project has no K3s Git Secret binding')
    }
    const prompt = request.prompt.trim()
    const leaseDurationMs = this.leaseDuration(request.leaseDurationMs)
    const node = this.node(session, request.nodeId)
    this.requireRevision('node', node.id, node.revision, request.expectedRevision)
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
    const resolved = this.resolveK3sDispatch(
      request.workerPoolId ?? project.workerPoolId ?? workspaceProject?.worker?.workerPoolId,
      request.templateId,
      request.modelConnectionId ?? selectedProfile?.modelConnectionId,
    )
    const worker = resolved.worker
    await worker.preflight()
    const runId = PactFlowRunId(`run-${randomUUID()}`)
    const git = await this.git.plan(session.header.cwd, session.id, runId, node, projectGit)
    worker.preflightRun(git, prompt)
    const planned = worker.plan(
      runId, resolved.executionTemplateId, projectGit.k3sGitSecretName, leaseDurationMs, git, prompt,
    )
    const modelApiKey = resolved.modelConnection === undefined
      ? undefined
      : await this.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
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
    this.requireRevision('project', project.id, this.requireProject(session).revision, project.revision)
    const latestWorkspaceProject = await this.workspaceProjectForSession(session)
    if ((workspaceProject?.revision ?? 0) !== (latestWorkspaceProject?.revision ?? 0)
      || JSON.stringify(workspaceProject?.worker) !== JSON.stringify(latestWorkspaceProject?.worker)
      || JSON.stringify(workspaceProject?.validationProfiles) !== JSON.stringify(latestWorkspaceProject?.validationProfiles)
      || JSON.stringify(workspaceProject?.validationProfileIds) !== JSON.stringify(latestWorkspaceProject?.validationProfileIds)) {
      throw new Error('PactFlow dispatch Workspace configuration changed before claim')
    }
    const queueId = `queue-${randomUUID()}`
    this.events.append(session, 'pactflow/run-queued', {
      v: 1, queueId, sessionId: String(session.id), nodeId: node.id, requestedAt: Date.now(),
    })
    let releaseCapacity: (() => void) | undefined
    try {
      releaseCapacity = await this.acquireExecutionOrCancel(
        session, queueId,
        workspaceProject?.worker === undefined ? undefined : workspaceProject.workspaceId,
        workspaceProject?.worker,
        selectedProfile?.id,
        resolved.poolId,
        signal,
      )
    } catch (error) {
      releaseCapacity?.()
      throw error
    }
    try {
      let owned = this.claimNodeInSession(session, {
        nodeId: request.nodeId,
        expectedRevision: request.expectedRevision,
        provider: `k3s:${request.templateId}`,
        leaseDurationMs,
      }, { runId, git, k3s })
      try {
        await this.git.materialize(session.header.cwd, git)
      } catch (error) {
        return this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: this.boundedOutcome(error),
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
        owned = this.renewRun(session.id, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          leaseDurationMs,
        })
        timer = setInterval(() => {
          try {
            const liveOwned = owned
            if (liveOwned === undefined) return
            owned = this.renewRun(session.id, {
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
          remoteResult = await worker.run(
            k3s, git, prompt, controller.signal, modelApiKey, undefined,
            async (jobUid) => {
              owned = this.bindK3sRunInSession(session, owned, jobUid)
            },
          )
          if (remoteResult.branch !== git.branch) throw new Error('PactFlow K3s Worker returned another branch')
        } catch (error) {
          const settled = this.settleRunInSession(session, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            expectedNodeRevision: owned.node.revision,
            state: controller.signal.aborted ? 'cancelled' : 'failed',
            outcome: this.boundedOutcome(error),
          })
          await this.ensureK3sCleanup(session, settled.run)
          return settled
        }
        let gitResult: PactFlowGitResult
        try {
          gitResult = await this.git.acceptRemoteResult(
            session.header.cwd,
            git,
            remoteResult.commit,
            await this.resolveGitAuth(git),
          )
        } catch (error) {
          const settled = this.settleRunInSession(session, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            expectedNodeRevision: owned.node.revision,
            state: 'failed',
            outcome: this.boundedOutcome(error),
          })
          await this.ensureK3sCleanup(session, settled.run)
          return settled
        }
        return this.settleRunInSession(session, {
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
      releaseCapacity?.()
    }
  }

  /** Claim a node, execute one DSH one-shot Subagent, and settle from its terminal result. */
  @Remote('dispatchLocalNode')
  async dispatchLocalNode(
    sessionId: string,
    request: DispatchPactFlowLocalNodeRequest,
  ): Promise<PactFlowClaimResult> {
    const session = this.livePactFlowSession(sessionId)
    const execution = this.localExecution(session, request, false)
    const owned = this.claimNodeInSession(session, request)
    return await this.executeClaimed(session, request, execution, owned)
  }

  /** Create a Host-owned task worktree, run a child there, and require a clean descendant commit. */
  @Remote('dispatchGitNode')
  async dispatchGitNode(
    sessionId: string,
    request: DispatchPactFlowGitNodeRequest,
  ): Promise<PactFlowClaimResult> {
    return await this.dispatchGitNodeWithSignal(sessionId, request)
  }

  /** Internal Agent path carrying cancellation into a local Subagent-backed Git Run. */
  async dispatchGitNodeWithSignal(
    sessionId: string,
    request: DispatchPactFlowGitNodeRequest,
    signal?: AbortSignal,
  ): Promise<PactFlowClaimResult> {
    if (signal?.aborted) throw new Error('PactFlow Git dispatch was cancelled before claim')
    const session = this.livePactFlowSession(sessionId)
    const execution = this.localExecution(session, request, true)
    const project = this.requireProject(session)
    if (project.git === undefined) throw new Error('PactFlow project has no Git binding')
    await this.assertValidationProfilesCurrent(session, project.git)
    const node = this.node(session, request.nodeId)
    this.requireRevision('node', node.id, node.revision, request.expectedRevision)
    if (node.state !== 'ready') throw new Error(`PactFlow node "${node.id}" is not ready`)
    const runId = PactFlowRunId(`run-${randomUUID()}`)
    const git = await this.git.plan(session.header.cwd, session.id, runId, node, project.git)
    this.requireRevision('project', project.id, this.requireProject(session).revision, project.revision)
    const owned = this.claimNodeInSession(session, request, { runId, git })
    try {
      await this.git.materialize(session.header.cwd, git)
    } catch (error) {
      return this.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: this.boundedOutcome(error),
      })
    }
    return await this.executeClaimed(session, request, execution, owned, git, signal)
  }

  /** Resolve the live parent and selected Provider before a node is claimed. */
  private localExecution(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    requiresCwd: boolean,
  ): { readonly parent: Agent; readonly subagents: SubagentRuntime; readonly prompt: string } {
    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    const subagents = this.ctx.get('subagents') as SubagentRuntime | undefined
    const parent = agents?.get(session.id)
    if (parent === undefined) throw new Error(`session "${session.id}" has no live parent Agent`)
    if (subagents === undefined) throw new Error('PactFlow local dispatch requires the Subagent runtime')
    const provider = subagents.getProvider(request.provider)
    if (provider === undefined) {
      throw new Error(`PactFlow Subagent provider "${request.provider}" is not registered`)
    }
    if (requiresCwd && !provider.capabilities.cwd) {
      throw new Error(`PactFlow Subagent provider "${request.provider}" cannot select a task worktree`)
    }
    const prompt = request.prompt.trim()
    if (prompt.length === 0) throw new Error('PactFlow local Worker prompt must be non-empty')
    return { parent, subagents, prompt }
  }

  /** Execute one already claimed Run and converge its Subagent and Git outcomes. */
  private async executeClaimed(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    execution: { readonly parent: Agent; readonly subagents: SubagentRuntime; readonly prompt: string },
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
      })
    } catch (error) {
      return this.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: this.boundedOutcome(error),
      })
    }
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      owned = this.renewRun(session.id, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        leaseDurationMs: request.leaseDurationMs,
      })
      const renewEvery = Math.max(1_000, Math.floor(request.leaseDurationMs / 2))
      timer = setInterval(() => {
        try {
          owned = this.renewRun(session.id, {
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
        return this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: this.boundedOutcome(error),
        })
      }
      let gitResult: PactFlowGitResult | undefined
      if (result.stopReason === 'completed' && git !== undefined) {
        try {
          const localResult = await this.git.validateResult(git)
          gitResult = await this.git.syncResult(
            session.header.cwd,
            git,
            localResult,
            await this.resolveGitAuth(git),
          )
        } catch (error) {
          return this.settleRunInSession(session, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            expectedNodeRevision: owned.node.revision,
            state: 'failed',
            outcome: this.boundedOutcome(error),
          })
        }
      }
      return this.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: result.stopReason === 'completed'
          ? 'succeeded'
          : result.stopReason === 'aborted' ? 'cancelled' : 'failed',
        outcome: this.subagentOutcome(result),
      }, gitResult)
    } finally {
      if (timer !== undefined) clearInterval(timer)
      if (externalSignal !== undefined) externalSignal.removeEventListener('abort', forwardAbort)
      await child.dispose()
    }
  }

  /** Build the restart-applied K3s provider from validated non-secret settings. */
  private k3sFrom(config: false | PactFlowK3sConfig | undefined): PactFlowK3sWorker | undefined {
    return config === undefined || config === false ? undefined : new PactFlowK3sWorker(config)
  }

  private infrastructureFrom(
    config: false | PactFlowInfrastructureSettings | undefined,
  ): PactFlowInfrastructure | undefined {
    return config === undefined || config === false ? undefined : new PactFlowInfrastructure(config)
  }

  private requireInfrastructure(): PactFlowInfrastructure {
    if (this.infrastructure === undefined) throw new Error('PactFlow infrastructure is not configured')
    return this.infrastructure
  }

  private rebuildPoolWorkers(): void {
    this.k3sByPool.clear()
    if (this.infrastructure === undefined) return
    for (const pool of this.infrastructure.settings.workerPools) {
      const resolved = this.infrastructure.resolve(pool.id, pool.templateIds[0]!)
      this.k3sByPool.set(pool.id, new PactFlowK3sWorker(resolved.k3s))
    }
  }

  private resolveK3sDispatch(
    poolId: string | undefined,
    templateId: string,
    modelConnectionId?: string,
  ): {
    readonly worker: PactFlowK3sWorker
    readonly executionTemplateId: string
    readonly modelConnection?: PactFlowModelConnectionSettings
    readonly poolId?: string
  } {
    if (this.infrastructure !== undefined) {
      const resolved = this.infrastructure.resolveExecution(poolId, templateId, modelConnectionId)
      const worker = this.k3sByPool.get(resolved.pool.id)
      if (worker === undefined) throw new Error(`PactFlow Worker Pool "${resolved.pool.id}" is not active`)
      return {
        worker, poolId: resolved.pool.id, executionTemplateId: resolved.executionTemplateId,
        ...(resolved.modelConnection === undefined ? {} : { modelConnection: resolved.modelConnection }),
      }
    }
    if (this.k3s === undefined) throw new Error('PactFlow K3s provider is not configured')
    if (poolId !== undefined) throw new Error('PactFlow legacy K3s provider does not support Worker Pool selection')
    return { worker: this.k3s, executionTemplateId: templateId }
  }

  private workerForRun(spec: PactFlowK3sRunSpec): PactFlowK3sWorker {
    if (spec.workerPoolId !== undefined) {
      const worker = this.k3sByPool.get(spec.workerPoolId)
      if (worker === undefined) throw new Error(`PactFlow Worker Pool "${spec.workerPoolId}" is not active`)
      return worker
    }
    if (this.k3s === undefined) throw new Error('PactFlow legacy K3s provider is not configured')
    return this.k3s
  }

  private async resolveCredential(reference: string, label: string): Promise<string> {
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) throw new Error(`${label} requires the Credentials service`)
    const resolved = await credentials.resolve(credentialRef(reference))
    if (resolved === undefined) throw new Error(`${label} Credential reference is not configured`)
    return resolved.value
  }

  private async probeModelConnection(model: PactFlowModelConnectionSettings, apiKey: string): Promise<void> {
    const base = new URL(model.baseUrl)
    const suffix = model.apiMode === 'anthropic-messages'
      ? 'messages'
      : model.apiMode === 'openai-responses' ? 'responses' : 'chat/completions'
    base.pathname = `${base.pathname.replace(/\/$/, '')}/${suffix}`
    const body = model.apiMode === 'anthropic-messages'
      ? { model: model.model, max_tokens: 8, messages: [{ role: 'user', content: 'say hi to me' }] }
      : model.apiMode === 'openai-responses'
        ? { model: model.model, input: 'say hi to me', max_output_tokens: 8 }
        : { model: model.model, messages: [{ role: 'user', content: 'say hi to me' }], max_tokens: 8 }
    const headers: Record<string, string> = { 'content-type': 'application/json' }
    if (model.apiMode === 'anthropic-messages') {
      headers['x-api-key'] = apiKey
      headers['anthropic-version'] = '2023-06-01'
    } else {
      headers.authorization = `Bearer ${apiKey}`
    }
    let response: Response
    try {
      response = await fetch(base, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000),
      })
    } catch {
      throw new Error('PactFlow could not connect to the model endpoint')
    }
    if (response.status < 200 || response.status >= 300) {
      throw new Error(`PactFlow model endpoint returned HTTP ${String(response.status)}`)
    }
    let document: unknown
    try { document = await response.json() } catch {
      throw new Error('PactFlow model endpoint returned invalid JSON')
    }
    if (document === null || typeof document !== 'object') {
      throw new Error('PactFlow model endpoint returned an empty response')
    }
    const record = document as { readonly content?: unknown; readonly output?: unknown; readonly choices?: unknown; readonly id?: unknown }
    const hasContent = Array.isArray(record.content) && record.content.length > 0
    const hasOutput = Array.isArray(record.output) && record.output.length > 0
    const hasChoices = Array.isArray(record.choices) && record.choices.length > 0
    if (!hasContent && !hasOutput && !hasChoices && typeof record.id !== 'string') {
      throw new Error('PactFlow model endpoint returned no semantic response')
    }
  }

  private async registryHeaders(
    username: string | undefined,
    usernameRef: string | undefined,
    passwordRef: string | undefined,
  ): Promise<Readonly<Record<string, string>> | undefined> {
    if (username === undefined && usernameRef === undefined && passwordRef === undefined) return undefined
    if ((username === undefined && usernameRef === undefined) || passwordRef === undefined) {
      throw new Error('Harbor username and password must be configured together')
    }
    const [resolvedUsername, password] = await Promise.all([
      username === undefined ? this.resolveCredential(usernameRef!, 'Harbor username') : Promise.resolve(username),
      this.resolveCredential(passwordRef, 'Harbor password'),
    ])
    return { Authorization: `Basic ${Buffer.from(`${resolvedUsername}:${password}`).toString('base64')}` }
  }

  /** Resolve the current Git token per operation without persisting or returning it. */
  private async resolveGitAuth(spec: PactFlowGitRunSpec): Promise<PactFlowGitAuthSecret | undefined> {
    if (spec.auth === undefined) return undefined
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) throw new Error('PactFlow Git authentication requires the Credentials service')
    const resolved = await credentials.resolve(credentialRef(spec.auth.credentialRef))
    if (resolved === undefined) throw new Error('PactFlow Git credential reference is not configured')
    return { username: spec.auth.username, token: resolved.value }
  }

  /** Rehydrate Basic Auth usernames for historical Session bindings from the current non-secret provider config. */
  private effectiveGiteaBinding(binding: PactFlowGiteaBinding): PactFlowGiteaBinding {
    if (binding.username !== undefined) return binding
    const normalizedBaseUrl = binding.baseUrl.replace(/\/$/, '')
    const provider = this.infrastructure?.settings.gitProviders.find(candidate =>
      candidate.baseUrl.replace(/\/$/, '') === normalizedBaseUrl
      && candidate.tokenCredentialRef === binding.tokenCredentialRef)
    return provider?.username === undefined ? binding : { ...binding, username: provider.username }
  }

  /** Reconcile provider-specific Run ownership when one PactFlow Agent becomes live. */
  private async reconcileSessionRuns(session: Session): Promise<void> {
    if (this.currentPreset(session) !== 'pactflow') return
    this.reconcileLocalSession(session)
    await this.reconcileK3sSession(session)
    await this.reconcileCleanups(session)
  }

  /** Schedule or settle nonterminal local Runs whose in-memory Worker cannot survive a cold restart. */
  private reconcileLocalSession(session: Session): void {
    if (this.currentPreset(session) !== 'pactflow') return
    for (const run of Object.values(this.runState(session))) {
      if (this.isTerminalRun(run) || run.k3s !== undefined) continue
      this.reconcileLocalRun(session, run)
    }
  }

  private reconcileLocalRun(session: Session, initial: PactFlowRun): void {
    const key = `${session.id}:${initial.id}`
    const current = this.runState(session)[initial.id]
    if (current === undefined || this.isTerminalRun(current) || current.k3s !== undefined) {
      this.clearLocalExpiryTimer(key)
      return
    }
    const remainingMs = current.leaseDeadline - Date.now()
    if (remainingMs <= 0) {
      this.clearLocalExpiryTimer(key)
      this.expireRunInSession(
        session,
        current,
        'Local Worker lease expired after Host restart; prior outcome is unknown',
        'ready',
      )
      return
    }
    if (this.localExpiryTimers.has(key)) return
    const timer = setTimeout(() => {
      this.localExpiryTimers.delete(key)
      try {
        const live = this.ctx.sessions.get(session.id)
        if (live !== undefined) this.reconcileLocalRun(live, initial)
      } catch (error: unknown) {
        this.ctx.logger.warn('PactFlow local Run recovery failed for "%s": %s', initial.id, this.boundedOutcome(error))
      }
    }, remainingMs)
    this.localExpiryTimers.set(key, timer)
  }

  private clearLocalExpiryTimer(key: string): void {
    const timer = this.localExpiryTimers.get(key)
    if (timer !== undefined) clearTimeout(timer)
    this.localExpiryTimers.delete(key)
  }

  /** Reattach every nonterminal K3s Run when its PactFlow Agent becomes live. */
  private async reconcileK3sSession(session: Session): Promise<void> {
    if ((this.k3s === undefined && this.infrastructure === undefined) || this.currentPreset(session) !== 'pactflow') return
    const runs = Object.values(this.runState(session))
      .filter(run => !this.isTerminalRun(run) && run.k3s !== undefined && run.git !== undefined)
    await Promise.all(runs.map(run => this.reconcileK3sRun(session, run)))
  }

  private async reconcileK3sRun(session: Session, initial: PactFlowRun): Promise<void> {
    if (initial.k3s === undefined || initial.git === undefined) return
    let worker: PactFlowK3sWorker
    try {
      worker = this.workerForRun(initial.k3s)
    } catch (error) {
      const currentNode = this.node(session, initial.nodeId)
      if (!this.isTerminalRun(initial)) {
        this.settleRunInSession(session, {
          runId: initial.id, claimId: initial.claimId, expectedNodeRevision: currentNode.revision,
          state: 'failed', outcome: this.boundedOutcome(error),
        })
      }
      return
    }
    const key = `${session.id}:${initial.id}`
    if (this.reconcilingK3s.has(key)) return
    this.reconcilingK3s.add(key)
    const workspaceProject = await this.workspaceProjectForSession(session)
    let releaseCapacity: (() => void) | undefined
    try {
      releaseCapacity = this.executionCapacity.reserveExisting({
        workspaceId: workspaceProject?.worker === undefined ? undefined : workspaceProject.workspaceId,
        policy: workspaceProject?.worker,
        profileId: initial.k3s.agentProfileId,
        poolId: initial.k3s.workerPoolId,
        resolveInfrastructure: () => this.infrastructure,
      })
    } catch (error) {
      releaseCapacity?.()
      const current = this.runState(session)[initial.id]
      if (current !== undefined && !this.isTerminalRun(current)) {
        try {
          const currentNode = this.node(session, current.nodeId)
          const settled = this.settleRunInSession(session, {
            runId: current.id, claimId: current.claimId, expectedNodeRevision: currentNode.revision,
            state: 'failed', outcome: this.boundedOutcome(error),
          })
          await this.ensureK3sCleanup(session, settled.run)
        } catch (settleError) {
          this.ctx.logger.warn('PactFlow K3s capacity failure left Run unsettled "%s": %s', initial.id, this.boundedOutcome(settleError))
        }
      }
      this.reconcilingK3s.delete(key)
      this.ctx.logger.warn('PactFlow K3s capacity recovery failed for "%s": %s', initial.id, this.boundedOutcome(error))
      return
    }
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined
    let owned: PactFlowClaimResult | undefined
    try {
      owned = { run: initial, node: this.node(session, initial.nodeId) }
      if (initial.k3s.runNonceHash === undefined || initial.k3s.claimTokenHash === undefined
        || initial.k3s.specDigest === undefined) {
        const producerVersion = this.pactFlowProducerVersion(session)
        if (producerVersion !== '0.3.0') {
          const settled = this.settleRunInSession(session, {
            runId: initial.id, claimId: initial.claimId, expectedNodeRevision: owned.node.revision,
            state: 'failed', outcome: 'Legacy K3s Run has no bound nonce, claim, or Spec digest',
          })
          await this.ensureK3sCleanup(session, settled.run)
          return
        }
      }
      let observation = await this.retryK3sOperation(() => worker.observe(initial.k3s!), controller.signal)
      if (observation.state === 'missing') {
        if (Date.now() >= owned.run.leaseDeadline) {
          this.expireRunInSession(session, owned.run, 'K3s Job is missing after lease expiry')
        } else {
          this.settleRunInSession(session, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            expectedNodeRevision: owned.node.revision,
            state: 'failed',
            outcome: 'K3s Job is missing during recovery',
          })
        }
        return
      }
      if (observation.state === 'pending') {
        if (Date.now() >= owned.run.leaseDeadline) {
          await this.retryK3sOperation(() => worker.cancelRun(initial.k3s!), controller.signal)
          this.expireRunInSession(session, owned.run, 'K3s Job exceeded its persisted lease')
          return
        }
        const leaseDurationMs = owned.run.leaseDurationMs
          ?? Math.max(1_000, owned.run.leaseDeadline - Date.now())
        owned = this.renewRun(session.id, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          leaseDurationMs,
        })
        timer = setInterval(() => {
          try {
            const liveOwned = owned
            if (liveOwned === undefined) return
            owned = this.renewRun(session.id, {
              runId: liveOwned.run.id,
              claimId: liveOwned.run.claimId,
              leaseDurationMs,
            })
          } catch {
            controller.abort('PactFlow recovered K3s lease renewal failed')
          }
        }, Math.max(1_000, Math.floor(leaseDurationMs / 2)))
        try {
          const result = await this.retryK3sOperation(
            () => worker.waitExisting(initial.k3s!, controller.signal), controller.signal,
          )
          observation = { state: 'succeeded', result }
        } catch (error) {
          if (Date.now() >= owned.run.leaseDeadline) {
            this.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
          } else {
            const settled = this.settleRunInSession(session, {
              runId: owned.run.id,
              claimId: owned.run.claimId,
              expectedNodeRevision: owned.node.revision,
              state: controller.signal.aborted ? 'cancelled' : 'failed',
              outcome: this.boundedOutcome(error),
            })
            await this.ensureK3sCleanup(session, settled.run)
          }
          return
        }
      }
      if (observation.state === 'failed') {
        if (observation.finishedAt >= owned.run.leaseDeadline) {
          this.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
          return
        }
        const settled = this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: observation.outcome,
        }, undefined, undefined, observation.finishedAt)
        await this.ensureK3sCleanup(session, settled.run)
        return
      }
      if (observation.state !== 'succeeded') {
        throw new Error(`PactFlow K3s recovery remained ${observation.state}`)
      }
      const remoteResult = observation.result
      if (remoteResult.finishedAt >= owned.run.leaseDeadline) {
        this.expireRunInSession(session, owned.run, 'K3s Worker completed after lease expiry')
        return
      }
      if (remoteResult.branch !== initial.git.branch) throw new Error('recovered K3s Worker returned another branch')
      const gitResult = await this.retryK3sOperation(async () => this.git.acceptRemoteResult(
        session.header.cwd,
        initial.git!,
        remoteResult.commit,
        await this.resolveGitAuth(initial.git!),
      ), controller.signal)
      this.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'succeeded',
        outcome: `Recovered K3s Worker ${remoteResult.podName} committed ${remoteResult.commit}`,
      }, gitResult, remoteResult, remoteResult.finishedAt)
    } catch (error) {
      const current = this.runState(session)[initial.id]
      if (current !== undefined && !this.isTerminalRun(current)) {
        try {
          const currentNode = this.node(session, current.nodeId)
          if (Date.now() >= current.leaseDeadline) {
            const settled = this.expireRunInSession(session, current, this.boundedOutcome(error))
            await this.ensureK3sCleanup(session, settled.run)
          } else {
            const settled = this.settleRunInSession(session, {
              runId: current.id, claimId: current.claimId, expectedNodeRevision: currentNode.revision,
              state: controller.signal.aborted ? 'cancelled' : 'failed', outcome: this.boundedOutcome(error),
            })
            await this.ensureK3sCleanup(session, settled.run)
          }
        } catch (settleError) {
          this.ctx.logger.warn('PactFlow K3s Run "%s" could not be settled after recovery failure: %s', initial.id, this.boundedOutcome(settleError))
        }
      }
    } finally {
      if (timer !== undefined) clearInterval(timer)
      releaseCapacity?.()
      this.reconcilingK3s.delete(key)
    }
  }

  private async retryK3sOperation<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    let lastError: unknown
    for (let attempt = 0; attempt < 5; attempt += 1) {
      if (signal?.aborted) throw new Error('PactFlow K3s recovery was cancelled')
      try { return await operation() } catch (error) {
        lastError = error
        if (this.isPermanentK3sError(error) || attempt === 4) break
        await this.backoff(Math.min(15_000, 250 * (2 ** attempt)), signal)
      }
    }
    throw lastError instanceof Error ? lastError : new Error('PactFlow K3s operation failed')
  }

  private async backoff(delayMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw new Error('PactFlow K3s recovery was cancelled')
    await new Promise<void>((resolveDelay, rejectDelay) => {
      let timer: ReturnType<typeof setTimeout>
      const abort = (): void => { clearTimeout(timer); rejectDelay(new Error('PactFlow K3s recovery was cancelled')) }
      timer = setTimeout(() => {
        signal?.removeEventListener('abort', abort)
        resolveDelay()
      }, delayMs)
      signal?.addEventListener('abort', abort, { once: true })
    })
  }

  private isPermanentK3sError(error: unknown): boolean {
    const message = this.boundedOutcome(error).toLowerCase()
    return /uid|identity|label|invalid|foreign|does not match|not descended|another branch|claim|status 4\d\d|http 4\d\d/.test(message)
  }

  /** Record scheduler-owned expiry; this is not a late Worker result. */
  private expireRunInSession(
    session: Session,
    currentRun: PactFlowRun,
    outcome: string,
    nextNodeState: 'failed' | 'ready' = 'failed',
  ): PactFlowClaimResult {
    if (this.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" is already terminal`)
    const now = Date.now()
    if (now < currentRun.leaseDeadline) throw new Error(`PactFlow Run "${currentRun.id}" lease is still active`)
    const currentNode = this.node(session, currentRun.nodeId)
    if (currentNode.revision !== currentRun.nodeRevision) {
      throw new Error(`PactFlow Run "${currentRun.id}" expiry targets a stale node revision`)
    }
    const node: PactFlowNode = {
      ...currentNode, state: nextNodeState, revision: currentNode.revision + 1, updatedAt: now,
    }
    const run: PactFlowRun = { ...currentRun, state: 'failed', outcome, updatedAt: now }
    this.events.append(session, 'pactflow/run-settled', { v: 1, run, node })
    return { run, node }
  }

  /** Resolve a live Session without exporting DSH object identity over the wire. */
  private liveSession(sessionId: string): Session {
    if (sessionId.length === 0) throw new Error('sessionId must be non-empty')
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session === undefined) throw new Error(`session "${sessionId}" is not live`)
    return session
  }

  /** Resolve a live Session and enforce the PactFlow preset owner. */
  private livePactFlowSession(sessionId: string): Session {
    const session = this.liveSession(sessionId)
    this.requirePactFlowPreset(session)
    return session
  }

  /** Enforce the log-backed current preset rather than the immutable creation header. */
  private requirePactFlowPreset(session: Session): void {
    if (this.currentPreset(session) !== 'pactflow') {
      throw new Error(`session "${session.id}" is not composed from the pactflow preset`)
    }
  }

  /** Current log-backed preset when the roster is composed; creation header in bare embeds. */
  private currentPreset(session: Session): string | undefined {
    return this.ctx.sessionProjections.stateOf(session, 'agentPreset') ?? session.header.agentPreset
  }

  private pactFlowProducerVersion(session: Session): string | undefined {
    const declaration = session.events.findLast(event => event.type === 'session/external-event-producer'
      && event.data.producer === 'dsh-pactflow')
    return declaration?.type === 'session/external-event-producer' ? declaration.data.version : undefined
  }

  /** Require the root project projection. */
  private requireProject(session: Session): PactFlowProject {
    const project = this.ctx.sessionProjections.stateOf(session, 'pactflowProject')?.project
    if (project === null || project === undefined) throw new Error(`session "${session.id}" has no initialized PactFlow project`)
    return project
  }

  private requireWorkspaceRegistry(): PactFlowWorkspaceRegistry {
    const registry = this.ctx.get('workspaceRegistry') as PactFlowWorkspaceRegistry | undefined
    if (registry === undefined) throw new Error('PactFlow Workspace projects require the DSH Workspace registry')
    return registry
  }

  private requireWorkspace(workspaceId: string): PactFlowWorkspaceHandle {
    const workspace = this.requireWorkspaceRegistry().get(workspaceId as never)
    if (workspace === undefined) throw new Error(`PactFlow Workspace "${workspaceId}" is not configured`)
    return workspace
  }

  private async workspaceProjectView(workspace: PactFlowWorkspaceHandle): Promise<PactFlowWorkspaceProjectView> {
    const config = await this.workspaceProjects.get(String(workspace.id))
    return {
      workspaceId: String(workspace.id), path: workspace.path, title: workspace.title,
      gitStatus: await inspectWorkspaceGit(workspace.path),
      ...(config === undefined ? {} : { config }), migrationCandidates: [],
    }
  }

  private async workspaceProjectForSession(session: Session): Promise<PactFlowWorkspaceProjectConfig | undefined> {
    const cwd = session.header.cwd
    if (cwd === undefined) return undefined
    const registry = this.ctx.get('workspaceRegistry') as PactFlowWorkspaceRegistry | undefined
    if (registry === undefined) return undefined
    const workspace = registry.list().find(candidate => candidate.path === cwd)
    return workspace === undefined ? undefined : await this.workspaceProjects.get(String(workspace.id))
  }

  private async resolveValidationSelection(
    session: Session,
    request: BindPactFlowGitRequest,
  ): Promise<{ readonly ids: readonly string[]; readonly revisions: Readonly<Record<string, number>>; readonly commands: readonly PactFlowValidationProfile[] } | undefined> {
    if (request.validationProfileIds === undefined) return undefined
    if (request.validationCommands !== undefined && request.validationCommands.length > 0) {
      throw new Error('PactFlow Git binding cannot mix validation profile IDs with raw validation commands')
    }
    const ids = [...new Set(request.validationProfileIds.map(value => value.trim()).filter(Boolean))]
    if (ids.length > 32) throw new Error('PactFlow Git binding selects too many validation profiles')
    const config = await this.workspaceProjectForSession(session)
    const profiles = new Map((config?.validationProfiles ?? []).map(profile => [profile.id, profile]))
    const selected = ids.map(id => {
      const profile = profiles.get(id)
      if (profile === undefined) throw new Error(`PactFlow validation profile "${id}" is not registered for this Workspace`)
      return profile
    })
    return {
      ids,
      revisions: Object.fromEntries(selected.map(profile => [profile.id, profile.revision])),
      commands: selected,
    }
  }

  private async assertValidationProfilesCurrent(
    session: Session,
    binding: PactFlowGitBinding,
  ): Promise<void> {
    if (binding.validationProfileIds === undefined || binding.validationProfileIds.length === 0) return
    const config = await this.workspaceProjectForSession(session)
    const profiles = new Map((config?.validationProfiles ?? []).map(profile => [profile.id, profile]))
    for (const id of binding.validationProfileIds) {
      const profile = profiles.get(id)
      const expected = binding.validationProfileRevisions?.[id]
      if (profile === undefined || expected === undefined || profile.revision !== expected) {
        throw new Error(`PactFlow validation profile "${id}" changed after Git binding; rebind the project`)
      }
    }
  }

  private isLegacyValidationBinding(binding: Pick<PactFlowGitBinding, 'validationCommands' | 'validationProfileIds' | 'legacyUntrusted'>): boolean {
    return binding.legacyUntrusted === true
      || (binding.validationProfileIds === undefined && binding.validationCommands.length > 0)
  }

  private workspaceGitBinding(config: PactFlowWorkspaceProjectConfig | undefined): PactFlowGitBinding | undefined {
    if (config === undefined || config.git === undefined) return undefined
    const git = config.git
    const provider = git.giteaProviderId === undefined
      ? undefined
      : this.infrastructure?.settings.gitProviders.find(item => item.id === git.giteaProviderId)
    const selectedProfileIds = config.validationProfileIds ?? []
    const selectedProfiles = selectedProfileIds.map(id => config.validationProfiles?.find(profile => profile.id === id))
    if (selectedProfiles.some(profile => profile === undefined)) {
      throw new Error('PactFlow Workspace references an unknown validation profile')
    }
    const profileCommands = selectedProfiles.map(profile => ({
      command: profile!.command, args: [...profile!.args], timeoutMs: profile!.timeoutMs,
    }))
    return {
      remote: git.remote, remoteUrl: git.remoteUrl, defaultBranch: git.defaultBranch,
      revision: config.revision, boundAt: git.boundAt,
      validationCommands: profileCommands.length > 0 ? profileCommands : config.validationCommands ?? [],
      ...(selectedProfileIds.length === 0 ? {} : {
        validationProfileIds: selectedProfileIds,
        validationProfileRevisions: Object.fromEntries(selectedProfiles.map(profile => [profile!.id, profile!.revision])),
      }),
      ...(profileCommands.length === 0 && (config.validationCommands?.length ?? 0) > 0 ? { legacyUntrusted: true } : {}),
      ...(git.k3sGitSecretName === undefined ? {} : { k3sGitSecretName: git.k3sGitSecretName }),
      ...(provider?.username === undefined ? {} : {
        auth: { kind: 'https-token', username: provider.username, credentialRef: provider.tokenCredentialRef },
      }),
      ...(provider === undefined || git.owner === undefined || git.repo === undefined ? {} : {
        gitea: {
          baseUrl: provider.baseUrl, owner: git.owner, repo: git.repo,
          tokenCredentialRef: provider.tokenCredentialRef,
          ...(provider.username === undefined ? {} : { username: provider.username }),
        },
      }),
    }
  }

  private requireWorkspaceProjectRevision(
    current: PactFlowWorkspaceProjectConfig | undefined,
    expectedRevision: number,
  ): void {
    const actual = current?.revision ?? 0
    if (actual !== expectedRevision) {
      throw new Error(`PactFlow Workspace project revision mismatch: expected ${String(expectedRevision)}, current ${String(actual)}`)
    }
  }

  private normalizeValidationProfiles(
    input: readonly PactFlowValidationProfileInput[],
    previous: readonly PactFlowValidationProfile[],
  ): readonly PactFlowValidationProfile[] {
    if (input.length > 32) throw new Error('PactFlow Workspace supports at most 32 validation profiles')
    const prior = new Map(previous.map(profile => [profile.id, profile]))
    const seen = new Set<string>()
    return input.map(candidate => {
      const id = candidate.id.trim()
      const displayName = candidate.displayName.trim()
      const command = candidate.command.trim()
      if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) {
        throw new Error(`PactFlow validation profile id "${id}" is invalid`)
      }
      if (seen.has(id)) throw new Error(`duplicate PactFlow validation profile "${id}"`)
      seen.add(id)
      if (displayName.length === 0 || displayName.length > 256) {
        throw new Error(`PactFlow validation profile "${id}" displayName is invalid`)
      }
      if (command.length === 0 || command.length > 256 || /[\0\r\n\s;&|<>$()`]/.test(command)) {
        throw new Error(`PactFlow validation profile "${id}" command is invalid`)
      }
      const executable = command.split('/').pop()?.toLowerCase() ?? command.toLowerCase()
      if (new Set(['sh', 'bash', 'zsh', 'fish', 'dash', 'cmd', 'cmd.exe', 'powershell', 'pwsh']).has(executable)) {
        throw new Error(`PactFlow validation profile "${id}" cannot invoke a shell wrapper`)
      }
      if (candidate.args.length > 64 || candidate.args.some(argument =>
        argument.length > 4_096 || /[\0\r\n]/.test(argument))) {
        throw new Error(`PactFlow validation profile "${id}" args are invalid`)
      }
      if (!Number.isSafeInteger(candidate.timeoutMs) || candidate.timeoutMs < 1_000 || candidate.timeoutMs > 3_600_000) {
        throw new Error(`PactFlow validation profile "${id}" timeoutMs is invalid`)
      }
      const existing = prior.get(id)
      if (candidate.revision !== undefined && (!Number.isSafeInteger(candidate.revision)
        || candidate.revision !== (existing?.revision ?? 1))) {
        throw new Error(`PactFlow validation profile "${id}" revision is stale`)
      }
      return {
        id, displayName, command, args: [...candidate.args], timeoutMs: candidate.timeoutMs,
        revision: (existing?.revision ?? 0) + 1,
      }
    })
  }

  /** Resolve one need from the projection. */
  private need(session: Session, rawId: string): PactFlowNeed {
    this.requireProject(session)
    const id = PactFlowNeedId(rawId)
    const need = this.ctx.sessionProjections.stateOf(session, 'pactflowNeeds')?.byId[id]
    if (need === undefined) throw new Error(`PactFlow need "${id}" does not exist`)
    return need
  }

  /** Read the latest matching review from the delivery projection. */
  private latestReviewApproved(
    session: Session,
    needId: PactFlowNeed['id'],
    kind: PactFlowReview['kind'],
    expectedRevision?: number,
  ): boolean {
    const currentNeed = this.ctx.sessionProjections.stateOf(session, 'pactflowNeeds')?.byId[needId]
    const reviewRevision = expectedRevision ?? currentNeed?.revision
    const reviews = Object.values(
      this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.reviews ?? {},
    ).filter(review => review.needId === needId && review.kind === kind
      && review.source === 'dsh-approval'
      && review.approvalRequestId !== undefined
      && review.evidenceDigest !== undefined
      && review.needRevision !== undefined
      && reviewRevision !== undefined
      && review.needRevision === reviewRevision)
      .sort((left, right) => right.recordedAt - left.recordedAt || right.id.localeCompare(left.id))
    return reviews[0]?.decision === 'approved'
  }

  /** Resolve one node from the DAG projection. */
  private node(session: Session, rawId: string): PactFlowNode {
    const id = PactFlowNodeId(rawId)
    const node = this.dagState(session)[id]
    if (node === undefined) throw new Error(`PactFlow node "${id}" does not exist`)
    return node
  }

  private dagState(session: Session): Readonly<Record<string, PactFlowNode>> {
    return this.ctx.sessionProjections.stateOf(session, 'pactflowDag')?.byId ?? {}
  }

  private runState(session: Session): Readonly<Record<string, PactFlowRun>> {
    return this.ctx.sessionProjections.stateOf(session, 'pactflowRuns')?.byId ?? {}
  }

  private run(session: Session, rawId: string): PactFlowRun {
    const id = PactFlowRunId(rawId)
    const run = this.runState(session)[id]
    if (run === undefined) throw new Error(`PactFlow Run "${id}" does not exist`)
    return run
  }

  /** Canonicalize and validate one same-need dependency set. */
  private dependencies(
    dag: Readonly<Record<string, PactFlowNode>>,
    needId: PactFlowNeed['id'],
    nodeId: PactFlowNode['id'],
    rawDependencies: readonly string[],
  ): readonly PactFlowNode['id'][] {
    const dependencies = rawDependencies.map(PactFlowNodeId).sort()
    if (new Set(dependencies).size !== dependencies.length) throw new Error('PactFlow node dependencies must be unique')
    if (dependencies.includes(nodeId)) throw new Error('PactFlow node cannot depend on itself')
    for (const dependency of dependencies) {
      const target = dag[dependency]
      if (target === undefined) throw new Error(`PactFlow dependency node "${dependency}" does not exist`)
      if (target.needId !== needId) throw new Error(`PactFlow dependency node "${dependency}" belongs to another need`)
    }
    return dependencies
  }

  private dependenciesSucceeded(
    dag: Readonly<Record<string, PactFlowNode>>,
    dependencies: readonly PactFlowNode['id'][],
  ): boolean {
    return dependencies.every(dependency => dag[dependency]?.state === 'succeeded')
  }

  /** Follow dependency edges to detect whether `from` already reaches `target`. */
  private reaches(
    dag: Readonly<Record<string, PactFlowNode>>,
    from: PactFlowNode['id'],
    target: PactFlowNode['id'],
    seen: Set<string>,
  ): boolean {
    if (from === target) return true
    if (seen.has(from)) return false
    seen.add(from)
    return dag[from]?.dependencies.some(dependency => this.reaches(dag, dependency, target, seen)) ?? false
  }

  private requireRevision(kind: string, id: string, current: number, expected: number): void {
    if (!Number.isSafeInteger(expected) || expected < 1) throw new Error(`expected ${kind} revision must be a positive safe integer`)
    if (current !== expected) throw new Error(`PactFlow ${kind} "${id}" revision conflict: expected ${String(expected)}, current ${String(current)}`)
  }

  private leaseDuration(value: number): number {
    if (!Number.isSafeInteger(value) || value < 1_000 || value > 86_400_000) {
      throw new Error('leaseDurationMs must be a safe integer between 1000 and 86400000')
    }
    return value
  }

  private requireClaim(run: PactFlowRun, claimId: string): void {
    if (claimId !== run.claimId) throw new Error(`PactFlow Run "${run.id}" claim identity mismatch`)
  }

  private isTerminalRun(run: PactFlowRun): boolean {
    return run.state === 'succeeded' || run.state === 'failed' || run.state === 'cancelled'
  }

  /** Emit explicit ready transitions for pending dependents whose prerequisites succeeded. */
  private readyDependents(session: Session, needId: PactFlowNeed['id']): void {
    for (const candidate of Object.values(this.dagState(session))) {
      if (candidate.needId !== needId || candidate.state !== 'pending') continue
      if (!this.dependenciesSucceeded(this.dagState(session), candidate.dependencies)) continue
      const node: PactFlowNode = {
        ...candidate,
        state: 'ready',
        revision: candidate.revision + 1,
        updatedAt: Date.now(),
      }
      this.events.append(session, 'pactflow/node-updated', { v: 1, node })
    }
  }

  private subagentOutcome(result: SubagentResult): string {
    const text = result.output.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')
    return this.boundedOutcome(result.diagnostic ?? (text || result.stopReason))
  }

  /** Keep operational outcomes useful without turning the Session Log into an output dump. */
  private boundedOutcome(value: unknown): string {
    const rendered = value instanceof Error ? value.message : String(value)
    const encoded = new TextEncoder().encode(rendered)
    return encoded.length <= 4_096
      ? rendered
      : `${new TextDecoder().decode(encoded.slice(0, 4_080))}…`
  }
}

export default PactFlowService
