import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  PactFlowDagProjection,
  PactFlowDeliveryProjection,
  PactFlowDocument,
  PactFlowNeed,
  PactFlowNeedsProjection,
  PactFlowNode,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowRelease,
  PactFlowReview,
  PactFlowRun,
  PactFlowRunsProjection,
} from './types.ts'

export const PACTFLOW_EVENT_TYPES = [
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

const projectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowProject>

const needSchema = z.object({
  id: z.string().min(1), title: z.string().min(1), description: z.string(),
  phase: z.enum(['backlog', 'discussion', 'confirmed', 'design', 'planning', 'executing', 'code_review', 'verification', 'closing', 'deployed']),
  revision: z.number().int().positive(), createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowNeed>

const nodeSchema = z.object({
  id: z.string().min(1), needId: z.string().min(1), title: z.string().min(1),
  state: z.enum(['pending', 'ready', 'claimed', 'running', 'blocked', 'review', 'succeeded', 'failed', 'cancelled', 'archived']),
  revision: z.number().int().positive(), dependencies: z.array(z.string().min(1)), updatedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowNode>

const runSchema = z.object({
  id: z.string().min(1), nodeId: z.string().min(1), nodeRevision: z.number().int().positive(),
  attempt: z.number().int().positive(), provider: z.string().min(1),
  state: z.enum(['claimed', 'running', 'blocked', 'succeeded', 'failed', 'cancelled']),
  leaseDeadline: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(), outcome: z.string().optional(),
}) as unknown as ZodType<PactFlowRun>

const reviewSchema = z.object({
  id: z.string().min(1), needId: z.string().min(1),
  kind: z.enum(['requirement', 'design', 'plan', 'verification', 'code']),
  decision: z.enum(['approved', 'rejected', 'changes-requested']), note: z.string(), recordedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowReview>

const documentSchema = z.object({
  id: z.string().min(1), needId: z.string().min(1),
  kind: z.enum(['requirement', 'design', 'plan', 'review', 'verification', 'release']),
  uri: z.string().min(1), title: z.string().min(1), linkedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowDocument>

const releaseSchema = z.object({
  needId: z.string().min(1), commit: z.string().min(1), branch: z.string().min(1),
  serviceUrl: z.string().optional(), recordedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowRelease>

const projectProjectionSchema = z.object({ project: projectSchema.nullable() }) as ZodType<PactFlowProjectProjection>
const needsProjectionSchema = z.object({ byId: z.record(z.string(), needSchema) }) as ZodType<PactFlowNeedsProjection>
const dagProjectionSchema = z.object({ byId: z.record(z.string(), nodeSchema) }) as ZodType<PactFlowDagProjection>
const runsProjectionSchema = z.object({ byId: z.record(z.string(), runSchema) }) as ZodType<PactFlowRunsProjection>
const deliveryProjectionSchema = z.object({
  reviews: z.record(z.string(), reviewSchema),
  documents: z.record(z.string(), documentSchema),
  releases: z.record(z.string(), releaseSchema),
}) as ZodType<PactFlowDeliveryProjection>

function versioned(event: SessionEvent): void {
  const data = event.data as { readonly v?: unknown }
  if (data.v !== 1) throw new Error(`unsupported ${event.type} payload version: ${String(data.v)}`)
}

export const pactflowProjectProjection: ProjectionDefinition<'pactflowProject'> = {
  key: 'pactflowProject', stateVersion: 1, stateSchema: projectProjectionSchema,
  init: () => ({ project: null }),
  apply: (state, event) => {
    if (event.type !== 'pactflow/project-initialized') return state
    versioned(event)
    if (state.project !== null) throw new Error('PactFlow project is already initialized')
    return { project: event.data.project }
  },
  wire: { viewSchema: projectProjectionSchema, view: state => state },
}

export const pactflowNeedsProjection: ProjectionDefinition<'pactflowNeeds'> = {
  key: 'pactflowNeeds', stateVersion: 1, stateSchema: needsProjectionSchema,
  init: () => ({ byId: {} }),
  apply: (state, event) => {
    if (event.type !== 'pactflow/need-created' && event.type !== 'pactflow/need-updated' && event.type !== 'pactflow/phase-transitioned') return state
    versioned(event)
    return { byId: { ...state.byId, [event.data.need.id]: event.data.need } }
  },
  wire: { viewSchema: needsProjectionSchema, view: state => state },
}

export const pactflowDagProjection: ProjectionDefinition<'pactflowDag'> = {
  key: 'pactflowDag', stateVersion: 1, stateSchema: dagProjectionSchema,
  init: () => ({ byId: {} }),
  apply: (state, event) => {
    if (event.type !== 'pactflow/node-created' && event.type !== 'pactflow/node-updated') return state
    versioned(event)
    return { byId: { ...state.byId, [event.data.node.id]: event.data.node } }
  },
  wire: { viewSchema: dagProjectionSchema, view: state => state },
}

export const pactflowRunsProjection: ProjectionDefinition<'pactflowRuns'> = {
  key: 'pactflowRuns', stateVersion: 1, stateSchema: runsProjectionSchema,
  init: () => ({ byId: {} }),
  apply: (state, event) => {
    if (event.type !== 'pactflow/run-claimed' && event.type !== 'pactflow/run-renewed' && event.type !== 'pactflow/run-settled') return state
    versioned(event)
    return { byId: { ...state.byId, [event.data.run.id]: event.data.run } }
  },
  wire: { viewSchema: runsProjectionSchema, view: state => state },
}

export const pactflowDeliveryProjection: ProjectionDefinition<'pactflowDelivery'> = {
  key: 'pactflowDelivery', stateVersion: 1, stateSchema: deliveryProjectionSchema,
  init: () => ({ reviews: {}, documents: {}, releases: {} }),
  apply: (state, event) => {
    if (event.type === 'pactflow/review-recorded') {
      versioned(event)
      return { ...state, reviews: { ...state.reviews, [event.data.review.id]: event.data.review } }
    }
    if (event.type === 'pactflow/document-linked') {
      versioned(event)
      return { ...state, documents: { ...state.documents, [event.data.document.id]: event.data.document } }
    }
    if (event.type === 'pactflow/release-recorded') {
      versioned(event)
      return { ...state, releases: { ...state.releases, [event.data.release.needId]: event.data.release } }
    }
    return state
  },
  wire: { viewSchema: deliveryProjectionSchema, view: state => state },
}

export const PACTFLOW_PROJECTIONS = [
  pactflowProjectProjection,
  pactflowNeedsProjection,
  pactflowDagProjection,
  pactflowRunsProjection,
  pactflowDeliveryProjection,
] as const
