import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle, Session } from '@deepseek-ai/dsh-session'
import { PACTFLOW_EVENT_TYPES, PACTFLOW_PROJECTIONS } from './domain.ts'
import { PactFlowNeedId, PactFlowProjectId } from './types.ts'
import type {
  CreatePactFlowNeedRequest,
  InitializePactFlowProjectRequest,
  PactFlowHealth,
  PactFlowNeed,
  PactFlowPhase,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowReview,
  RecordPactFlowReviewRequest,
  TransitionPactFlowNeedRequest,
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
}

export default PactFlowService
