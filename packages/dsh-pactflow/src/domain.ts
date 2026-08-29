import { isAbsolute } from 'node:path'
import { z } from 'zod'
import type { ZodType } from 'zod'
import type { ProjectionDefinition } from '@deepseek-ai/dsh-session-projection'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type {
  PactFlowDagProjection,
  PactFlowDeliveryProjection,
  PactFlowDocument,
  PactFlowGitBinding,
  PactFlowGitAuth,
  PactFlowGiteaBinding,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowNeed,
  PactFlowNeedsProjection,
  PactFlowNode,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowProject,
  PactFlowProjectProjection,
  PactFlowRelease,
  PactFlowReview,
  PactFlowRun,
  PactFlowRunsProjection,
  PactFlowValidationCommand,
  PactFlowValidationEvidence,
} from './types.ts'

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

export const PACTFLOW_EVENT_TYPES = [
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

const gitAuthSchema = z.object({
  kind: z.literal('https-token'), username: z.string().min(1), credentialRef: z.string().min(1),
}) as unknown as ZodType<PactFlowGitAuth>

const giteaBindingSchema = z.object({
  baseUrl: z.string().min(1), owner: z.string().min(1), repo: z.string().min(1),
  tokenCredentialRef: z.string().min(1),
}) as unknown as ZodType<PactFlowGiteaBinding>

const validationCommandSchema = z.object({
  command: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().positive(),
}) as unknown as ZodType<PactFlowValidationCommand>

const validationEvidenceSchema = z.object({
  command: z.string().min(1), args: z.array(z.string()), timeoutMs: z.number().int().positive(),
  exitCode: z.literal(0), durationMs: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowValidationEvidence>

const gitBindingSchema = z.object({
  remote: z.string().min(1), remoteUrl: z.string().min(1), defaultBranch: z.string().min(1),
  revision: z.number().int().positive(), boundAt: z.number().int().nonnegative(), auth: gitAuthSchema.optional(),
  validationCommands: z.array(validationCommandSchema),
  k3sGitSecretName: z.string().min(1).optional(),
  gitea: giteaBindingSchema.optional(),
}) as unknown as ZodType<PactFlowGitBinding>

const gitRunSpecSchema = z.object({
  remote: z.string().min(1), remoteUrl: z.string().min(1), defaultBranch: z.string().min(1),
  baseCommit: z.string().regex(/^[0-9a-f]{40,64}$/), branch: z.string().min(1),
  worktreePath: z.string().refine(isAbsolute), auth: gitAuthSchema.optional(),
  validationCommands: z.array(validationCommandSchema),
}) as unknown as ZodType<PactFlowGitRunSpec>

const gitResultSchema = z.object({
  branch: z.string().min(1), commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  remoteRef: z.string().min(1), syncedAt: z.number().int().nonnegative(),
  validations: z.array(validationEvidenceSchema),
}) as unknown as ZodType<PactFlowGitResult>

const k3sRunSpecSchema = z.object({
  templateId: z.string().min(1), namespace: z.string().min(1), jobName: z.string().min(1),
  configMapName: z.string().min(1), image: z.string().min(1), imagePullSecret: z.string().min(1),
  harness: z.enum(['claude', 'codex', 'opencode', 'dsh']),
  apiMode: z.enum(['anthropic-messages', 'openai-responses', 'openai-chat-completions']),
  model: z.string().min(1), baseUrl: z.string().min(1),
  modelSecretName: z.string().min(1), gitSecretName: z.string().min(1),
  cpuRequest: z.string().min(1), memoryRequest: z.string().min(1),
  cpuLimit: z.string().min(1), memoryLimit: z.string().min(1),
  activeDeadlineSeconds: z.number().int().positive(),
}) as unknown as ZodType<PactFlowK3sRunSpec>

const k3sResultSchema = z.object({
  podName: z.string().min(1), exitCode: z.number().int(), commit: z.string().regex(/^[0-9a-f]{40,64}$/),
  branch: z.string().min(1), harnessVersion: z.string(),
  finishedAt: z.number().int().nonnegative(),
}) as unknown as ZodType<PactFlowK3sResult>

const projectSchema = z.object({
  id: z.string().min(1), name: z.string().min(1), revision: z.number().int().positive(),
  createdAt: z.number().int().nonnegative(), updatedAt: z.number().int().nonnegative(),
  git: gitBindingSchema.optional(),
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
  claimId: z.string().min(1),
  state: z.enum(['claimed', 'running', 'blocked', 'succeeded', 'failed', 'cancelled']),
  leaseDeadline: z.number().int().nonnegative(), leaseDurationMs: z.number().int().positive().optional(),
  updatedAt: z.number().int().nonnegative(), outcome: z.string().optional(),
  git: gitRunSpecSchema.optional(), gitResult: gitResultSchema.optional(),
  k3s: k3sRunSpecSchema.optional(), k3sResult: k3sResultSchema.optional(),
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
    if (event.type !== 'pactflow/project-initialized' && event.type !== 'pactflow/project-configured') return state
    versioned(event)
    if (event.type === 'pactflow/project-initialized' && state.project !== null) {
      throw new Error('PactFlow project is already initialized')
    }
    if (event.type === 'pactflow/project-configured' && state.project === null) {
      throw new Error('PactFlow project must be initialized before configuration')
    }
    if (event.type === 'pactflow/project-configured' && state.project !== null) {
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
    if (event.type !== 'pactflow/node-created' && event.type !== 'pactflow/node-updated'
      && event.type !== 'pactflow/run-claimed' && event.type !== 'pactflow/run-renewed'
      && event.type !== 'pactflow/run-settled') return state
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
