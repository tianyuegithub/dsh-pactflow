import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
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
import { PACTFLOW_EVENT_TYPES, PACTFLOW_EVENT_TYPES_V0_1, PACTFLOW_PROJECTIONS } from './domain.ts'
import { PactFlowGitWorkspace, type PactFlowGitAuthSecret } from './git-workspace.ts'
import {
  PactFlowK3sWorker,
  type PactFlowK3sConfig,
} from './k3s-worker.ts'
import { PactFlowNeedId, PactFlowNodeId, PactFlowProjectId, PactFlowRunId } from './types.ts'
import type {
  BindPactFlowGitRequest,
  ClaimPactFlowNodeRequest,
  CreatePactFlowNeedRequest,
  CreatePactFlowNodeRequest,
  DispatchPactFlowGitNodeRequest,
  DispatchPactFlowK3sNodeRequest,
  DispatchPactFlowLocalNodeRequest,
  InitializePactFlowProjectRequest,
  PactFlowClaimResult,
  PactFlowDagProjection,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowHealth,
  PactFlowHarnessTemplateView,
  PactFlowHarnessProbeRequest,
  PactFlowHarnessProbeResult,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowNeed,
  PactFlowNode,
  PactFlowPhase,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowProjectRecord,
  PactFlowSnapshot,
  PactFlowReview,
  PactFlowRun,
  RecordPactFlowReviewRequest,
  RenewPactFlowRunRequest,
  SettlePactFlowRunRequest,
  TransitionPactFlowNeedRequest,
  UpdatePactFlowNodeDependenciesRequest,
} from './types.ts'

export type { PactFlowHealth } from './types.ts'

export interface Config {
  readonly k3s?: false | PactFlowK3sConfig
}

const VERSION = '0.2.0'
const PRESET_ROOT = fileURLToPath(new URL('../presets', import.meta.url))
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
  })

  private readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>
  private readonly git = new PactFlowGitWorkspace()
  private readonly k3s: PactFlowK3sWorker | undefined
  private readonly reconcilingK3s = new Set<string>()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx, 'pactflow')
    this.k3s = config.k3s === undefined || config.k3s === false
      ? undefined
      : new PactFlowK3sWorker(config.k3s)
    if (this.k3s !== undefined) {
      ctx.on('agent/created', ({ agent }) => {
        void this.reconcileK3sSession(agent.session).catch((error: unknown) => {
          ctx.logger.warn('PactFlow K3s recovery failed for session "%s": %s', agent.id, this.boundedOutcome(error))
        })
      })
    }
    ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: '0.1.0',
      eventTypes: PACTFLOW_EVENT_TYPES_V0_1,
      mode: 'read-only',
    })
    this.events = ctx.sessions.externalEventProducers.register({
      producer: 'dsh-pactflow',
      version: VERSION,
      eventTypes: PACTFLOW_EVENT_TYPES,
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
    const inspected = await this.git.inspectBinding(session.header.cwd, request)
    if (inspected.auth !== undefined) {
      const credentials = this.ctx.get('credentials') as CredentialProvider | undefined
      if (credentials === undefined) throw new Error('PactFlow Git authentication requires the Credentials service')
      const info = await credentials.describe(credentialRef(inspected.auth.credentialRef))
      if (!info.configured) throw new Error('PactFlow Git credential reference is not configured')
    }
    const latest = this.requireProject(session)
    this.requireRevision('project', latest.id, latest.revision, request.expectedRevision)
    const now = Date.now()
    const project: PactFlowProject = {
      ...latest,
      git: { ...inspected, revision: (latest.git?.revision ?? 0) + 1, boundAt: now },
      revision: latest.revision + 1,
      updatedAt: now,
    }
    this.events.append(session, 'pactflow/project-configured', { v: 1, project })
    return project
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

  /** Record one human review decision used by a later phase gate. */
  @Remote('recordReview')
  recordReview(sessionId: string, request: RecordPactFlowReviewRequest): PactFlowReview {
    const session = this.livePactFlowSession(sessionId)
    const need = this.need(session, request.needId)
    const note = request.note.trim()
    const review: PactFlowReview = {
      id: `review-${randomUUID()}` as PactFlowReview['id'],
      needId: need.id,
      kind: request.kind,
      decision: request.decision,
      note,
      recordedAt: Date.now(),
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
      delivery: values.pactflowDelivery ?? { reviews: {}, documents: {}, releases: {} },
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
        ?? { reviews: {}, documents: {}, releases: {} },
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

  /** List Host-configured Harness templates without returning Secret values. */
  @Remote('listK3sTemplates')
  listK3sTemplates(): readonly PactFlowHarnessTemplateView[] {
    return this.k3s?.listTemplates() ?? []
  }

  /** Reconcile nonterminal K3s Runs for one live PactFlow Session on demand. */
  @Remote('reconcileK3s')
  async reconcileK3s(sessionId: string): Promise<PactFlowSnapshot> {
    const session = this.livePactFlowSession(sessionId)
    await this.reconcileK3sSession(session)
    return this.snapshotOfLive(session)
  }

  /** Run one real Harness connectivity probe with explicit visible inputs. */
  @Remote('probeHarness')
  async probeHarness(request: PactFlowHarnessProbeRequest): Promise<PactFlowHarnessProbeResult> {
    if (this.k3s === undefined) throw new Error('PactFlow K3s provider is not configured')
    await this.k3s.preflight()
    return await this.k3s.probe(request.templateId, request.prompt, request.timeoutMs)
  }

  /** Run one Git-backed node in a K3s Job and locally verify its pushed commit. */
  @Remote('dispatchK3sNode')
  async dispatchK3sNode(
    sessionId: string,
    request: DispatchPactFlowK3sNodeRequest,
  ): Promise<PactFlowClaimResult> {
    const session = this.livePactFlowSession(sessionId)
    if (this.k3s === undefined) throw new Error('PactFlow K3s provider is not configured')
    const project = this.requireProject(session)
    if (project.git === undefined) throw new Error('PactFlow project has no Git binding')
    if (project.git.k3sGitSecretName === undefined) {
      throw new Error('PactFlow project has no K3s Git Secret binding')
    }
    const prompt = request.prompt.trim()
    const leaseDurationMs = this.leaseDuration(request.leaseDurationMs)
    const node = this.node(session, request.nodeId)
    this.requireRevision('node', node.id, node.revision, request.expectedRevision)
    if (node.state !== 'ready') throw new Error(`PactFlow node "${node.id}" is not ready`)
    await this.k3s.preflight()
    const runId = PactFlowRunId(`run-${randomUUID()}`)
    const git = await this.git.plan(session.header.cwd, session.id, runId, node, project.git)
    this.k3s.preflightRun(git, prompt)
    const k3s = this.k3s.plan(runId, request.templateId, project.git.k3sGitSecretName, leaseDurationMs)
    this.requireRevision('project', project.id, this.requireProject(session).revision, project.revision)
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
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      owned = this.renewRun(session.id, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        leaseDurationMs,
      })
      timer = setInterval(() => {
        try {
          owned = this.renewRun(session.id, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            leaseDurationMs,
          })
        } catch {
          controller.abort('PactFlow K3s lease renewal failed')
        }
      }, Math.max(1_000, Math.floor(leaseDurationMs / 2)))
      let remoteResult: PactFlowK3sResult
      try {
        remoteResult = await this.k3s.run(k3s, git, prompt, controller.signal)
        if (remoteResult.branch !== git.branch) throw new Error('PactFlow K3s Worker returned another branch')
      } catch (error) {
        return this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: controller.signal.aborted ? 'cancelled' : 'failed',
          outcome: this.boundedOutcome(error),
        })
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
        return this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: this.boundedOutcome(error),
        })
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
    const session = this.livePactFlowSession(sessionId)
    const execution = this.localExecution(session, request, true)
    const project = this.requireProject(session)
    if (project.git === undefined) throw new Error('PactFlow project has no Git binding')
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
    return await this.executeClaimed(session, request, execution, owned, git)
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
  ): Promise<PactFlowClaimResult> {
    let owned = claimed
    const controller = new AbortController()
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
      await child.dispose()
    }
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

  /** Reattach every nonterminal K3s Run when its PactFlow Agent becomes live. */
  private async reconcileK3sSession(session: Session): Promise<void> {
    if (this.k3s === undefined || this.currentPreset(session) !== 'pactflow') return
    const runs = Object.values(this.runState(session))
      .filter(run => !this.isTerminalRun(run) && run.k3s !== undefined && run.git !== undefined)
    await Promise.all(runs.map(run => this.reconcileK3sRun(session, run)))
  }

  private async reconcileK3sRun(session: Session, initial: PactFlowRun): Promise<void> {
    if (this.k3s === undefined || initial.k3s === undefined || initial.git === undefined) return
    const key = `${session.id}:${initial.id}`
    if (this.reconcilingK3s.has(key)) return
    this.reconcilingK3s.add(key)
    const controller = new AbortController()
    let timer: ReturnType<typeof setInterval> | undefined
    try {
      let owned = { run: initial, node: this.node(session, initial.nodeId) }
      let observation = await this.k3s.observe(initial.k3s)
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
          await this.k3s.cancelRun(initial.k3s)
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
            owned = this.renewRun(session.id, {
              runId: owned.run.id,
              claimId: owned.run.claimId,
              leaseDurationMs,
            })
          } catch {
            controller.abort('PactFlow recovered K3s lease renewal failed')
          }
        }, Math.max(1_000, Math.floor(leaseDurationMs / 2)))
        try {
          const result = await this.k3s.waitExisting(initial.k3s, controller.signal)
          observation = { state: 'succeeded', result }
        } catch (error) {
          if (Date.now() >= owned.run.leaseDeadline) {
            this.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
          } else {
            this.settleRunInSession(session, {
              runId: owned.run.id,
              claimId: owned.run.claimId,
              expectedNodeRevision: owned.node.revision,
              state: controller.signal.aborted ? 'cancelled' : 'failed',
              outcome: this.boundedOutcome(error),
            })
          }
          return
        }
      }
      if (observation.state === 'failed') {
        if (observation.finishedAt >= owned.run.leaseDeadline) {
          this.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
          return
        }
        this.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: observation.outcome,
        }, undefined, undefined, observation.finishedAt)
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
      const gitResult = await this.git.acceptRemoteResult(
        session.header.cwd,
        initial.git,
        remoteResult.commit,
        await this.resolveGitAuth(initial.git),
      )
      this.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'succeeded',
        outcome: `Recovered K3s Worker ${remoteResult.podName} committed ${remoteResult.commit}`,
      }, gitResult, remoteResult, remoteResult.finishedAt)
    } finally {
      if (timer !== undefined) clearInterval(timer)
      this.reconcilingK3s.delete(key)
    }
  }

  /** Record scheduler-owned expiry; this is not a late Worker result. */
  private expireRunInSession(session: Session, currentRun: PactFlowRun, outcome: string): PactFlowClaimResult {
    if (this.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" is already terminal`)
    const now = Date.now()
    if (now < currentRun.leaseDeadline) throw new Error(`PactFlow Run "${currentRun.id}" lease is still active`)
    const currentNode = this.node(session, currentRun.nodeId)
    if (currentNode.revision !== currentRun.nodeRevision) {
      throw new Error(`PactFlow Run "${currentRun.id}" expiry targets a stale node revision`)
    }
    const node: PactFlowNode = {
      ...currentNode, state: 'failed', revision: currentNode.revision + 1, updatedAt: now,
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

  /** Require the root project projection. */
  private requireProject(session: Session): PactFlowProject {
    const project = this.ctx.sessionProjections.stateOf(session, 'pactflowProject')?.project
    if (project === null || project === undefined) throw new Error(`session "${session.id}" has no initialized PactFlow project`)
    return project
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
  ): boolean {
    const reviews = Object.values(
      this.ctx.sessionProjections.stateOf(session, 'pactflowDelivery')?.reviews ?? {},
    ).filter(review => review.needId === needId && review.kind === kind)
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
