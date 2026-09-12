import type {} from '@deepseek-ai/dsh-session-projection/types'

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
  | 'paused'
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

/** Declared capability of one configured Harness (A10); serializable for the Remote boundary. */
export interface PactFlowHarnessCapabilityView {
  readonly templateId: string
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  readonly structuredOutput: 'native' | 'text'
  readonly maxLevel: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
}

/** User-facing Harness image and resource profile, independent of any model. */
export interface PactFlowHarnessProfileSettings {
  readonly id: string
  readonly displayName: string
  readonly harness: PactFlowHarness
  readonly registryId: string
  readonly repository: string
  readonly artifactDigest: string
  readonly cpuRequest: string
  readonly memoryRequest: string
  readonly cpuLimit: string
  readonly memoryLimit: string
}

/** Model endpoint combined with a compatible Harness only when a Run starts. */
export interface PactFlowModelConnectionSettings {
  readonly id: string
  readonly displayName: string
  readonly apiMode: PactFlowApiMode
  readonly model: string
  readonly baseUrl: string
  readonly apiKeyCredentialRef: string
}

export interface PactFlowK3sSettings {
  readonly namespace: string
  readonly kubeconfig?: string
  readonly context?: string
  readonly imagePullSecret: string
  readonly pollIntervalMs: number
  readonly templates: readonly PactFlowHarnessTemplateView[]
  readonly finishedJobTtlSeconds?: number
  /**
   * Wall-clock budget for one K3s Job, independent of the ownership lease. Lease
   * renewal extends ownership, not this deadline; a healthy long task must not be
   * killed at the first lease interval. Floored to PACTFLOW_K3S_MIN_WALL_CLOCK_SECONDS.
   */
  readonly jobMaxWallClockSeconds?: number
}

export interface PactFlowK3sClusterSettings {
  readonly id: string
  readonly displayName: string
  readonly namespace: string
  readonly kubeconfig?: string
  readonly context?: string
  readonly pollIntervalMs: number
  readonly finishedJobTtlSeconds?: number
}

export interface PactFlowRegistrySettings {
  readonly id: string
  readonly displayName: string
  readonly kind: 'harbor'
  readonly endpoint: string
  readonly project?: string
  /** Project-relative Harbor repository that owns the four Harness images. */
  readonly harnessRepository?: string
  readonly tlsVerify: boolean
  readonly imagePullSecret?: string
  readonly username?: string
  readonly usernameCredentialRef?: string
  readonly passwordCredentialRef?: string
}

export interface PactFlowGitProviderSettings {
  readonly id: string
  readonly displayName: string
  readonly kind: 'gitea'
  readonly baseUrl: string
  readonly tokenCredentialRef: string
  readonly username?: string
}

export interface PactFlowWorkerPoolSettings {
  readonly id: string
  readonly displayName: string
  readonly clusterId: string
  readonly registryId: string
  readonly templateIds: readonly string[]
  readonly maxConcurrency: number
  readonly queuePolicy: 'fifo'
  readonly imagePullSecret?: string
}

export interface PactFlowInfrastructureSettings {
  readonly clusters: readonly PactFlowK3sClusterSettings[]
  readonly registries: readonly PactFlowRegistrySettings[]
  readonly gitProviders: readonly PactFlowGitProviderSettings[]
  readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
  readonly modelConnections?: readonly PactFlowModelConnectionSettings[]
  readonly workerPools: readonly PactFlowWorkerPoolSettings[]
}

export interface PactFlowWorkerPoolStatus extends PactFlowWorkerPoolSettings {
  readonly running: number
  readonly waiting: number
}

export type PactFlowInfrastructureResourceKind =
  | 'cluster' | 'registry' | 'git-provider' | 'harness' | 'model-connection' | 'worker-pool'

export interface PactFlowInfrastructureProbeRequest {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly draft?: PactFlowInfrastructureSettings
}

export interface PactFlowInfrastructureProbeStage {
  readonly name: string
  readonly state: 'succeeded' | 'failed'
  readonly detail: string
}

export interface PactFlowInfrastructureProbeResult {
  readonly kind: PactFlowInfrastructureProbeRequest['kind']
  readonly id: string
  readonly success: boolean
  readonly durationMs: number
  readonly stages: readonly PactFlowInfrastructureProbeStage[]
}

export interface PactFlowInfrastructureHealthRecord {
  readonly probeContractVersion: 2
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly fingerprint: string
  readonly state: 'succeeded' | 'failed'
  readonly testedAt: string
  readonly durationMs: number
  readonly stages: readonly PactFlowInfrastructureProbeStage[]
}

export interface PactFlowInfrastructureDeletionImpact {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly blockers: readonly string[]
  readonly credentialRefs: readonly string[]
}

export interface PactFlowKubeconfigView {
  readonly path: string
  readonly contexts: readonly string[]
  readonly currentContext?: string
}

export interface PactFlowHarborArtifactOption {
  readonly registryId: string
  readonly repository: string
  readonly digest: string
  readonly tags: readonly string[]
  readonly label: string
}

export interface PactFlowDiscoveredModel {
  readonly id: string
  readonly name?: string
}

export interface PactFlowWorkspaceGitStatus {
  readonly initialized: boolean
  readonly branch?: string
  readonly remoteUrl?: string
  readonly hasCommit: boolean
  readonly clean: boolean
  readonly changedFiles: number
  readonly untrackedFiles: number
  readonly hasGitignore: boolean
}

export interface PactFlowAgentProfile {
  readonly id: string
  readonly displayName: string
  readonly templateId: string
  readonly maxConcurrency: number
  readonly modelConnectionId: string
}

export interface PactFlowProjectWorkerPolicy {
  readonly clusterId: string
  readonly workerPoolId: string
  /** Derived from Agent Profile quantities; retained for persisted-schema compatibility. */
  readonly maxConcurrency: number
  readonly agentProfiles: readonly PactFlowAgentProfile[]
}

export interface PactFlowWorkspaceGitBinding {
  readonly remote: string
  readonly remoteUrl: string
  readonly defaultBranch: string
  readonly k3sGitSecretName?: string
  readonly giteaProviderId?: string
  readonly owner?: string
  readonly repo?: string
  readonly boundAt: number
}

export interface PactFlowWorkspaceProjectConfig {
  readonly schema: 'dsh_pactflow_workspace_project/v1'
  readonly workspaceId: string
  readonly workspacePath: string
  readonly workspaceTitle: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly remoteCreation?: PactFlowRemoteCreation
  readonly git?: PactFlowWorkspaceGitBinding
  readonly worker?: PactFlowProjectWorkerPolicy
  readonly validationProfiles?: readonly PactFlowValidationProfile[]
  readonly validationProfileIds?: readonly string[]
  /** Historical raw commands; new configurations use validationProfiles instead. */
  readonly validationCommands?: readonly PactFlowValidationCommand[]
  /**
   * Minimum validation policy (A03-b): every group's profiles must have successful
   * execution evidence on each delivered candidate before closing is allowed.
   * Owner-writable only (client config path); never readable or writable by the model.
   */
  readonly validationPolicy?: readonly PactFlowValidationPolicyGroup[]
  /**
   * A03-c: host-owned closing baseline commands, stored OUTSIDE any task repo.
   * Executed on the candidate commit before task validations at every closing;
   * a failure blocks closing. Owner-writable only (client config path).
   */
  readonly hostBaselineCommands?: readonly PactFlowValidationCommand[]
}

/** One closing-required set of validation profiles; every group must be satisfied. */
export interface PactFlowValidationPolicyGroup {
  readonly id: string
  readonly profileIds: readonly string[]
}

export interface PactFlowRemoteCreation {
  readonly id: string
  readonly state: 'creating' | 'created' | 'completed'
  readonly providerId: string
  readonly providerSnapshot: string
  readonly owner: string
  readonly repo: string
  readonly defaultBranch: string
  readonly private: boolean
  readonly expectedCommit: string
  readonly cloneUrl?: string
}

/** User-owned, stable validation command selected by ID rather than model input. */
export interface PactFlowValidationProfile {
  readonly id: string
  readonly displayName: string
  readonly revision: number
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

export interface PactFlowValidationProfileInput {
  readonly id: string
  readonly displayName: string
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
  readonly revision?: number
}

export interface PactFlowWorkspaceProjectView {
  readonly workspaceId: string
  readonly path: string
  readonly title: string
  readonly gitStatus: PactFlowWorkspaceGitStatus
  readonly config?: PactFlowWorkspaceProjectConfig
  readonly migrationCandidates: readonly {
    readonly sessionId: string
    readonly projectName: string
    readonly revision: number
  }[]
}

export interface PactFlowInitializeWorkspaceGitRequest {
  readonly workspaceId: string
  readonly expectedPath: string
  readonly confirm: 'initialize-local-git'
}

export interface PactFlowSaveWorkspaceWorkerPolicyRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  readonly worker: PactFlowProjectWorkerPolicy
  readonly k3sGitSecretName: string
}

export interface PactFlowCreateWorkspaceRemoteRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  readonly providerId: string
  readonly owner: string
  readonly repo: string
  readonly private: boolean
  readonly defaultBranch: string
  readonly confirm: 'create-gitea-repository'
}

/** One read-only reconciliation candidate compared against the recorded creation intent. */
export interface PactFlowRemoteCandidate {
  readonly id: number
  readonly fullName: string
  readonly cloneUrl: string
  readonly defaultBranch: string
  readonly private: boolean
  readonly empty: boolean
  readonly description: string
  readonly createdAt: string
  readonly matches: Readonly<{
    readonly exactName: boolean
    readonly defaultBranch: boolean
    readonly private: boolean
    readonly descriptionClue: boolean
  }>
}

export interface PactFlowRemoteReconciliation {
  readonly intent: Readonly<{
    readonly owner: string
    readonly repo: string
    readonly defaultBranch: string
    readonly private: boolean
    readonly operationId: string
  }>
  readonly candidates: readonly PactFlowRemoteCandidate[]
}

export interface PactFlowConfirmWorkspaceRemoteRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  readonly repoId: number
}

export interface PactFlowAdoptWorkspaceGitRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
}

export interface PactFlowMigrateWorkspaceProjectRequest {
  readonly workspaceId: string
  readonly sessionId: string
  readonly expectedRevision: number
  readonly confirm: 'migrate-session-project'
}

export interface PactFlowSaveValidationProfilesRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  readonly profiles?: readonly PactFlowValidationProfileInput[]
  readonly validationProfiles?: readonly PactFlowValidationProfileInput[]
  readonly selectedProfileIds?: readonly string[]
  readonly validationProfileIds?: readonly string[]
}

/** Owner request to replace the workspace's minimum validation policy (A03-b). */
export interface PactFlowSaveValidationPolicyRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  /** Empty/omitted clears the policy; every group must be satisfied at closing. */
  readonly groups?: readonly PactFlowValidationPolicyGroup[]
}

/** Owner request to replace the host-owned closing baseline (A03-c). */
export interface PactFlowSaveHostBaselineRequest {
  readonly workspaceId: string
  readonly expectedRevision: number
  /** Empty/omitted clears the baseline. */
  readonly commands?: readonly PactFlowValidationCommand[]
}

export interface PactFlowSettingsView {
  readonly k3s: false | PactFlowK3sSettings
  readonly infrastructure: false | PactFlowInfrastructureSettings
}

export interface PactFlowProject {
  readonly id: PactFlowProjectId
  readonly name: string
  readonly revision: number
  readonly createdAt: number
  readonly updatedAt: number
  readonly git?: PactFlowGitBinding
  readonly workerPoolId?: string
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
  readonly validationProfileIds?: readonly string[]
  readonly validationProfileRevisions?: Readonly<Record<string, number>>
  readonly legacyUntrusted?: boolean
  readonly k3sGitSecretName?: string
  readonly gitea?: PactFlowGiteaBinding
}

export interface PactFlowGiteaBinding {
  readonly baseUrl: string
  readonly owner: string
  readonly repo: string
  readonly tokenCredentialRef: string
  readonly username?: string
}

export interface PactFlowGiteaStatus {
  readonly fullName: string
  readonly defaultBranch: string
  readonly private: boolean
  readonly archived: boolean
  readonly branchProtected: boolean
  readonly requiredApprovals: number
  readonly statusChecks: readonly string[]
  readonly mergeStyle: string
}

export interface PactFlowClosingGit {
  readonly branch: string
  readonly commit: string
  readonly worktreePath: string
  /** A03-c: host-owned baseline evidence executed on the candidate commit (independent source). */
  readonly baselineValidations?: readonly PactFlowValidationEvidence[] | undefined
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
  /** Successful predecessor commits folded into this Run's immutable execution baseline. */
  readonly codeInputs?: readonly { readonly dependency?: string | undefined; readonly branch: string; readonly commit: string }[]
  readonly branch: string
  readonly worktreePath: string
  readonly auth?: PactFlowGitAuth
  readonly validationCommands: readonly PactFlowValidationCommand[]
  readonly validationProfileIds?: readonly string[]
  readonly validationProfileRevisions?: Readonly<Record<string, number>>
  readonly legacyUntrusted?: boolean
}

export interface PactFlowValidationCommand {
  readonly command: string
  readonly args: readonly string[]
  readonly timeoutMs: number
}

export interface PactFlowValidationEvidence extends PactFlowValidationCommand {
  readonly exitCode: 0
  readonly durationMs: number
  /** A03-c: set when the evidence came from the host-owned closing baseline. */
  readonly source?: 'host-baseline'
}

/** Commit evidence accepted from a successful Git-backed Worker. */
export interface PactFlowGitResult {
  readonly branch: string
  readonly commit: string
  readonly remoteRef: string
  readonly syncedAt: number
  readonly validations: readonly PactFlowValidationEvidence[]
  /** Verification-wiring files this task commit changed (surfaced, not blocking). */
  readonly validationSensitiveChanges?: readonly string[]
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
  /** Dependencies whose successful commits must be part of this node's execution baseline. */
  readonly codeInputs?: readonly PactFlowNodeId[]
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
  readonly workerPoolId?: string
  readonly projectConfigRevision?: number
  readonly agentProfileId?: string
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
  /** Present on newly dispatched runs; absent only on legacy 0.1/0.2 history. */
  readonly runNonceHash?: string
  readonly claimTokenHash?: string
  readonly specDigest?: string
  readonly inputSecretName?: string
  readonly modelConnectionId?: string
  readonly ephemeralModelSecret?: boolean
  /** Bound after Job creation; never guessed during plan(). */
  readonly jobUid?: string
  readonly expectedBranch?: string
  readonly expectedBaseCommit?: string
  readonly gitSecretName: string
  readonly cpuRequest: string
  readonly memoryRequest: string
  readonly cpuLimit: string
  readonly memoryLimit: string
  readonly activeDeadlineSeconds: number
  readonly finishedJobTtlSeconds: number
}

export interface PactFlowK3sResult {
  readonly podName: string
  readonly exitCode: number
  readonly commit: string
  readonly branch: string
  readonly harnessVersion: string
  readonly finishedAt: number
  readonly runNonceHash?: string
  readonly claimTokenHash?: string
  readonly specDigest?: string
}

export interface PactFlowReview {
  readonly id: PactFlowReviewId
  readonly needId: PactFlowNeedId
  readonly kind: 'requirement' | 'design' | 'plan' | 'verification' | 'code'
  readonly decision: 'approved' | 'rejected' | 'changes-requested'
  readonly note: string
  readonly recordedAt: number
  readonly approvalRequestId?: string
  readonly needRevision?: number
  readonly evidenceDigest?: string
  /** For verification reviews: digest of the exact delivery subject (task set + commits). */
  readonly subjectDigest?: string
  readonly source?: 'dsh-approval'
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

export interface PactFlowCleanupRecord {
  readonly id: string
  readonly runId?: PactFlowRunId
  readonly needId?: PactFlowNeedId
  readonly target: string
  /** Exact Host-created integration checkout; retry never prepares it again. */
  readonly closing?: PactFlowClosingGit
  readonly closingInputDigest?: string
  /** Pre-merge intent: deletion is forbidden until delivery proof exists. */
  readonly requiresRelease?: boolean
  /**
   * Failure residue kept for human review: discoverable, but never auto-cleaned
   * (including session-recovery reconciliation). Only an explicit cleanup touches it.
   */
  readonly retain?: boolean
  /** Epoch ms when the retention window ends; overdue retained scenes are flagged for review (never auto-deleted). */
  readonly retainUntil?: number
  /** Recorded on-disk size of the retained scene; absent means unmeasured (A05 capacity). */
  readonly sizeBytes?: number
  readonly state: 'pending' | 'failed' | 'succeeded'
  readonly attempt: number
  readonly error?: string
  readonly nextRetryAt?: number
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
  readonly validationProfileIds?: readonly string[]
  readonly k3sGitSecretName?: string
  /** Registered Git Provider id; the Host resolves endpoint, auth mode and credential ref from it. */
  readonly giteaProviderId?: string
  readonly giteaBaseUrl?: string
  readonly giteaOwner?: string
  readonly giteaRepo?: string
  readonly giteaTokenCredentialRef?: string
  readonly giteaUsername?: string
  readonly workerPoolId?: string
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
  readonly needRevision: number
  readonly evidenceDigest: string
  readonly approvalRequestId: string
  readonly source: 'dsh-approval'
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
  /** Subset of dependencies whose successful commits become this node's code input. */
  readonly codeInputs?: readonly string[]
}

export interface UpdatePactFlowNodeDependenciesRequest {
  readonly nodeId: string
  readonly expectedRevision: number
  readonly dependencies: readonly string[]
}

export interface RetryPactFlowNodeRequest {
  readonly nodeId: string
  readonly expectedRevision: number
}

export interface ClaimPactFlowNodeRequest {
  readonly nodeId: string
  readonly expectedRevision: number
  readonly provider: string
  readonly leaseDurationMs: number
}

/** Owner request to resume a paused node (A11); resuming is an explicit human decision. */
export interface ResumePactFlowNodeRequest {
  readonly nodeId: string
  readonly expectedRevision: number
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
  readonly workerPoolId?: string
  readonly modelConnectionId?: string
  readonly agentProfileId?: string
  readonly prompt: string
  readonly leaseDurationMs: number
}

export interface ClosePactFlowNeedRequest {
  readonly needId: string
  readonly expectedRevision: number
  readonly taskRefs?: readonly { readonly remoteRef: string; readonly expectedCommit: string }[]
}

export interface RetryPactFlowCleanupRequest {
  readonly cleanupId: string
}

export interface ClosePactFlowNeedResult {
  readonly need: PactFlowNeed
  readonly release: PactFlowRelease
  readonly pullRequestNumber: number
  readonly pullRequestUrl: string
  readonly integrationBranch: string
  readonly integrationCommit: string
  readonly cleanupFailures: readonly string[]
}

export interface PactFlowHarnessProbeRequest {
  readonly templateId: string
  readonly modelConnectionId?: string
  readonly prompt: string
  readonly timeoutMs: number
}

export interface PactFlowHarnessProbeStage {
  readonly name: 'validate' | 'create-job' | 'model-response' | 'api-response' | 'cli-response' | 'cleanup'
  readonly state: 'succeeded' | 'failed'
  readonly detail: string
}

export interface PactFlowHarnessImageProbeResult {
  readonly success: boolean
  readonly durationMs: number
  readonly output: string
  readonly stages: readonly PactFlowHarnessProbeStage[]
  /** Highest capability level this probe actually reached (A10). */
  readonly achievedLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
  /** Highest level this harness is declared to support (A10). */
  readonly maxLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
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
  /** Highest capability level this probe actually reached (A10). */
  readonly achievedLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
  /** Highest level this harness is declared to support (A10). */
  readonly maxLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
}

export interface PactFlowApiProbeResult {
  readonly kind: 'api'
  readonly templateId: string
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  readonly model: string
  readonly baseUrl: string
  readonly image: string
  readonly modelSecretName: string
  readonly prompt: string
  readonly timeoutMs: number
  readonly requestPath: string
  readonly requestPayload: string
  readonly success: boolean
  readonly durationMs: number
  readonly output: string
  readonly stages: readonly PactFlowHarnessProbeStage[]
  /** Highest capability level this probe actually reached (A10). */
  readonly achievedLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
  /** Highest level this harness is declared to support (A10). */
  readonly maxLevel?: 'connection' | 'protocol' | 'tool-invocation' | 'artifact' | 'verification' | 'cancellation'
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
/** Host-only replay index; the client still receives PactFlowDagProjection. */
export interface PactFlowDagState extends PactFlowDagProjection { readonly needIds: readonly PactFlowNeedId[] }
export interface PactFlowRunsProjection { readonly byId: Readonly<Record<string, PactFlowRun>> }
export interface PactFlowDeliveryProjection {
  readonly reviews: Readonly<Record<string, PactFlowReview>>
  readonly documents: Readonly<Record<string, PactFlowDocument>>
  readonly releases: Readonly<Record<string, PactFlowRelease>>
  readonly cleanups: Readonly<Record<string, PactFlowCleanupRecord>>
}
/** Compact Host-only reference indexes; not part of the public delivery view. */
export interface PactFlowDeliveryState extends PactFlowDeliveryProjection {
  readonly needIds: readonly PactFlowNeedId[]
  readonly runNeeds: Readonly<Record<string, PactFlowNeedId>>
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
    'pactflow/run-bound': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
    'pactflow/run-queued': { readonly v: 1; readonly queueId: string; readonly sessionId: string; readonly nodeId: PactFlowNodeId; readonly requestedAt: number }
    'pactflow/run-queue-cancelled': { readonly v: 1; readonly queueId: string; readonly reason: string; readonly cancelledAt: number }
    'pactflow/cleanup-recorded': { readonly v: 1; readonly record: PactFlowCleanupRecord }
    'pactflow/run-claimed': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
    'pactflow/run-renewed': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
    'pactflow/run-settled': { readonly v: 1; readonly run: PactFlowRun; readonly node: PactFlowNode }
  }
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionStateMap {
    pactflowProject: PactFlowProjectProjection
    pactflowNeeds: PactFlowNeedsProjection
    pactflowDag: PactFlowDagState
    pactflowRuns: PactFlowRunsProjection
    pactflowDelivery: PactFlowDeliveryState
  }
  interface SessionProjectionMap {
    pactflowProject: PactFlowProjectProjection
    pactflowNeeds: PactFlowNeedsProjection
    pactflowDag: PactFlowDagProjection
    pactflowRuns: PactFlowRunsProjection
    pactflowDelivery: PactFlowDeliveryProjection
  }
}

/** Retained failure-scene status (A05 extension); read-only, never triggers deletion. */
export interface PactFlowRetentionSummary {
  readonly total: number
  readonly overdue: readonly { readonly id: string; readonly target: string; readonly retainUntil?: number }[]
  /** Sum of recorded retained-scene sizes; unmeasured scenes contribute nothing. */
  readonly retainedBytes: number
  /** True only when every retained scene carries a recorded size (so the sum is a true total). */
  readonly measured: boolean
  /** True when the measured retained total meets or exceeds the disk budget. */
  readonly overBudget: boolean
  readonly maxBytes: number
}

/** Read-only project handover summary (A12); exposed on the public type surface for Remote boundaries. */
export interface PactFlowHandoverSummary {
  readonly project: { readonly id: string; readonly name: string; readonly revision: number } | null
  readonly gitRemote?: string
  readonly defaultBranch?: string
  readonly needs: readonly { readonly id: string; readonly title: string; readonly phase: string; readonly revision: number }[]
  readonly nodes: readonly { readonly id: string; readonly needId: string; readonly state: string }[]
  /** Exact Git artifacts produced, so the work is recoverable without this plugin. */
  readonly artifacts: readonly {
    readonly runId: string
    readonly branch: string
    readonly commit: string
    /**
     * Registered validation commands that actually ran for this delivery. Zero means
     * the delivery carries NO automatic verification and must be read as such
     * (validation-integrity-signals: "零自动验证必须可识别").
     */
    readonly validationsExecuted: number
  }[]
  /** Responsibilities still open (pending/failed), including retained failure scenes. */
  readonly pendingCleanups: readonly {
    readonly id: string
    readonly target: string
    readonly state: string
    readonly retain?: boolean
    readonly baselineValidationsExecuted?: number | undefined
  }[]
  /** The installed package build version, so an old log's reader build is traceable. */
  readonly packageVersion: string
  /** The external Session event producer (reader) version this build registered. */
  readonly eventProducerVersion: string
}

/**
 * Read-only uninstall drain status (A12): across the plugin's PactFlow sessions,
 * whether any Run is non-terminal or any cleanup responsibility is unfinished.
 * Exposed on the public type surface for the Remote boundary; never mutates state
 * and never triggers cleanup.
 */
export interface PactFlowDrainStatus {
  /** Derived from the two lists below — never a caller input. */
  readonly safeToUninstall: boolean
  readonly activeRuns: readonly {
    readonly sessionId: string
    readonly runId: string
    readonly nodeId: string
    readonly state: string
  }[]
  /** Unfinished cleanup responsibilities (state !== 'succeeded'). */
  readonly pendingCleanups: readonly {
    readonly sessionId: string
    readonly id: string
    readonly target: string
    readonly state: string
    readonly retain?: boolean
  }[]
}
