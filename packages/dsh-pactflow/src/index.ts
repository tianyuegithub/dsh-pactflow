import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle, Session } from '@deepseek-ai/dsh-session'
import type { AgentRegistry } from '@deepseek-ai/dsh-agent'
import type { SessionQueryEngine } from '@deepseek-ai/dsh-session-query'
import type { SubagentResult, SubagentRun, SubagentRuntime } from '@deepseek-ai/dsh-subagent'
import { PACTFLOW_EVENT_TYPES, PACTFLOW_PROJECTIONS } from './domain.ts'
import { PactFlowNeedId, PactFlowNodeId, PactFlowProjectId, PactFlowRunId } from './types.ts'
import type {
  ClaimPactFlowNodeRequest,
  CreatePactFlowNeedRequest,
  CreatePactFlowNodeRequest,
  DispatchPactFlowLocalNodeRequest,
  InitializePactFlowProjectRequest,
  PactFlowClaimResult,
  PactFlowDagProjection,
  PactFlowHealth,
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

const VERSION = '0.1.0'
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

  private readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>

  constructor(ctx: Context) {
    super(ctx, 'pactflow')
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
    const session = this.liveSession(sessionId)
    if (session.header.agentPreset !== 'pactflow') {
      throw new Error(`session "${session.id}" is not composed from the pactflow preset`)
    }
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
      id: PactFlowRunId(`run-${randomUUID()}`),
      nodeId: node.id,
      nodeRevision: node.revision,
      attempt: prior.reduce((maximum, candidate) => Math.max(maximum, candidate.attempt), 0) + 1,
      provider,
      claimId: `claim-${randomUUID()}`,
      state: 'claimed',
      leaseDeadline: now + duration,
      updatedAt: now,
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
    const currentRun = this.run(session, request.runId)
    this.requireClaim(currentRun, request.claimId)
    if (this.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" already has a terminal result`)
    const now = Date.now()
    if (now >= currentRun.leaseDeadline) throw new Error(`PactFlow Run "${currentRun.id}" result arrived after lease expiry`)
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
  snapshot(sessionId: string): PactFlowSnapshot {
    const session = this.livePactFlowSession(sessionId)
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
    const records = (await query.listSessions())
      .filter(record => record.header.agentPreset === 'pactflow')
    return await Promise.all(records.map(async (record): Promise<PactFlowProjectRecord> => {
      const live = this.ctx.sessions.get(record.header.id)
      const project = live === undefined
        ? this.projectFromEvents((await query.readSession(record.header.id)).events)
        : this.ctx.sessionProjections.stateOf(live, 'pactflowProject')?.project ?? null
      return {
        sessionId: record.header.id,
        live: record.live,
        persisted: record.persisted,
        project,
      }
    }))
  }

  /** Claim a node, execute one DSH one-shot Subagent, and settle from its terminal result. */
  @Remote('dispatchLocalNode')
  async dispatchLocalNode(
    sessionId: string,
    request: DispatchPactFlowLocalNodeRequest,
  ): Promise<PactFlowClaimResult> {
    const session = this.livePactFlowSession(sessionId)
    const agents = this.ctx.get('agents') as AgentRegistry | undefined
    const subagents = this.ctx.get('subagents') as SubagentRuntime | undefined
    const parent = agents?.get(session.id)
    if (parent === undefined) throw new Error(`session "${session.id}" has no live parent Agent`)
    if (subagents === undefined) throw new Error('PactFlow local dispatch requires the Subagent runtime')
    if (subagents.getProvider(request.provider) === undefined) {
      throw new Error(`PactFlow Subagent provider "${request.provider}" is not registered`)
    }
    const prompt = request.prompt.trim()
    if (prompt.length === 0) throw new Error('PactFlow local Worker prompt must be non-empty')

    let owned = this.claimNode(sessionId, request)
    const controller = new AbortController()
    let child: SubagentRun
    try {
      child = await subagents.start(request.provider, {
        label: owned.node.title,
        prompt: [{ type: 'text', text: prompt }],
        parent,
        signal: controller.signal,
      })
    } catch (error) {
      return this.settleRun(sessionId, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: this.boundedOutcome(error),
      })
    }
    owned = this.renewRun(sessionId, {
      runId: owned.run.id,
      claimId: owned.run.claimId,
      leaseDurationMs: request.leaseDurationMs,
    })
    const renewEvery = Math.max(1_000, Math.floor(request.leaseDurationMs / 2))
    const timer = setInterval(() => {
      try {
        owned = this.renewRun(sessionId, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          leaseDurationMs: request.leaseDurationMs,
        })
      } catch {
        controller.abort('PactFlow lease renewal failed')
      }
    }, renewEvery)
    try {
      let result: SubagentResult
      try {
        result = await child.result
      } catch (error) {
        clearInterval(timer)
        return this.settleRun(sessionId, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: this.boundedOutcome(error),
        })
      }
      return this.settleRun(sessionId, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: result.stopReason === 'completed'
          ? 'succeeded'
          : result.stopReason === 'aborted' ? 'cancelled' : 'failed',
        outcome: this.subagentOutcome(result),
      })
    } finally {
      clearInterval(timer)
      await child.dispose()
    }
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
    if (session.header.agentPreset !== 'pactflow') {
      throw new Error(`session "${session.id}" is not composed from the pactflow preset`)
    }
    return session
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

  /** Fold the single immutable project initialization fact from a cold log. */
  private projectFromEvents(events: readonly { readonly type: string; readonly data: unknown }[]): PactFlowProject | null {
    const event = events.find(candidate => candidate.type === 'pactflow/project-initialized')
    if (event === undefined) return null
    const data = event.data as { readonly v?: unknown; readonly project?: PactFlowProject }
    if (data.v !== 1 || data.project === undefined) throw new Error('stored PactFlow project event is unsupported')
    return data.project
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
