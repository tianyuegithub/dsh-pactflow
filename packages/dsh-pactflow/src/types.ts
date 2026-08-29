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

/** Validate and brand one caller-owned DAG node id. */
export function PactFlowNodeId(value: string): PactFlowNodeId {
  const normalized = value.trim()
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(normalized)) {
    throw new Error('PactFlow node id must be 1-64 lower-kebab-case characters')
  }
  return normalized as PactFlowNodeId
}

/** Validate and brand one Host-owned run id. */
export function PactFlowRunId(value: string): PactFlowRunId {
  if (!/^run-[0-9a-f-]{36}$/.test(value)) throw new Error('PactFlow run id is invalid')
  return value as PactFlowRunId
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

export type PactFlowHarness = 'claude' | 'codex' | 'opencode' | 'dsh'
export type PactFlowApiMode = 'anthropic-messages' | 'openai-responses' | 'openai-chat-completions'

export interface PactFlowHarnessTemplateView {
  readonly id: string
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  readonly image: string
  readonly model: string
  readonly baseUrl: string
  readonly modelSecretName: string
  readonly cpuRequest: string
  readonly memoryRequest: string
  readonly cpuLimit: string
  readonly memoryLimit: string
}

export interface PactFlowProject {
  readonly id: PactFlowProjectId
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly git?: PactFlowGitBinding
}

/** Credential-free Git identity bound to the root Session workspace. */
export interface PactFlowGitBinding {
  readonly remote: string
  readonly remoteUrl: string
  readonly defaultBranch: string
  readonly revision: number
  readonly boundAt: number
  readonly auth?: PactFlowGitAuth
  readonly validationCommands: readonly PactFlowValidationCommand[]
  readonly k3sGitSecretName?: string
}

/** Non-secret reference to one HTTPS username/token credential. */
export interface PactFlowGitAuth {
  readonly kind: 'https-token'
  readonly username: string
  readonly credentialRef: string
}

/** Immutable Git workspace selected by the Host for one Run. */
export interface PactFlowGitRunSpec {
  readonly remote: string
  readonly remoteUrl: string
  readonly defaultBranch: string
  readonly baseCommit: string
  readonly branch: string
  readonly worktreePath: string
  readonly auth?: PactFlowGitAuth
  readonly validationCommands: readonly PactFlowValidationCommand[]
}

export interface PactFlowValidationCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

export interface PactFlowValidationEvidence extends PactFlowValidationCommand {
  readonly exitCode: 0
  readonly durationMs: number
}

/** Commit evidence accepted from a successful Git-backed Worker. */
export interface PactFlowGitResult {
  readonly branch: string
  readonly commit: string
  readonly remoteRef: string
  readonly syncedAt: number
  readonly validations: readonly PactFlowValidationEvidence[]
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
  /** Non-secret correlation identity; callback authorization lives in Credentials/Kubernetes Secret. */
  readonly claimId: string
  readonly state: 'claimed' | 'running' | 'blocked' | 'succeeded' | 'failed' | 'cancelled'
  readonly leaseDeadline: number
  readonly leaseDurationMs?: number
  readonly updatedAt: number
  readonly outcome?: string
  readonly git?: PactFlowGitRunSpec
  readonly gitResult?: PactFlowGitResult
  readonly k3s?: PactFlowK3sRunSpec
  readonly k3sResult?: PactFlowK3sResult
}

export interface PactFlowK3sRunSpec {
  readonly templateId: string
  readonly namespace: string
  readonly jobName: string
  readonly configMapName: string
  readonly image: string
  readonly imagePullSecret: string
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  readonly model: string
  readonly baseUrl: string
  readonly modelSecretName: string
  readonly gitSecretName: string
  readonly cpuRequest: string
  readonly memoryRequest: string
  readonly cpuLimit: string
  readonly memoryLimit: string
  readonly activeDeadlineSeconds: number
}

export interface PactFlowK3sResult {
  readonly podName: string
  readonly exitCode: number
  readonly commit: string
  readonly branch: string
  readonly harnessVersion: string
  readonly finishedAt: number
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

export interface BindPactFlowGitRequest {
  readonly expectedRevision: number
  readonly remote: string
  readonly defaultBranch: string
  readonly username?: string
  readonly credentialRef?: string
  readonly validationCommands?: readonly PactFlowValidationCommand[]
  readonly k3sGitSecretName?: string
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

export interface CreatePactFlowNodeRequest {
  readonly id: string
  readonly needId: string
  readonly title: string
  readonly dependencies: readonly string[]
}

export interface UpdatePactFlowNodeDependenciesRequest {
  readonly nodeId: string
  readonly expectedRevision: number
  readonly dependencies: readonly string[]
}

export interface ClaimPactFlowNodeRequest {
  readonly nodeId: string
  readonly expectedRevision: number
  readonly provider: string
  readonly leaseDurationMs: number
}

export interface RenewPactFlowRunRequest {
  readonly runId: string
  readonly claimId: string
  readonly leaseDurationMs: number
}

export interface SettlePactFlowRunRequest {
  readonly runId: string
  readonly claimId: string
  readonly expectedNodeRevision: number
  readonly state: 'succeeded' | 'failed' | 'cancelled'
  readonly outcome: string
}

export interface PactFlowClaimResult {
  readonly node: PactFlowNode
  readonly run: PactFlowRun
}

export interface DispatchPactFlowLocalNodeRequest extends ClaimPactFlowNodeRequest {
  readonly prompt: string
}

export type DispatchPactFlowGitNodeRequest = DispatchPactFlowLocalNodeRequest

export interface DispatchPactFlowK3sNodeRequest {
  readonly nodeId: string
  readonly expectedRevision: number
  readonly templateId: string
  readonly prompt: string
  readonly leaseDurationMs: number
}

export interface PactFlowHarnessProbeRequest {
  readonly templateId: string
  readonly prompt: string
  readonly timeoutMs: number
}

export interface PactFlowHarnessProbeStage {
  readonly name: 'validate' | 'create-job' | 'model-response' | 'cleanup'
  readonly state: 'succeeded' | 'failed'
  readonly detail: string
}

export interface PactFlowHarnessProbeResult {
  readonly kind: 'harness'
  readonly templateId: string
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  readonly model: string
  readonly baseUrl: string
  readonly image: string
  readonly modelSecretName: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly success: boolean
  readonly durationMs: number
  readonly output: string
  readonly stages: readonly PactFlowHarnessProbeStage[]
}

export interface PactFlowProjectRecord {
  readonly sessionId: string
  readonly live: boolean
  readonly persisted: boolean
  readonly project: PactFlowProject | null
}

export interface PactFlowSnapshot {
  readonly project: PactFlowProjectProjection
  readonly needs: PactFlowNeedsProjection
  readonly dag: PactFlowDagProjection
  readonly runs: PactFlowRunsProjection
  readonly delivery: PactFlowDeliveryProjection
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
    'pactflow/project-configured': { readonly v: 1; readonly project: PactFlowProject }
    'pactflow/release-recorded': { readonly v: 1; readonly release: PactFlowRelease }
    'pactflow/review-recorded': { readonly v: 1; readonly review: PactFlowReview }
    'pactflow/run-claimed': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
    'pactflow/run-renewed': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
    'pactflow/run-settled': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
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
