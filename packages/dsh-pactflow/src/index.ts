import { fileURLToPath } from 'node:url'
import { pactFlowValidationProfilesSchema } from './schema.ts'
import { createHash, randomUUID } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle, Session } from '@deepseek-ai/dsh-session'
import type { Agent, AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SubagentResult, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type { CredentialProvider } from '@deepseek-ai/dsh-credentials'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import { KubeConfig } from '@kubernetes/client-node'
import {
  PACTFLOW_EVENT_TYPES,
  PACTFLOW_EVENT_TYPES_V0_1,
  PACTFLOW_EVENT_TYPES_V0_2,
  PACTFLOW_EVENT_TYPES_V0_2_1,
  PACTFLOW_EVENT_TYPES_V0_3,
  PACTFLOW_PROJECTIONS,
  PACTFLOW_NEXT_PHASE as NEXT_PHASE,
  pactFlowDeliveryView,
} from './domain.ts'
import { PactFlowGitWorkspace, assertPactFlowValidationAuthorization, type PactFlowGitAuthSecret } from './git-workspace.ts'
import { PactFlowGiteaClient } from './gitea.ts'
import {
  PACTFLOW_HARNESS_API_MODE,
  PactFlowK3sWorker,
  type PactFlowK3sConfig,
  type PactFlowProbeCleanupRecorder,
  type PactFlowRunCleanupRecorder,
} from './k3s-worker.ts'
import { PactFlowProbeCleanupLedger } from './probe-ledger.ts'
import { PactFlowRunCleanupLedger } from './run-ledger.ts'
import { redactUrlCredentials } from './redaction.ts'
import {
  acquireExecutionOrCancelImpl,
  dispatchGitNodeWithSignalImpl,
  dispatchK3sNodeWithSignalImpl,
  executeClaimedImpl,
  localExecutionImpl,
  resolveK3sDispatchImpl,
  workerForRunImpl,
  type DispatchHost,
  type K3sDispatchRoute,
  type PactFlowLocalExecution,
} from './host/dispatch.ts'
import {
  backoffImpl,
  clearLocalExpiryTimerImpl,
  deferK3sRecoveryImpl,
  expireRunInSessionImpl,
  inventoryK3sSessionImpl,
  isPermanentK3sErrorImpl,
  reconcileK3sRunImpl,
  reconcileK3sSessionImpl,
  reconcileLocalRunImpl,
  reconcileLocalSessionImpl,
  reconcileSessionRunsImpl,
  retryK3sOperationImpl,
  type RecoveryHost,
} from './host/recovery.ts'
import {
  infrastructureFromImpl,
  k3sFromImpl,
  rebuildPoolWorkersImpl,
} from './host/settings-adapter.ts'
import {
  appendCleanupRecord as appendCleanupRecordImpl,
  cleanupAction as cleanupActionImpl,
  continueCleanupRecord as continueCleanupRecordImpl,
  ensureK3sCleanup as ensureK3sCleanupImpl,
  performCleanupRecord as performCleanupRecordImpl,
  reconcileCleanupsImpl,
  retryCleanupImpl,
  runCleanupRecord as runCleanupRecordImpl,
  scheduleCleanupRetry as scheduleCleanupRetryImpl,
  type CleanupHost,
} from './host/cleanup.ts'
import {
  reconcileProbeCleanupsImpl,
  probeCleanupRecorderImpl,
  type ProbeRecoveryHost,
} from './host/probe-recovery.ts'
import { PactFlowInfrastructure, pactFlowImageOf } from './infrastructure.ts'
import { PactFlowInfrastructureHealthStore } from './infrastructure-health.ts'
import { harborProjectName, harborRepositoryPathSegment, joinUrlPath, probeHttp, requestJson } from './infrastructure-probe.ts'
import { synchronizeHarnessTemplates } from './harness-discovery.ts'
import {
  PactFlowWorkspaceProjectStore,
  attachAndPushWorkspaceRemote,
  workspaceHeadCommit,
  initializeWorkspaceGit,
  inspectWorkspaceGit,
} from './workspace-project.ts'
import { PactFlowProjectCapacity } from './project-capacity.ts'
import { PactFlowExecutionCapacity } from './execution-capacity.ts'
import { pactFlowDeliverySubjectDigest, pactFlowReviewEvidenceDigest, pactFlowReviewNote } from './review-authorization.ts'
import { PACTFLOW_DEFAULT_RUN_BUDGET, boundOutputToBudget, evaluateAttemptBudget } from './run-budget.ts'
import { harnessCapabilityProfile } from './harness-capabilities.ts'
import { projectHandoverSummary, type PactFlowHandoverSummary } from './project-handover.ts'
import { staleCodeInputs } from './input-staleness.ts'
import { PACTFLOW_DEFAULT_RETENTION_BYTES, PACTFLOW_DEFAULT_RETENTION_MS, measureRetainedSceneBytes, summarizeRetentionCapacity } from './retention-policy.ts'
import type { PactFlowRetentionSummary } from './types.ts'
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
  PactFlowHarnessCapabilityView,
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
  PactFlowRemoteCreation,
  PactFlowRemoteReconciliation,
  PactFlowConfirmWorkspaceRemoteRequest,
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
  PactFlowDrainStatus,
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
// This fixed namespace is valid without a runtime helper export.
const PACTFLOW_SETTINGS_NS = 'pactflow' as SettingsNamespace
interface RecoverySessionController {
  resolveAgent(id: SessionId): Promise<{ agent: Agent } | { error: { message: string } }>
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
  private readonly deferredK3s = new Map<string, { timer: ReturnType<typeof setTimeout>; release: () => void; attempt: number }>()
  private readonly recoveryControllers = new Map<string, AbortController>()
  private readonly inventoriedK3s = new Map<string, () => void>()
  private recoveryStopped = false
  private readonly activeCleanups = new Map<string, Promise<boolean>>()
  private readonly cleanupTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private cleanupStopped = false
  private readonly localExpiryTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly infrastructureHealth = new PactFlowInfrastructureHealthStore()
  private readonly probeLedger = new PactFlowProbeCleanupLedger()
  private readonly runLedger = new PactFlowRunCleanupLedger()
  /** A11: bounded retry/output budgets for runs. */
  private readonly runBudget = PACTFLOW_DEFAULT_RUN_BUDGET
  private readonly workspaceProjects = new PactFlowWorkspaceProjectStore()
  private readonly projectCapacity = new PactFlowProjectCapacity()
  private readonly executionCapacity = new PactFlowExecutionCapacity(this.projectCapacity)

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pactflow')
    if (typeof ctx.sessions.externalEventProducers?.register !== 'function') {
      throw new Error('PactFlow requires DSH external Session event producers; this DSH runtime is unsupported')
    }
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
    ctx.effect(() => () => {
      this.cleanupStopped = true
      for (const timer of this.cleanupTimers.values()) clearTimeout(timer)
      this.cleanupTimers.clear()
    }, 'dsh-pactflow: dispose cleanup retry timers')
    ctx.effect(() => () => {
      this.recoveryStopped = true
      for (const controller of this.recoveryControllers.values()) controller.abort('PactFlow Host disposed')
      for (const deferred of this.deferredK3s.values()) { clearTimeout(deferred.timer); deferred.release() }
      this.deferredK3s.clear()
      for (const release of this.inventoriedK3s.values()) release()
      this.inventoriedK3s.clear()
    }, 'dsh-pactflow: stop recovery supervision')
    ctx.effect(() => {
      const controller = new AbortController()
      ctx.effect(() => () => controller.abort(), 'dsh-pactflow: stop probe cleanup recovery')
      void (async () => {
        for (let attempt = 0; !controller.signal.aborted; attempt++) {
          try {
            if (await this.reconcileProbeCleanups()) return
          } catch (error) {
            if (controller.signal.aborted) return
            this.ctx.logger.warn('PactFlow probe cleanup recovery failed: %s', this.boundedOutcome(error))
          }
          try { await this.backoff(Math.min(60_000, 1_000 * (2 ** Math.min(attempt, 6))), controller.signal) } catch { return }
        }
      })()
      return () => {}
    }, 'dsh-pactflow: schedule probe cleanup recovery')
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
    ctx.inject(['sessionQuery', 'sessionController'], scope => {
      const controller = new AbortController()
      scope.effect(() => () => {
        controller.abort()
        if (!this.recoveryStopped) this.executionCapacity.setInventoryFailure('startup', 'PactFlow startup recovery services are unavailable')
      }, 'dsh-pactflow: stop cold Session discovery')
      const query = scope.get('sessionQuery') as SessionQueryEngine
      const sessions = scope.get('sessionController') as RecoverySessionController
      void (async () => {
        for (let attempt = 0; !controller.signal.aborted; attempt++) {
          try {
            await this.recoverPersistedSessions(query, sessions, controller.signal)
            return
          } catch (error) {
            if (controller.signal.aborted) return
            scope.logger.warn('PactFlow startup recovery failed: %s', this.boundedOutcome(error))
            try { await this.backoff(Math.min(60_000, 1_000 * (2 ** Math.min(attempt, 6))), controller.signal) } catch { return }
          }
        }
      })()
    })
  }

  private async recoverPersistedSessions(query: SessionQueryEngine, controller: RecoverySessionController, signal: AbortSignal): Promise<void> {
    const resumeAdmission = this.executionCapacity.pauseAdmission()
    try {
      signal.throwIfAborted()
      const records = await query.listSessions()
      signal.throwIfAborted()
      const candidates: SessionId[] = []
      for (const record of records) {
        signal.throwIfAborted()
        if (record.header.origin === 'subagent') continue
        const live = this.ctx.sessions.get(record.header.id)
        let values
        let preset: string | undefined
        if (live !== undefined) {
          preset = this.currentPreset(live)
          values = this.ctx.sessionProjections.snapshot(live).values
        } else {
          const stored = await query.readSession(record.header.id)
          signal.throwIfAborted()
          values = this.ctx.sessionProjections.restore({}, stored.events, 0, stored.session).snapshot.values
          preset = values.agentPreset ?? stored.session.agentPreset
        }
        if (preset !== 'pactflow' || values.pactflowProject?.project == null) continue
        const activeRuns = Object.values(values.pactflowRuns?.byId ?? {}).some(run => !this.isTerminalRun(run))
        const pendingCleanup = Object.values(values.pactflowDelivery?.cleanups ?? {}).some(record => record.state !== 'succeeded')
        if (activeRuns || pendingCleanup) candidates.push(record.header.id)
        else this.executionCapacity.setInventoryFailure(record.header.id, undefined)
      }
      for (const id of candidates) {
        signal.throwIfAborted()
        const resolved = await controller.resolveAgent(id)
        signal.throwIfAborted()
        if ('error' in resolved) throw new Error(`PactFlow cannot restore Session "${id}": ${resolved.error.message}`)
        const session = resolved.agent.session
        this.reconcileLocalSession(session)
        const running = await this.inventoryK3sSession(session)
        void Promise.all(running).catch(error => this.ctx.logger.warn('PactFlow recovered Session "%s" failed: %s', id, this.boundedOutcome(error)))
        signal.throwIfAborted()
        void this.reconcileCleanups(session).catch(error => this.ctx.logger.warn('PactFlow recovered cleanup "%s" failed: %s', id, this.boundedOutcome(error)))
      }
      signal.throwIfAborted()
      this.executionCapacity.setInventoryFailure('startup', undefined)
    } catch (error) {
      if (!signal.aborted) this.executionCapacity.setInventoryFailure('startup', `PactFlow startup recovery failed: ${this.boundedOutcome(error)}`)
      throw error
    } finally { resumeAdmission() }
  }

  /**
   * Prove Host activation, package-root resolution, Typert transport, and P0 registration.
   * @returns non-secret installation health.
   */
  @Remote('health')
  health(signal?: AbortSignal): PactFlowHealth {
    signal?.throwIfAborted()
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

  /**
   * A05 extension: read-only status of retained failure scenes, flagging overdue
   * ones for review. Never deletes anything — a human decides.
   */
  @Remote('retentionStatus')
  retentionStatus(sessionId: string): PactFlowRetentionSummary {
    const session = this.liveSession(sessionId)
    const delivery = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')
    const capacity = summarizeRetentionCapacity(
      Object.values(delivery?.cleanups ?? {}), PACTFLOW_DEFAULT_RETENTION_BYTES, Date.now(),
    )
    return {
      total: capacity.total,
      overdue: capacity.overdue.map(record => ({
        id: record.id,
        target: String((record as { target?: string }).target ?? ''),
        ...record.retainUntil === undefined ? {} : { retainUntil: record.retainUntil },
      })),
      retainedBytes: capacity.retainedBytes,
      measured: capacity.measured,
      overBudget: capacity.overBudget,
      maxBytes: capacity.maxBytes,
    }
  }

  /**
   * A12: read-only project handover summary. Works for a live or cold session via
   * the same projection snapshot path, and never mutates state — so a project stays
   * explainable (stage, exact Git artifacts, open responsibilities) even if the
   * plugin is never started again.
   */
  @Remote('projectHandover')
  async projectHandover(sessionId: string, signal?: AbortSignal): Promise<PactFlowHandoverSummary> {
    return projectHandoverSummary(await this.snapshot(sessionId, signal) as never, {
      packageVersion: VERSION,
      eventProducerVersion: EVENT_PRODUCER_VERSION,
    })
  }

  /**
   * A12: read-only uninstall drain status. Across every PactFlow session the plugin
   * owns (live or cold), reports non-terminal Runs and unfinished cleanup
   * responsibilities so an operator can decide whether uninstalling now is safe.
   * Never mutates state and never triggers cleanup — there is NO automatic path.
   */
  @Remote('drainStatus')
  async drainStatus(): Promise<PactFlowDrainStatus> {
    const activeRuns: { sessionId: string; runId: string; nodeId: string; state: string }[] = []
    const pendingCleanups: { sessionId: string; id: string; target: string; state: string; retain?: boolean }[] = []
    for (const record of await this.listProjects()) {
      const sessionId = SessionId(record.sessionId)
      const live = this.ctx.sessions.get(sessionId)
      let values
      if (live !== undefined) {
        values = this.ctx.sessionProjections.snapshot(live).values
      } else {
        const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
        if (query === undefined) throw new Error('PactFlow drain status requires sessionQuery')
        const stored = await query.readSession(sessionId)
        values = this.ctx.sessionProjections.restore({}, stored.events, 0, stored.session).snapshot.values
      }
      for (const run of Object.values(values.pactflowRuns?.byId ?? {}) as { id: string; nodeId: string; state: string }[]) {
        if (!this.isTerminalRun(run as never)) {
          activeRuns.push({ sessionId: record.sessionId, runId: String(run.id), nodeId: String(run.nodeId), state: String(run.state) })
        }
      }
      for (const cleanup of Object.values(values.pactflowDelivery?.cleanups ?? {}) as {
        id: string; target: string; state: string; retain?: boolean
      }[]) {
        if (cleanup.state !== 'succeeded') {
          pendingCleanups.push({
            sessionId: record.sessionId, id: String(cleanup.id), target: String(cleanup.target), state: String(cleanup.state),
            ...cleanup.retain === true ? { retain: true } : {},
          })
        }
      }
    }
    activeRuns.sort((left, right) => `${left.sessionId}/${left.runId}`.localeCompare(`${right.sessionId}/${right.runId}`))
    pendingCleanups.sort((left, right) => `${left.sessionId}/${left.id}`.localeCompare(`${right.sessionId}/${right.id}`))
    return { safeToUninstall: activeRuns.length === 0 && pendingCleanups.length === 0, activeRuns, pendingCleanups }
  }

  /**
   * F03 follow-up: report code inputs whose predecessor has since produced a newer
   * successful commit. Read-only — the historical fact that the successor ran on the
   * recorded commit is preserved; a human decides whether to re-run.
   */
  @Remote('staleCodeInputs')
  staleCodeInputs(sessionId: string, nodeId: string): readonly { readonly dependency: string; readonly branch: string; readonly recorded: string; readonly latest: string }[] {
    const session = this.livePactFlowSession(sessionId)
    const node = this.node(session, nodeId)
    const runs = Object.values(this.runState(session))
    const run = runs.filter(candidate => candidate.nodeId === node.id && candidate.git !== undefined)
      .sort((left, right) => right.attempt - left.attempt)[0]
    const recorded = (run?.git?.codeInputs ?? [])
      .filter((input): input is { readonly dependency: string; readonly branch: string; readonly commit: string } =>
        input.dependency !== undefined)
      .map(input => ({ dependency: input.dependency, branch: input.branch, commit: input.commit }))
    if (recorded.length === 0) return []
    const latest = new Map<string, string>()
    for (const dependency of new Set(recorded.map(input => input.dependency))) {
      const latestRun = runs.filter(candidate => candidate.nodeId === dependency
        && candidate.state === 'succeeded' && candidate.gitResult !== undefined)
        .sort((left, right) => right.attempt - left.attempt)[0]
      if (latestRun?.gitResult !== undefined) latest.set(dependency, latestRun.gitResult.commit)
    }
    return staleCodeInputs(recorded, latest)
  }

  /** Validate the Session workspace and bind its credential-free Git identity. */
  @Remote('bindGit')
  async bindGit(sessionId: string, request: BindPactFlowGitRequest): Promise<PactFlowProject> {
    const session = this.livePactFlowSession(sessionId)
    const current = this.requireProject(session)
    this.requireRevision('project', current.id, current.revision, request.expectedRevision)
    const validation = await this.resolveValidationSelection(session, request)
    let inspected = await this.git.inspectBinding(session.header.cwd, request, validation?.commands)
    if (validation !== undefined) {
      inspected = {
        ...inspected,
        validationProfileIds: validation.ids,
        validationProfileRevisions: validation.revisions,
      }
    }
    if (request.giteaProviderId !== undefined && this.infrastructure !== undefined) {
      // Preferred path: the caller names a registered Provider and the Host resolves
      // the endpoint, credential ref, auth mode and repository identity from it.
      const provider = this.infrastructure.giteaProvider(request.giteaProviderId)
      const remoteMatch = this.infrastructure.matchGitea(inspected.remoteUrl)
      if (remoteMatch === undefined || remoteMatch.provider.id !== provider.id) {
        throw new Error('PactFlow Gitea Provider does not match the bound remote repository')
      }
      inspected = {
        ...inspected,
        gitea: {
          baseUrl: provider.baseUrl,
          owner: remoteMatch.owner,
          repo: remoteMatch.repo,
          tokenCredentialRef: provider.tokenCredentialRef,
          ...provider.username === undefined ? {} : { username: provider.username },
        },
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
    } else if (inspected.gitea !== undefined && this.infrastructure !== undefined
      && this.infrastructure.settings.gitProviders.length > 0) {
      // An explicit endpoint + credential combination must resolve to exactly one
      // registered Provider: otherwise a caller could pair a registered credential
      // ref with an unregistered target. When the remote itself already matches a
      // Provider, the explicit fields must agree with that match.
      const endpoint = inspected.gitea.baseUrl.replace(/\/+$/, '')
      const byEndpoint = this.infrastructure.settings.gitProviders.filter(
        provider => provider.baseUrl.replace(/\/+$/, '') === endpoint)
      if (byEndpoint.length !== 1) {
        throw new Error('PactFlow Gitea binding must reference a single registered Git Provider endpoint')
      }
      if (byEndpoint[0]!.tokenCredentialRef !== inspected.gitea.tokenCredentialRef) {
        throw new Error('PactFlow Gitea binding credential reference does not belong to the registered Provider')
      }
      const remoteMatch = this.infrastructure.matchGitea(inspected.remoteUrl)
      if (remoteMatch !== undefined
        && (remoteMatch.provider.baseUrl.replace(/\/+$/, '') !== endpoint
          || remoteMatch.owner !== inspected.gitea.owner || remoteMatch.repo !== inspected.gitea.repo)) {
        throw new Error('PactFlow Gitea binding does not match the bound remote repository')
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
  async verifyGitea(sessionId: string, signal?: AbortSignal): Promise<PactFlowGiteaStatus> {
    signal?.throwIfAborted()
    const session = this.livePactFlowSession(sessionId)
    const git = this.requireProject(session).git ?? this.workspaceGitBinding(await this.workspaceProjectForSession(session))
    if (git?.gitea === undefined) throw new Error('PactFlow project has no Gitea binding')
    const giteaBinding = this.effectiveGiteaBinding(git.gitea)
    const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
    if (credentials === undefined) throw new Error('PactFlow Gitea requires the Credentials service')
    const token = await credentials.resolve(credentialRef(giteaBinding.tokenCredentialRef))
    if (token === undefined) throw new Error('PactFlow Gitea token credential reference is not configured')
    return await this.gitea.verify(giteaBinding, token.value, git.defaultBranch, signal)
  }

  /** Merge verified task branches through a protected Gitea PR and deploy the Need state. */
  @Remote('closeGitNeed')
  async closeGitNeed(
    sessionId: string,
    request: ClosePactFlowNeedRequest,
  ): Promise<ClosePactFlowNeedResult> {
    const session = this.livePactFlowSession(sessionId)
    const project = this.requireProject(session)
    const binding = project.git ?? this.workspaceGitBinding(await this.workspaceProjectForSession(session))
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
    // F04: the verification approval must have bound this exact delivery subject.
    // A change to the task set or a successful commit invalidates the prior approval.
    // F04: the verification approval must have bound this exact delivery subject.
    // A change to the task set or a successful commit invalidates the prior approval.
    const verifiedSubject = this.latestVerificationSubject(session, need.id, need.revision - 1)
    if (verifiedSubject === undefined) {
      throw new Error('PactFlow closing requires a verification approval bound to a delivery subject; re-confirm the reviewed tasks')
    }
    if (verifiedSubject !== pactFlowDeliverySubjectDigest(
      String(session.id), String(need.id),
      expectedTaskRefs.map(ref => ({ remoteRef: ref.remoteRef, commit: ref.expectedCommit })),
    )) {
      throw new Error('PactFlow delivery subject changed after verification approval; re-confirm the reviewed tasks')
    }
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
    const closingInputDigest = createHash('sha256').update(JSON.stringify({
      needId: need.id, revision: need.revision, binding,
      tasks: [...expectedTaskRefs].sort((left, right) => left.remoteRef < right.remoteRef ? -1 : left.remoteRef > right.remoteRef ? 1 : 0),
    }, (_key, value) => value !== null && typeof value === 'object' && !Array.isArray(value)
      ? Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0))
      : value)).digest('hex')
    const priorClosing = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[`cleanup-${need.id}-closing`]
    if (priorClosing !== undefined && (priorClosing.closingInputDigest !== closingInputDigest
      || priorClosing.closing === undefined || priorClosing.target !== `closing:${priorClosing.closing.branch}`)) {
      throw new Error('PactFlow prior closing inputs changed or lack a verified digest; explicit recovery is required')
    }
    const priorPullRequest = priorClosing?.closing === undefined ? undefined : await this.gitea.findPullRequest(
      giteaBinding, giteaToken.value, priorClosing.closing.branch, binding.defaultBranch, priorClosing.closing.commit,
    )
    if (priorPullRequest?.merged === true) {
      await this.git.verifyClosingMerged(
        session.header.cwd, binding, priorClosing!.closing!.commit, gitSecret, priorPullRequest.mergeCommit,
      )
      await this.git.verifyClosingTaskRefs(session.header.cwd, binding, expectedTaskRefs, gitSecret)
    }
    const integration = priorPullRequest?.merged === true ? priorClosing!.closing! : await this.git.prepareClosing(
      session.header.cwd,
      session.id,
      need.id,
      need.revision,
      binding,
      expectedTaskRefs,
      gitSecret,
      await this.assertValidationProfilesCurrent(session, binding),
      priorClosing?.closing,
    )
    if (priorClosing?.closing !== undefined && (priorClosing.closing.commit !== integration.commit
      || priorClosing.closing.branch !== integration.branch || priorClosing.closing.worktreePath !== integration.worktreePath)) {
      throw new Error('PactFlow prior closing integration identity changed')
    }
    const cleanupRecords: PactFlowCleanupRecord[] = [
      { id: `cleanup-${need.id}-closing`, needId: need.id, target: `closing:${integration.branch}`, closing: integration, closingInputDigest, requiresRelease: true, state: 'pending', attempt: 1 },
      ...taskRuns.flatMap(run => [
        ...(run.k3s === undefined ? [] : [{ id: `cleanup-${run.id}-k3s`, needId: need.id, runId: run.id, target: `k3s:${run.k3s.jobName}`, requiresRelease: true, state: 'pending' as const, attempt: 1 }]),
        { id: `cleanup-${run.id}-git`, needId: need.id, runId: run.id, target: `git:${run.git!.branch}`, requiresRelease: true, state: 'pending' as const, attempt: 1 },
      ]),
    ]
    const existingCleanups = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups ?? {}
    for (const record of cleanupRecords) {
      if (existingCleanups[record.id] === undefined) this.appendCleanupRecord(session, record)
    }
    const existingPullRequest = priorPullRequest ?? await this.gitea.findPullRequest(
      giteaBinding, giteaToken.value, integration.branch, binding.defaultBranch, integration.commit,
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
    // F05: the delivery identity is the provider-reported exact merge commit, not
    // the default-branch tip. Revalidate that exact commit before recording.
    const mergeCommit = await this.git.verifyClosingMerged(
      session.header.cwd, binding, integration.commit, gitSecret, merged.mergeCommit,
    )
    await this.git.revalidateMergeCommit(
      session.header.cwd, binding, mergeCommit, gitSecret,
      await this.assertValidationProfilesCurrent(session, binding),
    )
    // F06: if a release was already recorded (crash between the two events), reuse
    // it verbatim and only fill in the missing phase transition.
    const recordedRelease = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.releases[need.id]
    if (recordedRelease !== undefined && recordedRelease.commit !== mergeCommit) {
      throw new Error('PactFlow recorded release does not match the verified merge commit; explicit recovery is required')
    }
    const release: PactFlowRelease = recordedRelease ?? {
      needId: need.id,
      commit: mergeCommit,
      branch: binding.defaultBranch,
      serviceUrl: merged.htmlUrl,
      recordedAt: Date.now(),
    }
    if (recordedRelease === undefined) this.events.append(session, 'pactflow/release-recorded', { v: 1, release })
    const currentNeed = this.need(session, need.id)
    const deployed = currentNeed.phase === 'deployed'
      ? currentNeed
      : this.transitionNeedInSession(session, {
        needId: need.id,
        expectedRevision: currentNeed.revision,
        to: 'deployed',
      })
    const cleanupFailures: string[] = []
    const closingRecord = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[cleanupRecords[0]!.id]
      ?? cleanupRecords[0]!
    if (!await this.continueCleanupRecord(session, closingRecord, async () => {
      await this.git.cleanupClosing(session.header.cwd, integration)
    })) cleanupFailures.push(`closing:${integration.branch}`)
    for (const run of taskRuns) {
      const k3sRecord = cleanupRecords.find(record => record.runId === run.id && record.target.startsWith('k3s'))
      if (run.k3s !== undefined && k3sRecord !== undefined) {
        const persistedK3sRecord = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[k3sRecord.id] ?? k3sRecord
        if (!await this.continueCleanupRecord(session, persistedK3sRecord, async () => {
          await this.workerForRun(run.k3s!).cleanupRun(run.k3s!)
        })) cleanupFailures.push(`k3s:${run.k3s.jobName}`)
      }
      const gitRecord = cleanupRecords.find(record => record.runId === run.id && record.target.startsWith('git'))
      const persistedGitRecord = gitRecord === undefined ? undefined
        : this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[gitRecord.id] ?? gitRecord
      if (persistedGitRecord !== undefined && !await this.continueCleanupRecord(session, persistedGitRecord, async () => {
        await this.git.cleanupTaskRun(
          session.header.cwd, binding, run.git!, await this.resolveGitAuth(run.git!),
          run.gitResult!.commit,
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

  /** Build the dispatch seam host view. */
  private dispatchHost(): DispatchHost {
    return {
      agents: () => this.ctx.get('agents') as AgentRegistry | undefined,
      subagents: () => this.ctx.get('subagents') as SubagentRuntime | undefined,
      events: this.events,
      git: this.git,
      executionCapacity: this.executionCapacity,
      infrastructure: this.infrastructure,
      k3s: this.k3s,
      k3sByPool: this.k3sByPool,
      boundedOutcome: value => this.boundedOutcome(value),
      subagentOutcome: result => this.subagentOutcome(result),
      livePactFlowSession: sessionId => this.livePactFlowSession(sessionId),
      requireProject: session => this.requireProject(session),
      workspaceProjectForSession: session => this.workspaceProjectForSession(session),
      workspaceGitBinding: config => this.workspaceGitBinding(config),
      assertValidationProfilesCurrent: (session, binding) => this.assertValidationProfilesCurrent(session, binding),
      leaseDuration: value => this.leaseDuration(value),
      node: (session, rawId) => this.node(session, rawId),
      requireRevision: (kind, id, current, expected) => this.requireRevision(kind, id, current, expected),
      resolveCredential: (reference, label) => this.resolveCredential(reference, label),
      claimNodeInSession: (session, request, options) => this.claimNodeInSession(session, request, options),
      renewRun: (sessionId, request) => this.renewRun(sessionId, request),
      bindK3sRunInSession: (session, owned, jobUid) => this.bindK3sRunInSession(session, owned, jobUid),
      settleRunInSession: (session, request, gitResult, k3sResult, resultAt) =>
        this.settleRunInSession(session, request, gitResult, k3sResult, resultAt),
      ensureK3sCleanup: (session, run) => this.ensureK3sCleanup(session, run),
      retainLocalFailure: (session, run) => this.retainLocalFailure(session, run),
      resolveGitAuth: spec => this.resolveGitAuth(spec),
      workerForRun: spec => this.workerForRun(spec),
      codeInputCommits: (session, node) => this.codeInputCommits(session, node),
      runCleanupRecorder: k3s => this.runCleanupRecorder(k3s),
      resolveK3sDispatch: (poolId, templateId, modelConnectionId) =>
        this.resolveK3sDispatch(poolId, templateId, modelConnectionId),
      acquireExecutionOrCancel: (session, queueId, workspaceId, policy, profileId, poolId, signal) =>
        this.acquireExecutionOrCancel(session, queueId, workspaceId, policy, profileId, poolId, signal),
      localExecution: (session, request, requiresCwd) => this.localExecution(session, request, requiresCwd),
      executeClaimed: (session, request, execution, claimed, git, externalSignal) =>
        this.executeClaimed(session, request, execution, claimed, git, externalSignal),
    }
  }

  /** Build the recovery seam host view. */
  private recoveryHost(): RecoveryHost {
    const service = this
    return {
      // Lazy so pure helpers (isPermanentK3sError/retryK3sOperation) can run on a
      // host view that is never wired to a live Context.
      get logger() { return service.ctx.logger },
      liveSession: sessionId => service.ctx.sessions.get(sessionId),
      events: this.events,
      git: this.git,
      executionCapacity: this.executionCapacity,
      infrastructure: this.infrastructure,
      k3s: this.k3s,
      reconcilingK3s: this.reconcilingK3s,
      deferredK3s: this.deferredK3s,
      recoveryControllers: this.recoveryControllers,
      inventoriedK3s: this.inventoriedK3s,
      localExpiryTimers: this.localExpiryTimers,
      get recoveryStopped() { return service.recoveryStopped },
      boundedOutcome: value => this.boundedOutcome(value),
      currentPreset: session => this.currentPreset(session),
      reconcileLocalSession: session => this.reconcileLocalSession(session),
      reconcileLocalRun: (session, initial) => this.reconcileLocalRun(session, initial),
      reconcileK3sSession: session => this.reconcileK3sSession(session),
      inventoryK3sSession: session => this.inventoryK3sSession(session),
      reconcileK3sRun: (session, initial) => this.reconcileK3sRun(session, initial),
      reconcileCleanups: session => this.reconcileCleanups(session),
      runState: session => this.runState(session),
      isTerminalRun: run => this.isTerminalRun(run),
      clearLocalExpiryTimer: key => this.clearLocalExpiryTimer(key),
      expireRunInSession: (session, currentRun, outcome, nextNodeState) =>
        this.expireRunInSession(session, currentRun, outcome, nextNodeState),
      workspaceProjectForSession: session => this.workspaceProjectForSession(session),
      workerForRun: spec => this.workerForRun(spec),
      node: (session, rawId) => this.node(session, rawId),
      settleRunInSession: (session, request, gitResult, k3sResult, resultAt) =>
        this.settleRunInSession(session, request, gitResult, k3sResult, resultAt),
      ensureK3sCleanup: (session, run) => this.ensureK3sCleanup(session, run),
      retryK3sOperation: (operation, signal) => this.retryK3sOperation(operation, signal),
      renewRun: (sessionId, request) => this.renewRun(sessionId, request),
      deferK3sRecovery: (session, run, release, attempt) => this.deferK3sRecovery(session, run, release, attempt),
      backoff: (delayMs, signal) => this.backoff(delayMs, signal),
      isPermanentK3sError: error => this.isPermanentK3sError(error),
      resolveGitAuth: spec => this.resolveGitAuth(spec),
      assertValidationProfilesCurrent: (session, binding) => this.assertValidationProfilesCurrent(session, binding),
    }
  }

  /** Build the cleanup seam host view; member routes stay on `this` so overrides win. */
  private cleanupHost(): CleanupHost {
    const service = this
    return {
      events: this.events,
      logger: this.ctx.logger,
      delivery: session => this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery'),
      git: this.git,
      cleanupTimers: this.cleanupTimers,
      activeCleanups: this.activeCleanups,
      get cleanupStopped() { return service.cleanupStopped },
      boundedOutcome: value => this.boundedOutcome(value),
      appendCleanupRecord: (session, record) => this.appendCleanupRecord(session, record),
      scheduleCleanupRetry: (session, record) => this.scheduleCleanupRetry(session, record),
      runCleanupRecord: (session, record, action) => this.runCleanupRecord(session, record, action),
      performCleanupRecord: (session, record, action) => this.performCleanupRecord(session, record, action),
      retryCleanup: (sessionId, request) => this.retryCleanup(sessionId, request),
      cleanupAction: (session, record) => this.cleanupAction(session, record),
      livePactFlowSession: sessionId => this.livePactFlowSession(sessionId),
      requireProject: session => this.requireProject(session),
      workspaceProjectForSession: session => this.workspaceProjectForSession(session),
      workspaceGitBinding: config => this.workspaceGitBinding(config),
      need: (session, rawId) => this.need(session, rawId),
      node: (session, rawId) => this.node(session, rawId),
      runState: session => this.runState(session),
      workerForRun: spec => this.workerForRun(spec),
      resolveGitAuth: spec => this.resolveGitAuth(spec),
    }
  }

  /** Build the probe seam host view. */
  private probeHost(): ProbeRecoveryHost {
    return {
      probeLedger: this.probeLedger,
      runLedger: this.runLedger,
      k3s: this.k3s,
      k3sByPool: this.k3sByPool,
      logger: this.ctx.logger,
      boundedOutcome: value => this.boundedOutcome(value),
    }
  }

  private appendCleanupRecord(session: Session, record: PactFlowCleanupRecord): void {
    appendCleanupRecordImpl(this.cleanupHost(), session, record)
  }

  private scheduleCleanupRetry(session: Session, record: PactFlowCleanupRecord): void {
    scheduleCleanupRetryImpl(this.cleanupHost(), session, record)
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
    return await acquireExecutionOrCancelImpl(this.dispatchHost(), session, queueId, workspaceId, policy, profileId, poolId, signal)
  }

  private async runCleanupRecord(
    session: Session,
    record: PactFlowCleanupRecord,
    action: () => Promise<void>,
  ): Promise<boolean> {
    return await runCleanupRecordImpl(this.cleanupHost(), session, record, action)
  }

  private async performCleanupRecord(
    session: Session,
    record: PactFlowCleanupRecord,
    action: () => Promise<void>,
  ): Promise<boolean> {
    return await performCleanupRecordImpl(this.cleanupHost(), session, record, action)
  }

  private async continueCleanupRecord(
    session: Session,
    record: PactFlowCleanupRecord,
    action: () => Promise<void>,
  ): Promise<boolean> {
    return await continueCleanupRecordImpl(this.cleanupHost(), session, record, action)
  }

  private async ensureK3sCleanup(
    session: Session,
    run: PactFlowRun,
  ): Promise<void> {
    return await ensureK3sCleanupImpl(this.cleanupHost(), session, run)
  }

  /**
   * A05: a failed local run may leave a task branch/worktree behind. Record a
   * discoverable but non-auto-cleaned responsibility so the residue is auditable
   * and never silently deleted (uncommitted work may be worth diagnosing).
   */
  private retainLocalFailure(session: Session, run: PactFlowRun): void {
    if (run.git === undefined) return
    const id = `cleanup-${run.id}-git-retained`
    const existing = this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.cleanups[id]
    if (existing !== undefined) return
    // A bounded measurement so a large residue is accounted for (capacity) without
    // blocking the failure path; never auto-deleted, only surfaced.
    const size = measureRetainedSceneBytes(run.git.worktreePath)
    this.appendCleanupRecord(session, {
      id, runId: run.id, needId: this.node(session, run.nodeId).needId,
      target: `git:${run.git.branch}`, state: 'pending', attempt: 1, retain: true,
      // A bounded window so overdue scenes can be surfaced for review; never auto-deleted.
      retainUntil: Date.now() + PACTFLOW_DEFAULT_RETENTION_MS,
      sizeBytes: size.bytes,
    })
  }

  /** Persist one probe's cleanup responsibility under its provider connection identity. */
  private probeCleanupRecorder(
    worker: PactFlowK3sWorker,
    kind: 'harness' | 'api' | 'image',
  ): PactFlowProbeCleanupRecorder {
    return probeCleanupRecorderImpl(this.probeHost(), worker, kind)
  }

  /** Persist one Run's creation intent/confirmation under its provider connection identity. */
  private runCleanupRecorder(k3s: PactFlowK3sWorker): PactFlowRunCleanupRecorder {
    const fingerprint = k3s.connectionFingerprint()
    return event => this.runLedger.apply(fingerprint, event)
  }

  /** Reconcile persisted probe cleanup responsibilities with the configured providers. */
  private async reconcileProbeCleanups(): Promise<boolean> {
    return await reconcileProbeCleanupsImpl(this.probeHost())
  }

  /** Explicitly retry one persisted cleanup responsibility after a failed close. */
  @Remote('retryCleanup')
  async retryCleanup(
    sessionId: string,
    request: RetryPactFlowCleanupRequest,
  ): Promise<PactFlowCleanupRecord> {
    return await retryCleanupImpl(this.cleanupHost(), sessionId, request)
  }

  private async cleanupAction(session: Session, record: PactFlowCleanupRecord): Promise<void> {
    return await cleanupActionImpl(this.cleanupHost(), session, record)
  }

  private async reconcileCleanups(session: Session): Promise<void> {
    return await reconcileCleanupsImpl(this.cleanupHost(), session)
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
    const note = pactFlowReviewNote(request.note)
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
      // F04: a verification approval binds the exact delivery subject it approves.
      ...request.kind === 'verification' ? { subjectDigest: this.deliverySubjectDigest(session, need.id) } : {},
      source: request.source,
    }
    this.events.append(session, 'pactflow/review-recorded', { v: 1, review })
    return review
  }

  /** Move a need through exactly one legal phase after CAS and review checks. */
  @Remote('transitionNeed')
  transitionNeed(sessionId: string, request: TransitionPactFlowNeedRequest): PactFlowNeed {
    const session = this.livePactFlowSession(sessionId)
    if (request.to === 'deployed') {
      throw new Error('PactFlow deployment requires verified Git closing')
    }
    return this.transitionNeedInSession(session, request)
  }

  private transitionNeedInSession(session: Session, request: TransitionPactFlowNeedRequest): PactFlowNeed {
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
    const codeInputs = this.codeInputs(dependencies, request.codeInputs)
    const node: PactFlowNode = {
      id,
      needId: need.id,
      title,
      state: this.dependenciesSucceeded(dag, dependencies) ? 'ready' : 'pending',
      revision: 1,
      dependencies,
      ...(codeInputs.length === 0 ? {} : { codeInputs }),
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
    // A11: retries are budgeted. Refuse past the attempt budget with an explicit
    // reason instead of looping indefinitely.
    const nextAttempt = Object.values(this.runState(session))
      .filter(run => run.nodeId === current.id)
      .reduce((maximum, candidate) => Math.max(maximum, candidate.attempt), 0) + 1
    const verdict = evaluateAttemptBudget(this.runBudget.maxAttempts, nextAttempt)
    if (verdict.exhausted) throw new Error(`PactFlow node "${current.id}" exceeded its retry budget: ${verdict.detail}`)
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
    return { byId: this.dagState(session) }
  }

  /** Read one consistent synchronous cut across all PactFlow projections. */
  @Remote('snapshot')
  async snapshot(sessionId: string, signal?: AbortSignal): Promise<PactFlowSnapshot> {
    signal?.throwIfAborted()
    const session = this.ctx.sessions.get(SessionId(sessionId))
    if (session !== undefined) {
      this.requirePactFlowPreset(session)
      this.reconcileLocalSession(session)
      return this.snapshotOfLive(session)
    }
    const query = this.ctx.get('sessionQuery') as SessionQueryEngine | undefined
    if (query === undefined) throw new Error('cold PactFlow snapshots require sessionQuery')
    const stored = await query.readSession(SessionId(sessionId))
    signal?.throwIfAborted()
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
      dag: { byId: this.dagState(session) },
      runs: this.ctx.sessionProjections.stateOf(session, 'pactflowRuns') ?? { byId: {} },
      delivery: pactFlowDeliveryView(this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')
        ?? { reviews: {}, documents: {}, releases: {}, cleanups: {} }),
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
  async workspaceProjectForSessionView(sessionId: string, signal?: AbortSignal): Promise<PactFlowWorkspaceProjectConfig | null> {
    signal?.throwIfAborted()
    const config = await this.workspaceProjectForSession(this.liveSession(sessionId)) ?? null
    signal?.throwIfAborted()
    return config
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
      ...(current?.remoteCreation === undefined ? {} : { remoteCreation: current.remoteCreation }),
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
      ...current,
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
    if (!status.initialized || !status.hasCommit || !status.clean) {
      throw new Error('PactFlow remote creation requires a clean committed repository')
    }
    if (!/^[A-Za-z0-9_.-]{1,100}$/.test(request.owner) || !/^[A-Za-z0-9_.-]{1,100}$/.test(request.repo)) {
      throw new Error('PactFlow Gitea owner or repository name is invalid')
    }
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(request.defaultBranch)) {
      throw new Error('PactFlow default branch is invalid')
    }
    let current = await this.workspaceProjects.get(request.workspaceId)
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const provider = this.infrastructure?.settings.gitProviders.find(item => item.id === request.providerId)
    if (provider === undefined) throw new Error(`PactFlow Gitea provider "${request.providerId}" is not configured`)
    const expectedCommit = await workspaceHeadCommit(workspace.path, request.defaultBranch)
    const providerSnapshot = JSON.stringify(provider)
    const prior = current?.remoteCreation
    if (prior !== undefined) {
      if (prior.providerSnapshot !== providerSnapshot || prior.owner !== request.owner || prior.repo !== request.repo
        || prior.defaultBranch !== request.defaultBranch || prior.private !== request.private
        || prior.expectedCommit !== expectedCommit || current?.workspacePath !== workspace.path) {
        throw new Error('PactFlow remote creation target or Workspace commit changed')
      }
      if (prior.state === 'creating') throw new Error('PactFlow remote creation result is unknown; reconcile the recorded operation before retrying')
      if (status.remoteUrl !== undefined && status.remoteUrl !== prior.cloneUrl) throw new Error('PactFlow Workspace origin changed')
      if (prior.state === 'completed') return current!
    } else if (status.remoteUrl !== undefined || current?.git !== undefined) {
      throw new Error('PactFlow remote creation requires a repository without origin or a prior binding')
    }
    const token = await this.resolveCredential(provider.tokenCredentialRef, 'Gitea password or token')
    if (prior === undefined) {
      const now = Date.now()
      const intent: PactFlowWorkspaceProjectConfig = {
        ...current, schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
        workspacePath: workspace.path, workspaceTitle: workspace.title,
        revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
        remoteCreation: { id: randomUUID(), state: 'creating', providerId: provider.id, providerSnapshot,
          owner: request.owner, repo: request.repo, defaultBranch: request.defaultBranch, private: request.private, expectedCommit },
      }
      if (!await this.workspaceProjects.putIfRevision(request.expectedRevision, intent)) {
        throw new Error('PactFlow Workspace revision changed before remote creation')
      }
      current = intent
      const created = await this.gitea.createRepository(provider.baseUrl, provider.username, token, {
        owner: request.owner, repo: request.repo, private: request.private, defaultBranch: request.defaultBranch,
      })
      const confirmed: PactFlowWorkspaceProjectConfig = { ...current, revision: current.revision + 1, updatedAt: Date.now(),
        remoteCreation: { ...current.remoteCreation!, state: 'created', cloneUrl: created.cloneUrl } }
      if (!await this.workspaceProjects.putIfRevision(current.revision, confirmed)) {
        throw new Error('PactFlow Workspace changed after remote creation; reconcile the recorded operation')
      }
      current = confirmed
    }
    const operation = current!.remoteCreation!
    await attachAndPushWorkspaceRemote(
      workspace.path, operation.cloneUrl!, provider.username ?? request.owner, token,
      operation.defaultBranch, operation.expectedCommit,
    )
    const now = Date.now()
    const config: PactFlowWorkspaceProjectConfig = {
      ...current,
      schema: 'dsh_pactflow_workspace_project/v1', workspaceId: request.workspaceId,
      workspacePath: workspace.path, workspaceTitle: workspace.title,
      revision: (current?.revision ?? 0) + 1, createdAt: current?.createdAt ?? now, updatedAt: now,
      git: {
        remote: 'origin', remoteUrl: operation.cloneUrl!, defaultBranch: request.defaultBranch,
        giteaProviderId: provider.id, owner: request.owner, repo: request.repo, boundAt: now,
      },
      ...(current?.worker === undefined ? {} : { worker: current.worker }),
      ...(current?.validationProfiles === undefined ? {} : { validationProfiles: current.validationProfiles }),
      ...(current?.validationProfileIds === undefined ? {} : { validationProfileIds: current.validationProfileIds }),
      validationCommands: current?.validationCommands ?? [],
      remoteCreation: { ...operation, state: 'completed' },
    }
    if (!await this.workspaceProjects.putIfRevision(current!.revision, config)) {
      throw new Error('PactFlow Workspace project revision changed while creating the remote')
    }
    return config
  }

  /** Read-only candidates for one unknown-result remote creation; nothing is persisted here. */
  @Remote('listWorkspaceRemoteCandidates')
  async listWorkspaceRemoteCandidates(workspaceId: string): Promise<PactFlowRemoteReconciliation> {
    const this_workspace = await this.requireCreatingIntent(workspaceId)
    const { provider, intent } = this_workspace
    const token = await this.resolveCredential(provider.tokenCredentialRef, 'Gitea password or token')
    const candidates = await this.gitea.listCandidateRepositories(provider.baseUrl, provider.username, token,
      { owner: intent.owner, repo: intent.repo })
    return {
      intent: { owner: intent.owner, repo: intent.repo, defaultBranch: intent.defaultBranch,
        private: intent.private, operationId: intent.id },
      candidates: candidates.map(candidate => ({
        ...candidate,
        matches: {
          exactName: candidate.fullName === `${intent.owner}/${intent.repo}`,
          defaultBranch: candidate.defaultBranch === intent.defaultBranch,
          private: candidate.private === intent.private,
          descriptionClue: candidate.description.includes(intent.id),
        },
      })),
    }
  }

  /** Persist one user-confirmed repository as the creation result only after an exact id re-check. */
  @Remote('confirmWorkspaceRemoteCandidate')
  async confirmWorkspaceRemoteCandidate(request: PactFlowConfirmWorkspaceRemoteRequest): Promise<PactFlowWorkspaceProjectConfig> {
    const current_workspace = await this.requireCreatingIntent(request.workspaceId)
    const { provider, intent, current } = current_workspace
    this.requireWorkspaceProjectRevision(current, request.expectedRevision)
    const token = await this.resolveCredential(provider.tokenCredentialRef, 'Gitea password or token')
    const repository = await this.gitea.getRepositoryById(provider.baseUrl, provider.username, token, request.repoId)
    if (repository.fullName !== `${intent.owner}/${intent.repo}`) {
      throw new Error(`PactFlow confirmed repository "${repository.fullName}" does not match the recorded creation owner and name`)
    }
    if (repository.private !== intent.private) {
      throw new Error('PactFlow confirmed repository visibility does not match the recorded creation intent')
    }
    if (repository.defaultBranch !== intent.defaultBranch) {
      throw new Error('PactFlow confirmed repository default branch does not match the recorded creation intent')
    }
    const confirmed: PactFlowWorkspaceProjectConfig = { ...current, revision: current.revision + 1,
      updatedAt: Date.now(), remoteCreation: { ...intent, state: 'created', cloneUrl: repository.cloneUrl } }
    if (!await this.workspaceProjects.putIfRevision(current.revision, confirmed)) {
      throw new Error('PactFlow Workspace revision changed during remote creation reconciliation')
    }
    return confirmed
  }

  private async requireCreatingIntent(workspaceId: string): Promise<{
    readonly current: PactFlowWorkspaceProjectConfig
    readonly intent: PactFlowRemoteCreation
    readonly provider: { readonly id: string; readonly baseUrl: string; readonly username?: string; readonly tokenCredentialRef: string }
  }> {
    this.requireWorkspace(workspaceId)
    const current = await this.workspaceProjects.get(workspaceId)
    const intent = current?.remoteCreation
    if (intent === undefined || intent.state !== 'creating') {
      throw new Error('PactFlow Workspace has no unknown-result remote creation to reconcile')
    }
    const provider = JSON.parse(intent.providerSnapshot) as { id?: unknown; baseUrl?: unknown; username?: unknown; tokenCredentialRef?: unknown }
    if (provider.id !== intent.providerId || typeof provider.baseUrl !== 'string' || provider.baseUrl === ''
      || typeof provider.tokenCredentialRef !== 'string' || provider.tokenCredentialRef === ''
      || (provider.username !== undefined && typeof provider.username !== 'string')) {
      throw new Error('PactFlow recorded creation provider snapshot is invalid; explicit recovery is required')
    }
    return {
      current: current!,
      intent,
      provider: { id: provider.id as string, baseUrl: provider.baseUrl,
        ...(provider.username === undefined ? {} : { username: provider.username as string }),
        tokenCredentialRef: provider.tokenCredentialRef },
    }
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
      ...current,
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
      ...current,
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
  listK3sTemplates(signal?: AbortSignal): readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[] {
    signal?.throwIfAborted()
    return this.infrastructure?.listTemplates() ?? this.k3s?.listTemplates() ?? []
  }

  /**
   * A10: the declared capability profile of each configured Harness (protocol,
   * structured output, highest supported level). This is the queryable form of the
   * declaration, so a capability claim is inspectable rather than implicit.
   */
  @Remote('harnessCapabilities')
  listHarnessCapabilities(signal?: AbortSignal): readonly PactFlowHarnessCapabilityView[] {
    signal?.throwIfAborted()
    const templates = this.infrastructure?.listTemplates() ?? this.k3s?.listTemplates() ?? []
    const seen = new Set<string>()
    const views: PactFlowHarnessCapabilityView[] = []
    for (const template of templates) {
      if (seen.has(template.id)) continue
      seen.add(template.id)
      const profile = harnessCapabilityProfile(template.harness)
      views.push({
        templateId: template.id,
        harness: profile.harness,
        apiMode: profile.apiMode,
        structuredOutput: profile.structuredOutput,
        maxLevel: profile.maxLevel,
      })
    }
    return views
  }

  /** List model endpoints independently selectable from compatible Harness profiles. */
  @Remote('listModelConnections')
  listModelConnections(signal?: AbortSignal): readonly PactFlowModelConnectionSettings[] {
    signal?.throwIfAborted()
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
  listWorkerPools(signal?: AbortSignal): readonly PactFlowWorkerPoolStatus[] {
    signal?.throwIfAborted()
    return this.infrastructure?.statuses().map(status => ({
      ...status, waiting: status.waiting + this.executionCapacity.waiting(status.id),
    })) ?? []
  }

  /** Run one real, read-only infrastructure connection probe with bounded stage evidence. */
  @Remote('probeInfrastructure')
  async probeInfrastructure(request: PactFlowInfrastructureProbeRequest, signal?: AbortSignal): Promise<PactFlowInfrastructureProbeResult> {
    signal?.throwIfAborted()
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
              signal?.throwIfAborted()
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
            signal?.throwIfAborted()
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
              const probe = await worker.probeImage(template.id, 180_000, signal, this.probeCleanupRecorder(worker, 'image'))
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
      signal?.throwIfAborted()
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
  async probeHarness(request: PactFlowHarnessProbeRequest, signal?: AbortSignal): Promise<PactFlowHarnessProbeResult> {
    signal?.throwIfAborted()
    const resolved = this.resolveK3sDispatch(undefined, request.templateId, request.modelConnectionId)
    const worker = resolved.worker
    await worker.preflight()
    const apiKey = resolved.modelConnection === undefined
      ? undefined
      : await this.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
    return await worker.probe(resolved.executionTemplateId, request.prompt, request.timeoutMs, apiKey, signal,
      this.probeCleanupRecorder(worker, 'harness'))
  }

  /** Run one direct API protocol probe with a visible redacted request payload. */
  @Remote('probeApi')
  async probeApi(request: PactFlowHarnessProbeRequest, signal?: AbortSignal): Promise<PactFlowApiProbeResult> {
    signal?.throwIfAborted()
    const resolved = this.resolveK3sDispatch(undefined, request.templateId, request.modelConnectionId)
    const worker = resolved.worker
    await worker.preflight()
    const apiKey = resolved.modelConnection === undefined
      ? undefined
      : await this.resolveCredential(resolved.modelConnection.apiKeyCredentialRef, 'model API key')
    return await worker.probeApi(resolved.executionTemplateId, request.prompt, request.timeoutMs, apiKey, signal,
      this.probeCleanupRecorder(worker, 'api'))
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
    return await dispatchK3sNodeWithSignalImpl(this.dispatchHost(), sessionId, request, signal)
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
    return await dispatchGitNodeWithSignalImpl(this.dispatchHost(), sessionId, request, signal)
  }

  /** Resolve the live parent and selected Provider before a node is claimed. */
  private localExecution(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    requiresCwd: boolean,
  ): PactFlowLocalExecution {
    return localExecutionImpl(this.dispatchHost(), session, request, requiresCwd)
  }

  /** Execute one already claimed Run and converge its Subagent and Git outcomes. */
  private async executeClaimed(
    session: Session,
    request: DispatchPactFlowLocalNodeRequest,
    execution: PactFlowLocalExecution,
    claimed: PactFlowClaimResult,
    git?: PactFlowGitRunSpec,
    externalSignal?: AbortSignal,
  ): Promise<PactFlowClaimResult> {
    return await executeClaimedImpl(this.dispatchHost(), session, request, execution, claimed, git, externalSignal)
  }

  /** Build the restart-applied K3s provider from validated non-secret settings. */
  private k3sFrom(config: false | PactFlowK3sConfig | undefined): PactFlowK3sWorker | undefined {
    return k3sFromImpl(config)
  }

  private infrastructureFrom(
    config: false | PactFlowInfrastructureSettings | undefined,
  ): PactFlowInfrastructure | undefined {
    return infrastructureFromImpl(config)
  }

  private requireInfrastructure(): PactFlowInfrastructure {
    if (this.infrastructure === undefined) throw new Error('PactFlow infrastructure is not configured')
    return this.infrastructure
  }

  private rebuildPoolWorkers(): void {
    rebuildPoolWorkersImpl(this.infrastructure, this.k3sByPool)
  }

  private resolveK3sDispatch(
    poolId: string | undefined,
    templateId: string,
    modelConnectionId?: string,
  ): K3sDispatchRoute {
    return resolveK3sDispatchImpl(this.dispatchHost(), poolId, templateId, modelConnectionId)
  }

  private workerForRun(spec: PactFlowK3sRunSpec): PactFlowK3sWorker {
    return workerForRunImpl(this.dispatchHost(), spec)
  }

  /**
   * F03: the exact successful commits of a node's code-input dependencies, in a
   * stable order. Each is the newest succeeded Run's Git result for that node.
   */
  private codeInputCommits(session: Session, node: PactFlowNode): readonly { readonly dependency: string; readonly branch: string; readonly commit: string }[] {
    const codeInputs = node.codeInputs ?? []
    if (codeInputs.length === 0) return []
    const runs = Object.values(this.runState(session))
    return [...codeInputs].sort().flatMap((dependency) => {
      const run = runs.filter(candidate => candidate.nodeId === dependency
        && candidate.state === 'succeeded' && candidate.gitResult !== undefined)
        .sort((left, right) => right.attempt - left.attempt)[0]
      if (run?.gitResult === undefined) {
        throw new Error(`PactFlow code input node "${dependency}" has no verified successful commit`)
      }
      return [{ dependency: String(dependency), branch: run.gitResult.remoteRef, commit: run.gitResult.commit }]
    })
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
    const normalizedBaseUrl = binding.baseUrl.replace(/\/$/, '')
    const provider = this.infrastructure?.settings.gitProviders.find(candidate =>
      candidate.baseUrl.replace(/\/$/, '') === normalizedBaseUrl
      && candidate.tokenCredentialRef === binding.tokenCredentialRef)
    // A historical binding whose endpoint + credential ref does not correspond to a
    // registered Provider must not be trusted with a credential: it stays
    // read-only/blocked until the user re-confirms a registered Provider.
    if (provider === undefined && this.infrastructure !== undefined
      && this.infrastructure.settings.gitProviders.length > 0) {
      throw new Error('PactFlow Gitea binding does not correspond to a registered Git Provider; re-confirm the provider before use')
    }
    if (binding.username !== undefined) return binding
    return provider?.username === undefined ? binding : { ...binding, username: provider.username }
  }

  /** Reconcile provider-specific Run ownership when one PactFlow Agent becomes live. */
  private async reconcileSessionRuns(session: Session): Promise<void> {
    return await reconcileSessionRunsImpl(this.recoveryHost(), session)
  }

  /** Schedule or settle nonterminal local Runs whose in-memory Worker cannot survive a cold restart. */
  private reconcileLocalSession(session: Session): void {
    reconcileLocalSessionImpl(this.recoveryHost(), session)
  }

  private reconcileLocalRun(session: Session, initial: PactFlowRun): void {
    reconcileLocalRunImpl(this.recoveryHost(), session, initial)
  }

  private clearLocalExpiryTimer(key: string): void {
    clearLocalExpiryTimerImpl(this.recoveryHost(), key)
  }

  /** Reattach every nonterminal K3s Run when its PactFlow Agent becomes live. */
  private async reconcileK3sSession(session: Session): Promise<void> {
    return await reconcileK3sSessionImpl(this.recoveryHost(), session)
  }

  private async inventoryK3sSession(session: Session): Promise<Promise<void>[]> {
    return await inventoryK3sSessionImpl(this.recoveryHost(), session)
  }

  private async reconcileK3sRun(session: Session, initial: PactFlowRun): Promise<void> {
    return await reconcileK3sRunImpl(this.recoveryHost(), session, initial)
  }

  private deferK3sRecovery(session: Session, run: PactFlowRun, release: () => void, attempt: number): void {
    deferK3sRecoveryImpl(this.recoveryHost(), session, run, release, attempt)
  }

  private async retryK3sOperation<T>(
    operation: () => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    return await retryK3sOperationImpl(this.recoveryHost(), operation, signal)
  }

  private async backoff(delayMs: number, signal?: AbortSignal): Promise<void> {
    return await backoffImpl(delayMs, signal)
  }

  private isPermanentK3sError(error: unknown): boolean {
    return isPermanentK3sErrorImpl(this.recoveryHost(), error)
  }

  /** Record scheduler-owned expiry; this is not a late Worker result. */
  private expireRunInSession(
    session: Session,
    currentRun: PactFlowRun,
    outcome: string,
    nextNodeState: 'failed' | 'ready' = 'failed',
  ): PactFlowClaimResult {
    return expireRunInSessionImpl(this.recoveryHost(), session, currentRun, outcome, nextNodeState)
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
    if ((request.validationCommands?.length ?? 0) > 0) throw new Error('PactFlow raw validation commands are not allowed; select registered profile IDs')
    if (request.validationProfileIds === undefined) return undefined
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
    binding: Pick<PactFlowGitRunSpec, 'validationCommands' | 'validationProfileIds' | 'validationProfileRevisions' | 'legacyUntrusted'>,
  ): Promise<readonly PactFlowValidationProfile[]> {
    if (binding.validationProfileIds === undefined || binding.validationProfileIds.length === 0) {
      assertPactFlowValidationAuthorization(binding, [])
      return []
    }
    const config = await this.workspaceProjectForSession(session)
    const profiles = new Map((config?.validationProfiles ?? []).map(profile => [profile.id, profile]))
    const selected: PactFlowValidationProfile[] = []
    for (const id of binding.validationProfileIds) {
      const profile = profiles.get(id)
      const expected = binding.validationProfileRevisions?.[id]
      if (profile === undefined || expected === undefined || profile.revision !== expected) {
        throw new Error(`PactFlow validation profile "${id}" changed after Git binding; rebind the project`)
      }
      selected.push(profile)
    }
    assertPactFlowValidationAuthorization(binding, selected)
    return selected
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
    const prior = new Map(previous.map(profile => [profile.id, profile]))
    return pactFlowValidationProfilesSchema.parse(input.map(candidate => {
      const id = candidate.id.trim()
      const displayName = candidate.displayName.trim()
      const command = candidate.command.trim()
      const existing = prior.get(id)
      if (candidate.revision !== undefined && (!Number.isSafeInteger(candidate.revision)
        || candidate.revision !== (existing?.revision ?? 1))) {
        throw new Error(`PactFlow validation profile "${id}" revision is stale`)
      }
      const unchanged = existing !== undefined && existing.displayName === displayName
        && existing.command === command && existing.timeoutMs === candidate.timeoutMs
        && existing.args.length === candidate.args.length
        && existing.args.every((argument, index) => argument === candidate.args[index])
      return {
        id, displayName, command, args: [...candidate.args], timeoutMs: candidate.timeoutMs,
        revision: unchanged ? existing.revision : (existing?.revision ?? 0) + 1,
      }
    }))
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

  /** Deterministic digest of a Need's current delivery subject (task set + success commits). */
  private deliverySubjectDigest(session: Session, needId: PactFlowNeed['id']): string {
    const nodes = Object.values(this.dagState(session)).filter(node => node.needId === needId)
    const runs = Object.values(this.runState(session))
    const taskRefs = nodes.flatMap((node) => {
      const run = runs.filter(candidate => candidate.nodeId === node.id
        && candidate.state === 'succeeded' && candidate.gitResult !== undefined)
        .sort((left, right) => right.attempt - left.attempt)[0]
      return run?.gitResult === undefined
        ? []
        : [{ remoteRef: run.gitResult.remoteRef, commit: run.gitResult.commit }]
    })
    return pactFlowDeliverySubjectDigest(String(session.id), String(needId), taskRefs)
  }

  /** The subject digest bound by the latest verification approval for one need revision. */
  private latestVerificationSubject(session: Session, needId: PactFlowNeed['id'], needRevision: number): string | undefined {
    const reviews = Object.values(
      this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.reviews ?? {},
    ).filter(review => review.needId === needId && review.kind === 'verification'
      && review.source === 'dsh-approval'
      && review.approvalRequestId !== undefined
      && review.needRevision === needRevision)
      .sort((left, right) => right.recordedAt - left.recordedAt || right.id.localeCompare(left.id))
    const latest = reviews[0]
    return latest?.decision === 'approved' ? latest.subjectDigest : undefined
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

  /** Code-input dependencies must be a subset of declared dependencies (never a new edge). */
  private codeInputs(
    dependencies: readonly PactFlowNode['id'][],
    rawCodeInputs: readonly string[] | undefined,
  ): readonly PactFlowNode['id'][] {
    if (rawCodeInputs === undefined || rawCodeInputs.length === 0) return []
    const codeInputs = rawCodeInputs.map(PactFlowNodeId).sort()
    if (new Set(codeInputs).size !== codeInputs.length) throw new Error('PactFlow node code inputs must be unique')
    for (const codeInput of codeInputs) {
      if (!dependencies.includes(codeInput)) {
        throw new Error(`PactFlow code input "${codeInput}" must also be a declared dependency`)
      }
    }
    return codeInputs
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
    // Redact first, then truncate: truncating first could keep a credential prefix.
    const redacted = redactUrlCredentials(rendered)
    // A11: the log/output byte budget is the single authority for this cap; the
    // fallback keeps prototype-only test doubles (no instance budget) working.
    const budget = this.runBudget?.maxOutputBytes ?? PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes
    return boundOutputToBudget(redacted, budget).text
  }
}

export default PactFlowService
