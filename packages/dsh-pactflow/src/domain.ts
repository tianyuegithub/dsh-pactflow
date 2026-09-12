import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { SessionEventMap } from '@deepseek-ai/dsh-session/types'
import type {
  PactFlowDagProjection,
  PactFlowDagState,
  PactFlowDeliveryProjection,
  PactFlowDeliveryState,
  PactFlowDocument,
  PactFlowGitBinding,
  PactFlowGitAuth,
  PactFlowGiteaBinding,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowNeed,
  PactFlowPhase,
  PactFlowNeedsProjection,
  PactFlowNode,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowCleanupRecord,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowRelease,
  PactFlowReview,
  PactFlowRun,
  PactFlowRunsProjection,
  PactFlowValidationCommand,
  PactFlowValidationEvidence,
} from './types.ts'
import { pactFlowSchema, pactFlowIdSchema, parsePactFlowVersionedPayload } from './schema.ts'

/** One phase contract shared by live commands and persisted event replay. */
export const PACTFLOW_NEXT_PHASE: Readonly<Partial<Record<PactFlowPhase, PactFlowPhase>>> = {
  backlog: 'discussion', discussion: 'confirmed', confirmed: 'design', design: 'planning',
  planning: 'executing', executing: 'code_review', code_review: 'verification', verification: 'closing', closing: 'deployed',
}

function samePersistedValue(left: unknown, right: unknown): boolean {
  const canonical = (value: unknown): string | undefined => JSON.stringify(value, (_key, field) =>
    field !== null && typeof field === 'object' && !Array.isArray(field)
      ? Object.fromEntries(Object.entries(field).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : field)
  return canonical(left) === canonical(right)
}

function cleanupIdentity(record: PactFlowCleanupRecord): Record<string, unknown> {
  // `retainUntil`/`sizeBytes` are mutable retention annotations, not part of resource identity.
  return Object.fromEntries(Object.entries(record).filter(([key]) => !['state', 'attempt', 'error', 'nextRetryAt', 'retainUntil', 'sizeBytes'].includes(key)))
}

/** Exact vocabulary written by dsh-pactflow 0.1.0. Never derive this historical tuple. */
export const PACTFLOW_EVENT_TYPES_V0_1 = [
  'pactflow/document-linked',
  'pactflow/need-created',
  'pactflow/need-updated',
  'pactflow/node-created',
  'pactflow/node-updated',
  'pactflow/phase-transitioned',
  'pactflow/project-initialized',
  'pactflow/release-recorded',
  'pactflow/review-recorded',
  'pactflow/run-claimed',
  'pactflow/run-renewed',
  'pactflow/run-settled',
] as const

/** Exact vocabulary written by dsh-pactflow 0.2.0. Never derive this historical tuple. */
export const PACTFLOW_EVENT_TYPES_V0_2 = [
  'pactflow/document-linked',
  'pactflow/need-created',
  'pactflow/need-updated',
  'pactflow/node-created',
  'pactflow/node-updated',
  'pactflow/phase-transitioned',
  'pactflow/project-configured',
  'pactflow/project-initialized',
  'pactflow/release-recorded',
  'pactflow/review-recorded',
  'pactflow/run-claimed',
  'pactflow/run-renewed',
  'pactflow/run-settled',
] as const

/** 0.2.1 changed no event vocabulary; retain it read-only for persisted logs. */
export const PACTFLOW_EVENT_TYPES_V0_2_1 = PACTFLOW_EVENT_TYPES_V0_2

export const PACTFLOW_EVENT_TYPES_V0_3 = [
  'pactflow/cleanup-recorded',
  'pactflow/document-linked',
  'pactflow/need-created',
  'pactflow/need-updated',
  'pactflow/node-created',
  'pactflow/node-updated',
  'pactflow/phase-transitioned',
  'pactflow/project-configured',
  'pactflow/project-initialized',
  'pactflow/release-recorded',
  'pactflow/review-recorded',
  'pactflow/run-bound',
  'pactflow/run-claimed',
  'pactflow/run-queue-cancelled',
  'pactflow/run-queued',
  'pactflow/run-renewed',
  'pactflow/run-settled',
] as const

export const PACTFLOW_EVENT_TYPES = PACTFLOW_EVENT_TYPES_V0_3

const gitAuthSchema = pactFlowSchema<PactFlowGitAuth>(z.object({
  kind: z.literal('https-token'), username: z.string().min(1), credentialRef: z.string().min(1),
}))

const giteaBindingSchema = pactFlowSchema<PactFlowGiteaBinding>(z.object({
  baseUrl: z.string().min(1), owner: z.string().min(1), repo: z.string().min(1),
  tokenCredentialRef: z.string().min(1), username: z.string().min(1).optional(),
}))

const validationCommandSchema = pactFlowSchema<PactFlowValidationCommand>(z.object({
  command: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().positive(),
}))

const validationEvidenceSchema = pactFlowSchema<PactFlowValidationEvidence>(z.object({
  command: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().positive(),
  exitCode: z.literal(0), durationMs: z.number().int().nonnegative(),
  // A03-c: host-owned closing baseline evidence is marked with its source.
  source: z.literal('host-baseline').optional(),
}))

const gitBindingSchema = pactFlowSchema<PactFlowGitBinding>(z.object({
  remote: z.string().min(1), remoteUrl: z.string().min(1), defaultBranch: z.string().min(1),
  revision: z.number().int().positive(), boundAt: z.number().int().nonnegative(), auth: gitAuthSchema.optional(),
  validationCommands: z.array(validationCommandSchema),
  validationProfileIds: z.array(z.string().min(1)).optional(),
  validationProfileRevisions: z.record(z.string(), z.number().int().positive()).optional(),
  legacyUntrusted: z.boolean().optional(),
  k3sGitSecretName: z.string().min(1).optional(),
  gitea: giteaBindingSchema.optional(),
}))

const gitRunSpecSchema = pactFlowSchema<PactFlowGitRunSpec>(z.object({
  remote: z.string().min(1), remoteUrl: z.string().min(1), defaultBranch: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/), branch: z.string().min(1),
  worktreePath: z.string().refine(isAbsolute), auth: gitAuthSchema.optional(),
  codeInputs: z.array(z.object({ dependency: z.string().min(1).optional(), branch: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40,64}$/) })).optional(),
  validationCommands: z.array(validationCommandSchema),
  validationProfileIds: z.array(z.string().min(1)).optional(),
  validationProfileRevisions: z.record(z.string(), z.number().int().positive()).optional(),
  legacyUntrusted: z.boolean().optional(),
}))

const gitResultSchema = pactFlowSchema<PactFlowGitResult>(z.object({
  branch: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  remoteRef: z.string().min(1), syncedAt: z.number().int().nonnegative(),
  validations: z.array(validationEvidenceSchema),
  // Declared so the integrity signal survives the event fold; an undeclared
  // field would be stripped on parse and never readable from the projection.
  validationSensitiveChanges: z.array(z.string().min(1)).optional(),
}))

const k3sRunSpecSchema = pactFlowSchema<PactFlowK3sRunSpec>(z.object({
  workerPoolId: z.string().min(1).optional(), projectConfigRevision: z.number().int().positive().optional(),
  agentProfileId: z.string().min(1).optional(), modelConnectionId: z.string().min(1).optional(),
  ephemeralModelSecret: z.boolean().optional(),
  templateId: z.string().min(1), namespace: z.string().min(1), jobName: z.string().min(1),
  configMapName: z.string().min(1), image: z.string().min(1), imagePullSecret: z.string().min(1),
  harness: z.enum(['claude', 'codex', 'opencode', 'dsh']),
  apiMode: z.enum(['anthropic-messages', 'openai-responses', 'openai-chat-completions']),
  model: z.string().min(1), baseUrl: z.string().min(1),
  modelSecretName: z.string().min(1), gitSecretName: z.string().min(1),
  runNonceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  claimTokenHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  specDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  inputSecretName: z.string().min(1).optional(),
  jobUid: z.string().min(1).optional(),
  expectedBranch: z.string().min(1).optional(),
  expectedBaseCommit: z.string().regex(/^[0-9a-f]{40,64}$/).optional(),
  cpuRequest: z.string().min(1), memoryRequest: z.string().min(1),
  cpuLimit: z.string().min(1), memoryLimit: z.string().min(1),
  activeDeadlineSeconds: z.number().int().positive(),
  finishedJobTtlSeconds: z.number().int().positive(),
}))

const k3sResultSchema = pactFlowSchema<PactFlowK3sResult>(z.object({
  podName: z.string().min(1), exitCode: z.number().int(), commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  branch: z.string().min(1), harnessVersion: z.string(),
  finishedAt: z.number().int().nonnegative(),
  runNonceHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  claimTokenHash: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  specDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}))

const projectSchema = pactFlowSchema<PactFlowProject>(z.object({
  id: pactFlowIdSchema<'project'>(), name: z.string().min(1), revision: z.number().int().positive(),
  workerPoolId: z.string().min(1).optional(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  git: gitBindingSchema.optional(),
}))

const needSchema = pactFlowSchema<PactFlowNeed>(z.object({
  id: pactFlowIdSchema<'need'>(), title: z.string().min(1), description: z.string(),
  phase: z.enum(['backlog', 'discussion', 'confirmed', 'design', 'planning', 'executing', 'code_review', 'verification', 'closing', 'deployed']),
  revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}))

const nodeSchema = pactFlowSchema<PactFlowNode>(z.object({
  id: pactFlowIdSchema<'node'>(), needId: pactFlowIdSchema<'need'>(), title: z.string().min(1),
  state: z.enum(['pending', 'ready', 'claimed', 'running', 'blocked', 'review', 'paused', 'succeeded', 'failed', 'cancelled', 'archived']),
  revision: z.number().int().positive(), dependencies: z.array(pactFlowIdSchema<'node'>()), updatedAt: z.number().int().nonnegative(),
  codeInputs: z.array(pactFlowIdSchema<'node'>()).optional(),
}))

const runSchema = pactFlowSchema<PactFlowRun>(z.object({
  id: pactFlowIdSchema<'run'>(), nodeId: pactFlowIdSchema<'node'>(), nodeRevision: z.number().int().positive(),
  attempt: z.number().int().positive(), provider: z.string().min(1),
  claimId: z.string().min(1),
  state: z.enum(['claimed', 'running', 'blocked', 'succeeded', 'failed', 'cancelled']),
  leaseDeadline: z.number().int().nonnegative(), leaseDurationMs: z.number().int().positive().optional(),
  updatedAt: z.number().int().nonnegative(), outcome: z.string().optional(),
  git: gitRunSpecSchema.optional(), gitResult: gitResultSchema.optional(),
  k3s: k3sRunSpecSchema.optional(), k3sResult: k3sResultSchema.optional(),
}))

const reviewSchema = pactFlowSchema<PactFlowReview>(z.object({
  id: pactFlowIdSchema<'review'>(), needId: pactFlowIdSchema<'need'>(),
  kind: z.enum(['requirement', 'design', 'plan', 'verification', 'code']),
  decision: z.enum(['approved', 'rejected', 'changes-requested']), note: z.string(), recordedAt: z.number().int().nonnegative(),
  approvalRequestId: z.string().min(1).optional(), needRevision: z.number().int().positive().optional(),
  evidenceDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(), source: z.literal('dsh-approval').optional(),
  subjectDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
}))

const documentSchema = pactFlowSchema<PactFlowDocument>(z.object({
  id: pactFlowIdSchema<'document'>(), needId: pactFlowIdSchema<'need'>(),
  kind: z.enum(['requirement', 'design', 'plan', 'review', 'verification', 'release']),
  uri: z.string().min(1), title: z.string().min(1), linkedAt: z.number().int().nonnegative(),
}))

const releaseSchema = pactFlowSchema<PactFlowRelease>(z.object({
  needId: pactFlowIdSchema<'need'>(), commit: z.string().min(1), branch: z.string().min(1),
  serviceUrl: z.string().optional(), recordedAt: z.number().int().nonnegative(),
}))

const cleanupSchema = pactFlowSchema<PactFlowCleanupRecord>(z.object({
  id: z.string().min(1), runId: pactFlowIdSchema<'run'>().optional(), needId: pactFlowIdSchema<'need'>().optional(),
  target: z.string().min(1), state: z.enum(['pending', 'failed', 'succeeded']),
  closing: z.object({ branch: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40,64}$/),
    worktreePath: z.string().refine(isAbsolute),
    baselineValidations: z.array(validationEvidenceSchema).optional() }).optional(),
  requiresRelease: z.boolean().optional(),
  retain: z.boolean().optional(),
  retainUntil: z.number().int().nonnegative().optional(),
  sizeBytes: z.number().int().nonnegative().optional(),
  closingInputDigest: z.string().regex(/^[0-9a-f]{64}$/).optional(),
  attempt: z.number().int().positive(), error: z.string().optional(), nextRetryAt: z.number().int().nonnegative().optional(),
}).refine(value => value.runId !== undefined || value.needId !== undefined, 'cleanup record must reference a Run or Need'))

const projectProjectionSchema = pactFlowSchema<PactFlowProjectProjection>(z.object({ project: projectSchema.nullable() }))
const needsProjectionSchema = pactFlowSchema<PactFlowNeedsProjection>(z.object({ byId: z.record(z.string(), needSchema) }))
const dagProjectionSchema = pactFlowSchema<PactFlowDagProjection>(z.object({ byId: z.record(z.string(), nodeSchema) }))
const dagStateSchema = pactFlowSchema<PactFlowDagState>(z.object({
  byId: z.record(z.string(), nodeSchema), needIds: z.array(pactFlowIdSchema<'need'>()),
}))
const runsProjectionSchema = pactFlowSchema<PactFlowRunsProjection>(z.object({ byId: z.record(z.string(), runSchema) }))
const deliveryProjectionSchema = pactFlowSchema<PactFlowDeliveryProjection>(z.object({
  reviews: z.record(z.string(), reviewSchema),
  documents: z.record(z.string(), documentSchema),
  releases: z.record(z.string(), releaseSchema),
  cleanups: z.record(z.string(), cleanupSchema).default({}),
}))
const deliveryStateSchema = pactFlowSchema<PactFlowDeliveryState>(z.object({
  reviews: z.record(z.string(), reviewSchema), documents: z.record(z.string(), documentSchema),
  releases: z.record(z.string(), releaseSchema), cleanups: z.record(z.string(), cleanupSchema),
  needIds: z.array(pactFlowIdSchema<'need'>()), runNeeds: z.record(z.string(), pactFlowIdSchema<'need'>()),
}))

export function pactFlowDeliveryView(state: PactFlowDeliveryProjection): PactFlowDeliveryProjection {
  return { reviews: state.reviews, documents: state.documents, releases: state.releases, cleanups: state.cleanups }
}

type PactFlowEventType = typeof PACTFLOW_EVENT_TYPES[number]
const eventPayloadSchemas: { readonly [Type in PactFlowEventType]: z.ZodType<SessionEventMap[Type]> } = {
  'pactflow/project-initialized': z.object({ v: z.literal(1), project: projectSchema }),
  'pactflow/project-configured': z.object({ v: z.literal(1), project: projectSchema }),
  'pactflow/need-created': z.object({ v: z.literal(1), need: needSchema }),
  'pactflow/need-updated': z.object({ v: z.literal(1), need: needSchema }),
  'pactflow/phase-transitioned': z.object({
    v: z.literal(1), need: needSchema,
    from: z.enum(['backlog', 'discussion', 'confirmed', 'design', 'planning', 'executing', 'code_review', 'verification', 'closing', 'deployed']),
  }),
  'pactflow/node-created': z.object({ v: z.literal(1), node: nodeSchema }),
  'pactflow/node-updated': z.object({ v: z.literal(1), node: nodeSchema }),
  'pactflow/run-claimed': z.object({ v: z.literal(1), run: runSchema, node: nodeSchema }),
  'pactflow/run-bound': z.object({ v: z.literal(1), run: runSchema, node: nodeSchema }),
  'pactflow/run-renewed': z.object({ v: z.literal(1), run: runSchema, node: nodeSchema }),
  'pactflow/run-settled': z.object({ v: z.literal(1), run: runSchema, node: nodeSchema }),
  'pactflow/document-linked': z.object({ v: z.literal(1), document: documentSchema }),
  'pactflow/review-recorded': z.object({ v: z.literal(1), review: reviewSchema }),
  'pactflow/release-recorded': z.object({ v: z.literal(1), release: releaseSchema }),
  'pactflow/cleanup-recorded': z.object({ v: z.literal(1), record: cleanupSchema }),
  'pactflow/run-queued': z.object({
    v: z.literal(1), queueId: z.string().min(1), sessionId: z.string().min(1),
    nodeId: pactFlowIdSchema<'node'>(), requestedAt: z.number().int().nonnegative(),
  }),
  'pactflow/run-queue-cancelled': z.object({
    v: z.literal(1), queueId: z.string().min(1), reason: z.string().min(1),
    cancelledAt: z.number().int().nonnegative(),
  }),
}

function versioned(event: SessionEvent): void {
  parsePactFlowVersionedPayload(event.data, event.type)
}

/** Parse every PactFlow payload before any projection reads it. */
function parseEventPayload(event: SessionEvent): SessionEvent {
  if (!Object.hasOwn(eventPayloadSchemas, event.type)) return event
  const type = event.type as PactFlowEventType
  const schema = eventPayloadSchemas[type]
  const result = schema.safeParse(event.data)
  if (!result.success) throw new Error(`invalid ${event.type} payload: ${result.error.message}`)
  // The mapped schema table checks each payload type; exact-key selection
  // preserves the event discriminant/payload relationship at runtime.
  return { ...event, type, data: result.data } as SessionEvent
}

export const pactflowProjectProjection: ProjectionDefinition<'pactflowProject'> = {
  key: 'pactflowProject', stateVersion: 3, stateSchema: projectProjectionSchema,
  init: () => ({ project: null }),
  apply: (state, event) => {
    event = parseEventPayload(event)
    if (event.type !== 'pactflow/project-initialized' && event.type !== 'pactflow/project-configured') return state
    versioned(event)
    if (event.type === 'pactflow/project-initialized' && state.project !== null) {
      if (JSON.stringify(state.project) === JSON.stringify(event.data.project)) return state
      throw new Error('PactFlow project is already initialized')
    }
    if (event.type === 'pactflow/project-configured' && state.project === null) {
      throw new Error('PactFlow project must be initialized before configuration')
    }
    if (event.type === 'pactflow/project-configured' && state.project !== null) {
      if (JSON.stringify(state.project) === JSON.stringify(event.data.project)) return state
      if (event.data.project.id !== state.project.id
        || event.data.project.createdAt !== state.project.createdAt
        || event.data.project.revision !== state.project.revision + 1
        || event.data.project.git === undefined) {
        throw new Error('PactFlow project configuration does not advance the initialized project')
      }
    }
    return { project: event.data.project }
  },
  wire: { viewSchema: projectProjectionSchema, view: state => state },
}

export const pactflowNeedsProjection: ProjectionDefinition<'pactflowNeeds'> = {
  key: 'pactflowNeeds', stateVersion: 3, stateSchema: needsProjectionSchema,
  init: () => ({ byId: {} }),
  apply: (state, event) => {
    event = parseEventPayload(event)
    if (event.type !== 'pactflow/need-created' && event.type !== 'pactflow/need-updated' && event.type !== 'pactflow/phase-transitioned') return state
    versioned(event)
    const next = event.data.need
    const previous = state.byId[next.id]
    if (event.type === 'pactflow/need-created') {
      if (previous !== undefined) {
        if (JSON.stringify(previous) === JSON.stringify(next)) return state
        throw new Error(`PactFlow Need "${next.id}" was created more than once`)
      }
      if (next.revision !== 1 || next.phase !== 'backlog') throw new Error(`PactFlow Need "${next.id}" has an invalid initial state`)
    } else {
      if (previous !== undefined && JSON.stringify(previous) === JSON.stringify(next)) return state
      if (previous === undefined || next.revision !== previous.revision + 1) {
        throw new Error(`PactFlow Need "${next.id}" revision is not monotonic`)
      }
      if (next.createdAt !== previous.createdAt) throw new Error(`PactFlow Need "${next.id}" creation identity changed`)
      if (event.type === 'pactflow/need-updated' && next.phase !== previous.phase) {
        throw new Error(`PactFlow Need "${next.id}" update cannot change its phase`)
      }
      if (event.type === 'pactflow/phase-transitioned' && (next.title !== previous.title || next.description !== previous.description)) {
        throw new Error(`PactFlow Need "${next.id}" phase transition cannot change requirement content`)
      }
      if (event.type === 'pactflow/phase-transitioned' && (event.data.from !== previous.phase
        || PACTFLOW_NEXT_PHASE[previous.phase] !== next.phase)) {
        throw new Error(`PactFlow Need "${next.id}" phase transition source is stale`)
      }
    }
    return { byId: { ...state.byId, [next.id]: next } }
  },
  wire: { viewSchema: needsProjectionSchema, view: state => state },
}

export const pactflowDagProjection: ProjectionDefinition<'pactflowDag'> = {
  key: 'pactflowDag', stateVersion: 4, stateSchema: dagStateSchema,
  init: () => ({ byId: {}, needIds: [] }),
  apply: (state, event) => {
    event = parseEventPayload(event)
    if (event.type === 'pactflow/need-created') {
      return state.needIds.includes(event.data.need.id) ? state : { ...state, needIds: [...state.needIds, event.data.need.id] }
    }
    if (event.type !== 'pactflow/node-created' && event.type !== 'pactflow/node-updated'
      && event.type !== 'pactflow/run-claimed' && event.type !== 'pactflow/run-bound'
      && event.type !== 'pactflow/run-renewed'
      && event.type !== 'pactflow/run-settled') return state
    versioned(event)
    const next = event.data.node
    if (!state.needIds.includes(next.needId)) throw new Error(`PactFlow node "${next.id}" refers to a missing Need`)
    const previous = state.byId[next.id]
    if (event.type === 'pactflow/node-created') {
      if (previous !== undefined) {
        if (JSON.stringify(previous) === JSON.stringify(next)) return state
        throw new Error(`PactFlow node "${next.id}" was created more than once`)
      }
      if (next.revision !== 1) throw new Error(`PactFlow node "${next.id}" has an invalid initial revision`)
    } else {
      if (previous === undefined) throw new Error(`PactFlow node "${next.id}" has no prior state`)
      if (next.needId !== previous.needId) throw new Error(`PactFlow node "${next.id}" changed Need ownership`)
      if (JSON.stringify(previous) === JSON.stringify(next)) return state
      const unchangedRevision = (event.type === 'pactflow/run-bound')
        || (event.type === 'pactflow/run-renewed' && previous.state === next.state)
      if (unchangedRevision ? next.revision !== previous.revision : next.revision !== previous.revision + 1) {
        throw new Error(`PactFlow node "${next.id}" revision is not monotonic`)
      }
      if ('run' in event.data && event.data.run.nodeId !== next.id) {
        throw new Error(`PactFlow Run "${event.data.run.id}" does not belong to node "${next.id}"`)
      }
    }
    if (previous === undefined || JSON.stringify(previous.dependencies) !== JSON.stringify(next.dependencies)) {
      if (new Set(next.dependencies).size !== next.dependencies.length) throw new Error('PactFlow node dependencies contain duplicates')
      const pending = [...next.dependencies]
      const visited = new Set<string>()
      while (pending.length > 0) {
        const id = pending.pop()!
        if (id === next.id) throw new Error(`PactFlow node "${next.id}" dependencies contain a cycle`)
        if (visited.has(id)) continue
        visited.add(id)
        const dependency = state.byId[id]
        if (dependency === undefined || dependency.needId !== next.needId) {
          throw new Error(`PactFlow node "${next.id}" has a missing or foreign dependency`)
        }
        pending.push(...dependency.dependencies)
      }
    }
    return { ...state, byId: { ...state.byId, [next.id]: next } }
  },
  wire: { viewSchema: dagProjectionSchema, view: state => ({ byId: state.byId }) },
}

export const pactflowRunsProjection: ProjectionDefinition<'pactflowRuns'> = {
  key: 'pactflowRuns', stateVersion: 4, stateSchema: runsProjectionSchema,
  init: () => ({ byId: {} }),
  apply: (state, event) => {
    event = parseEventPayload(event)
    if (event.type !== 'pactflow/run-claimed' && event.type !== 'pactflow/run-bound'
      && event.type !== 'pactflow/run-renewed' && event.type !== 'pactflow/run-settled') return state
    versioned(event)
    const next = event.data.run
    const previous = state.byId[next.id]
    const expectedNodeRevision = next.nodeRevision + (event.type === 'pactflow/run-settled' ? 1 : 0)
    if (event.data.node.id !== next.nodeId || event.data.node.revision !== expectedNodeRevision) {
      throw new Error(`PactFlow Run "${next.id}" does not match its node revision`)
    }
    if (event.type === 'pactflow/run-claimed') {
      if (previous !== undefined) {
        if (JSON.stringify(previous) === JSON.stringify(next)) return state
        throw new Error(`PactFlow Run "${next.id}" was claimed more than once`)
      }
      if (next.state !== 'claimed') throw new Error(`PactFlow Run "${next.id}" has an invalid initial state`)
    } else {
      if (previous === undefined || previous.nodeId !== next.nodeId || previous.claimId !== next.claimId
        || previous.attempt !== next.attempt) {
        throw new Error(`PactFlow Run "${next.id}" references a stale or foreign Run`)
      }
      if (JSON.stringify(previous) === JSON.stringify(next)) return state
      if (['succeeded', 'failed', 'cancelled'].includes(previous.state)) {
        throw new Error(`PactFlow Run "${next.id}" cannot change after settlement`)
      }
      const { jobUid: previousUid, ...previousK3s } = previous.k3s ?? {}
      const { jobUid: nextUid, ...nextK3s } = next.k3s ?? {}
      if (previous.provider !== next.provider || !samePersistedValue(previous.git, next.git)
        || (previous.k3s === undefined) !== (next.k3s === undefined) || !samePersistedValue(previousK3s, nextK3s)
        || (event.type !== 'pactflow/run-bound' && previousUid !== nextUid)) {
        throw new Error(`PactFlow Run "${next.id}" immutable execution identity changed`)
      }
      if (event.type === 'pactflow/run-bound'
        && (previous.k3s?.jobUid !== undefined || next.k3s?.jobUid === undefined)) {
        throw new Error(`PactFlow Run "${next.id}" has an invalid Job binding transition`)
      }
      if (event.type === 'pactflow/run-bound' && next.state !== previous.state) {
        throw new Error(`PactFlow Run "${next.id}" changed state while binding its Job`)
      }
      if (event.type === 'pactflow/run-renewed' && !['claimed', 'running', 'blocked'].includes(next.state)) {
        throw new Error(`PactFlow Run "${next.id}" renewed into a terminal state`)
      }
      if (event.type === 'pactflow/run-settled' && ['succeeded', 'failed', 'cancelled'].includes(previous.state)) {
        throw new Error(`PactFlow Run "${next.id}" was settled more than once`)
      }
      if (event.type === 'pactflow/run-settled' && !['succeeded', 'failed', 'cancelled'].includes(next.state)) {
        throw new Error(`PactFlow Run "${next.id}" has an invalid terminal state`)
      }
    }
    if (event.data.run.gitResult !== undefined
      && (event.data.run.git === undefined
        || event.data.run.state !== 'succeeded'
        || event.data.run.gitResult.branch !== event.data.run.git.branch)) {
      throw new Error('PactFlow Git result does not match its successful Run spec')
    }
    if (event.data.run.k3sResult !== undefined
      && (event.data.run.k3s === undefined
        || event.data.run.state !== 'succeeded'
        || event.data.run.k3sResult.exitCode !== 0
        || event.data.run.k3sResult.branch !== event.data.run.gitResult?.branch
        || event.data.run.k3sResult.commit !== event.data.run.gitResult?.commit)) {
      throw new Error('PactFlow K3s result does not match its successful Git result')
    }
    if (next.k3s !== undefined && next.k3sResult !== undefined) {
      if (next.k3sResult.runNonceHash !== undefined && next.k3s.runNonceHash === undefined
        || next.k3sResult.claimTokenHash !== undefined && next.k3s.claimTokenHash === undefined
        || next.k3sResult.specDigest !== undefined && next.k3s.specDigest === undefined) {
        throw new Error(`PactFlow K3s result contains an unbound identity for "${next.id}"`)
      }
      if (next.k3s.runNonceHash !== undefined && next.k3sResult.runNonceHash !== next.k3s.runNonceHash
        || next.k3s.claimTokenHash !== undefined && next.k3sResult.claimTokenHash !== next.k3s.claimTokenHash
        || next.k3s.specDigest !== undefined && next.k3sResult.specDigest !== next.k3s.specDigest) {
        throw new Error(`PactFlow K3s result does not match Run identity for "${next.id}"`)
      }
    }
    return { byId: { ...state.byId, [next.id]: next } }
  },
  wire: { viewSchema: runsProjectionSchema, view: state => state },
}

export const pactflowDeliveryProjection: ProjectionDefinition<'pactflowDelivery'> = {
  key: 'pactflowDelivery', stateVersion: 5, stateSchema: deliveryStateSchema,
  init: () => ({ reviews: {}, documents: {}, releases: {}, cleanups: {}, needIds: [], runNeeds: {} }),
  apply: (state, event) => {
    event = parseEventPayload(event)
    if (event.type === 'pactflow/need-created') {
      return state.needIds.includes(event.data.need.id) ? state : { ...state, needIds: [...state.needIds, event.data.need.id] }
    }
    if (event.type === 'pactflow/run-claimed') {
      const needId = event.data.node.needId
      if (!state.needIds.includes(needId)) throw new Error('PactFlow delivery Run refers to a missing Need')
      const previous = state.runNeeds[event.data.run.id]
      if (previous !== undefined && previous !== needId) throw new Error('PactFlow delivery Run changed Need ownership')
      return previous === needId ? state : { ...state, runNeeds: { ...state.runNeeds, [event.data.run.id]: needId } }
    }
    const needId = event.type === 'pactflow/review-recorded' ? event.data.review.needId
      : event.type === 'pactflow/document-linked' ? event.data.document.needId
      : event.type === 'pactflow/release-recorded' ? event.data.release.needId
      : event.type === 'pactflow/cleanup-recorded' ? event.data.record.needId : undefined
    if (needId !== undefined && !state.needIds.includes(needId)) throw new Error('PactFlow delivery record refers to a missing Need')
    if (event.type === 'pactflow/cleanup-recorded' && event.data.record.runId !== undefined) {
      const owner = state.runNeeds[event.data.record.runId]
      if (!Object.hasOwn(state.runNeeds, event.data.record.runId) || owner === undefined
        || (needId !== undefined && needId !== owner)) throw new Error('PactFlow cleanup refers to a missing or foreign Run')
    }
    if (event.type === 'pactflow/review-recorded') {
      versioned(event)
      const next = event.data.review
      const previous = state.reviews[next.id]
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(next)) {
        throw new Error(`PactFlow review "${next.id}" changed after recording`)
      }
      return previous === undefined ? { ...state, reviews: { ...state.reviews, [next.id]: next } } : state
    }
    if (event.type === 'pactflow/document-linked') {
      versioned(event)
      const next = event.data.document
      const previous = state.documents[next.id]
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(next)) {
        throw new Error(`PactFlow document "${next.id}" changed after linking`)
      }
      return previous === undefined ? { ...state, documents: { ...state.documents, [next.id]: next } } : state
    }
    if (event.type === 'pactflow/release-recorded') {
      versioned(event)
      const next = event.data.release
      const previous = state.releases[next.needId]
      if (previous !== undefined && JSON.stringify(previous) !== JSON.stringify(next)) {
        throw new Error(`PactFlow release for Need "${next.needId}" changed after recording`)
      }
      return previous === undefined ? { ...state, releases: { ...state.releases, [next.needId]: next } } : state
    }
    if (event.type === 'pactflow/cleanup-recorded') {
      versioned(event)
      const next = event.data.record
      const previous = state.cleanups[next.id]
      if (previous !== undefined) {
        if (!samePersistedValue(cleanupIdentity(previous), cleanupIdentity(next))) {
          throw new Error(`PactFlow cleanup "${next.id}" changed its immutable resource identity`)
        }
        if (JSON.stringify(previous) === JSON.stringify(next)) return state
        if (next.attempt < previous.attempt
          || (next.attempt === previous.attempt && previous.state !== 'pending')) {
          throw new Error(`PactFlow cleanup "${next.id}" attempt is not monotonic`)
        }
        if (previous.state === 'succeeded') throw new Error(`PactFlow cleanup "${next.id}" cannot regress after success`)
      }
      return { ...state, cleanups: { ...state.cleanups, [next.id]: next } }
    }
    return state
  },
  wire: { viewSchema: deliveryProjectionSchema, view: pactFlowDeliveryView },
}

export const PACTFLOW_PROJECTIONS = [
  pactflowProjectProjection,
  pactflowNeedsProjection,
  pactflowDagProjection,
  pactflowRunsProjection,
  pactflowDeliveryProjection,
] as const
