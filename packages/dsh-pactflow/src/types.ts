/** Client-visible proof that the PactFlow Host and external event vocabulary are active. */
export interface PactFlowHealth {
  readonly plugin: 'dsh-pactflow'
  readonly version: string
  readonly mode: 'pactflow'
  readonly presetRoot: string
  readonly externalEventTypes: readonly string[]
}

declare const pactFlowIdBrand: unique symbol

/** Opaque domain id that remains a plain string on the wire and in the log. */
export type PactFlowId<Kind extends string> = string & { readonly [pactFlowIdBrand]: Kind }

export type PactFlowProjectId = PactFlowId<'project'>
export type PactFlowNeedId = PactFlowId<'need'>
export type PactFlowNodeId = PactFlowId<'node'>
export type PactFlowRunId = PactFlowId<'run'>
export type PactFlowReviewId = PactFlowId<'review'>
export type PactFlowDocumentId = PactFlowId<'document'>

/** Validate and brand one project id at the domain boundary. */
export function PactFlowProjectId(value: string): PactFlowProjectId {
  if (value.length === 0) throw new Error('PactFlow project id must be non-empty')
  return value as PactFlowProjectId
}

/** Validate and brand one caller-owned need id. */
export function PactFlowNeedId(value: string): PactFlowNeedId {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw new Error('PactFlow need id must be 1-64 lower-kebab-case characters')
  }
  return normalized as PactFlowNeedId
}

export type PactFlowPhase =
  | 'backlog'
  | 'discussion'
  | 'confirmed'
  | 'design'
  | 'planning'
  | 'executing'
  | 'code_review'
  | 'verification'
  | 'closing'
  | 'deployed'

export type PactFlowNodeState =
  | 'pending'
  | 'ready'
  | 'claimed'
  | 'running'
  | 'blocked'
  | 'review'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'archived'

export interface PactFlowProject {
  readonly id: PactFlowProjectId
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PactFlowNeed {
  readonly id: PactFlowNeedId
  readonly title: string
  readonly description: string
  readonly phase: PactFlowPhase
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
}

export interface PactFlowNode {
  readonly id: PactFlowNodeId
  readonly needId: PactFlowNeedId
  readonly title: string
  readonly state: PactFlowNodeState
  readonly revision: number
  readonly dependencies: readonly PactFlowNodeId[]
  readonly updatedAt: number
}

export interface PactFlowRun {
  readonly id: PactFlowRunId
  readonly nodeId: PactFlowNodeId
  readonly nodeRevision: number
  readonly attempt: number
  readonly provider: string
  readonly state: 'claimed' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'
  readonly leaseDeadline: number
  readonly updatedAt: number
  readonly outcome?: string
}

export interface PactFlowReview {
  readonly id: PactFlowReviewId
  readonly needId: PactFlowNeedId
  readonly kind: 'requirement' | 'design' | 'plan' | 'verification' | 'code'
  readonly decision: 'approved' | 'rejected' | 'changes-requested'
  readonly note: string
  readonly recordedAt: number
}

export interface PactFlowDocument {
  readonly id: PactFlowDocumentId
  readonly needId: PactFlowNeedId
  readonly kind: 'requirement' | 'design' | 'plan' | 'review' | 'verification' | 'release'
  readonly uri: string
  readonly title: string
  readonly linkedAt: number
}

export interface PactFlowRelease {
  readonly needId: PactFlowNeedId
  readonly commit: string
  readonly branch: string
  readonly serviceUrl?: string
  readonly recordedAt: number
}

export interface InitializePactFlowProjectRequest {
  readonly name: string
}

export interface CreatePactFlowNeedRequest {
  readonly id: string
  readonly title: string
  readonly description: string
}

export interface RecordPactFlowReviewRequest {
  readonly needId: string
  readonly kind: PactFlowReview['kind']
  readonly decision: PactFlowReview['decision']
  readonly note: string
}

export interface TransitionPactFlowNeedRequest {
  readonly needId: string
  readonly expectedRevision: number
  readonly to: PactFlowPhase
}

export interface PactFlowProjectProjection { readonly project: PactFlowProject | null }
export interface PactFlowNeedsProjection { readonly byId: Readonly<Record<string, PactFlowNeed>> }
export interface PactFlowDagProjection { readonly byId: Readonly<Record<string, PactFlowNode>> }
export interface PactFlowRunsProjection { readonly byId: Readonly<Record<string, PactFlowRun>> }
export interface PactFlowDeliveryProjection {
  readonly reviews: Readonly<Record<string, PactFlowReview>>
  readonly documents: Readonly<Record<string, PactFlowDocument>>
  readonly releases: Readonly<Record<string, PactFlowRelease>>
}

declare module '@deepseek-ai/dsh-session/types' {
  interface SessionEventMap {
    'pactflow/document-linked': { readonly v: 1; readonly document: PactFlowDocument }
    'pactflow/need-created': { readonly v: 1; readonly need: PactFlowNeed }
    'pactflow/need-updated': { readonly v: 1; readonly need: PactFlowNeed }
    'pactflow/node-created': { readonly v: 1; readonly node: PactFlowNode }
    'pactflow/node-updated': { readonly v: 1; readonly node: PactFlowNode }
    'pactflow/phase-transitioned': { readonly v: 1; readonly need: PactFlowNeed; readonly from: PactFlowPhase }
    'pactflow/project-initialized': { readonly v: 1; readonly project: PactFlowProject }
    'pactflow/release-recorded': { readonly v: 1; readonly release: PactFlowRelease }
    'pactflow/review-recorded': { readonly v: 1; readonly review: PactFlowReview }
    'pactflow/run-claimed': { readonly v: 1; readonly run: PactFlowRun }
    'pactflow/run-renewed': { readonly v: 1; readonly run: PactFlowRun }
    'pactflow/run-settled': { readonly v: 1; readonly run: PactFlowRun }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    pactflowProject: PactFlowProjectProjection
    pactflowNeeds: PactFlowNeedsProjection
    pactflowDag: PactFlowDagProjection
    pactflowRuns: PactFlowRunsProjection
    pactflowDelivery: PactFlowDeliveryProjection
  }
  interface SessionProjectionMap {
    pactflowProject: PactFlowProjectProjection
    pactflowNeeds: PactFlowNeedsProjection
    pactflowDag: PactFlowDagProjection
    pactflowRuns: PactFlowRunsProjection
    pactflowDelivery: PactFlowDeliveryProjection
  }
}
