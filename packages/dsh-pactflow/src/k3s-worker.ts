/** K3s Job provider for immutable PactFlow Worker runs. */

import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  Observable,
  type ConfigurationOptions,
  type V1ConfigMap,
  type V1EnvVar,
  type V1Job,
  type V1Pod,
  type V1Secret,
  type V1ObjectMeta,
} from '@kubernetes/client-node'
import type {
  PactFlowApiMode,
  PactFlowApiProbeResult,
  PactFlowGitRunSpec,
  PactFlowHarness,
  PactFlowHarnessImageProbeResult,
  PactFlowHarnessProbeResult,
  PactFlowHarnessProbeStage,
  PactFlowHarnessTemplateView,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowK3sSettings,
  PactFlowRunId,
} from './types.ts'

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IMAGE_DIGEST = /^.+@sha256:[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40,64}$/
/** Cluster-side backstop that GCs probe Jobs (and bound Secrets) after a host crash. */
const PROBE_FINISHED_JOB_TTL_SECONDS = 3_600
/** Independent deadline for one Kubernetes create, replace, or delete call. */
const PACTFLOW_K3S_REQUEST_TIMEOUT_MS = 30_000

/** A create/replace/delete call neither completed nor failed within its independent deadline. */
export class PactFlowK3sRequestTimeoutError extends Error {
  readonly timeoutMs: number
  constructor(timeoutMs: number) {
    super(`PactFlow K3s request did not complete within ${timeoutMs}ms`)
    this.name = 'PactFlowK3sRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

/** Persisted resources may never be deleted using only a reusable name. */
function resourceIdentityError(spec: PactFlowK3sRunSpec): string | undefined {
  if (typeof spec.jobUid !== 'string' || spec.jobUid.trim() === ''
    || [spec.runNonceHash, spec.claimTokenHash, spec.specDigest].some(value =>
      typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value))) {
    return `PactFlow K3s Run "${spec.jobName}" has incomplete persisted resource identity`
  }
  return undefined
}

/** Result admission is stricter than compensation for a not-yet-bound Job. */
export function pactFlowK3sResultIdentityError(spec: PactFlowK3sRunSpec): string | undefined {
  const resourceError = resourceIdentityError(spec)
  if (resourceError !== undefined) return resourceError
  if (typeof spec.expectedBranch !== 'string' || spec.expectedBranch.trim() === ''
    || typeof spec.expectedBaseCommit !== 'string' || !COMMIT.test(spec.expectedBaseCommit)
    || !IMAGE_DIGEST.test(spec.image)) {
    return `PactFlow K3s Run "${spec.jobName}" has incomplete result identity`
  }
  return undefined
}

export interface PactFlowK3sRuntimeSecrets {
  readonly runNonce: string
  readonly claimToken: string
}

/** Durable cleanup responsibility milestones emitted around probe resource creation. */
export type PactFlowProbeCleanupEvent =
  | { readonly phase: 'intent'; readonly jobName: string; readonly secretName?: string }
  | { readonly phase: 'confirmed'; readonly jobName: string; readonly jobUid: string;
      readonly secretName?: string; readonly secretUid?: string }
  | { readonly phase: 'cleaned'; readonly jobName: string }

export type PactFlowProbeCleanupRecorder = (event: PactFlowProbeCleanupEvent) => Promise<void>

/** Recorded identity of one probe's external resources; incomplete records fail closed. */
export interface PactFlowProbeCleanupIdentity {
  readonly jobName: string
  readonly jobUid?: string
  readonly secretName?: string
  readonly secretUid?: string
}

export function pactFlowSecretHash(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

/** Digest only immutable, non-secret Run inputs; raw prompt/tokens never enter Session Events. */
export function pactFlowK3sSpecDigest(
  spec: PactFlowK3sRunSpec,
  git: PactFlowGitRunSpec,
  prompt: string,
): string {
  const canonical = JSON.stringify({
    templateId: spec.templateId, namespace: spec.namespace, jobName: spec.jobName,
    configMapName: spec.configMapName, inputSecretName: spec.inputSecretName,
    image: spec.image, imagePullSecret: spec.imagePullSecret, harness: spec.harness,
    apiMode: spec.apiMode, model: spec.model, baseUrl: spec.baseUrl,
    modelSecretName: spec.modelSecretName, gitSecretName: spec.gitSecretName,
    cpuRequest: spec.cpuRequest, memoryRequest: spec.memoryRequest,
    cpuLimit: spec.cpuLimit, memoryLimit: spec.memoryLimit,
    activeDeadlineSeconds: spec.activeDeadlineSeconds,
    finishedJobTtlSeconds: spec.finishedJobTtlSeconds,
    runNonceHash: spec.runNonceHash, claimTokenHash: spec.claimTokenHash,
    expectedBranch: spec.expectedBranch, expectedBaseCommit: spec.expectedBaseCommit,
    remote: git.remote, remoteUrl: git.remoteUrl, defaultBranch: git.defaultBranch,
    baseCommit: git.baseCommit, branch: git.branch, prompt,
  })
  return createHash('sha256').update(canonical).digest('hex')
}

export const PACTFLOW_HARNESS_API_MODE: Readonly<Record<PactFlowHarness, PactFlowApiMode>> = {
  claude: 'anthropic-messages',
  codex: 'openai-responses',
  opencode: 'openai-chat-completions',
  dsh: 'openai-chat-completions',
}

export function harnessVersionCommand(harness: PactFlowHarness): readonly string[] {
  return [harness === 'claude' ? 'claude' : harness, '--version']
}

export type PactFlowHarnessTemplateConfig = PactFlowHarnessTemplateView

export type PactFlowK3sConfig = PactFlowK3sSettings

interface WorkerResultDocument {
  readonly schema: 'dsh_pactflow_k3s_result/v1'
  readonly status: 'succeeded' | 'failed'
  readonly commit: string
  readonly branch: string
  readonly harnessVersion: string
  readonly agentExitCode: number
  readonly pushExitCode: number
  readonly runNonceHash?: string
  readonly claimTokenHash?: string
  readonly specDigest?: string
}

export type PactFlowK3sObservation =
  | { readonly state: 'pending' | 'missing' }
  | { readonly state: 'succeeded'; readonly result: PactFlowK3sResult }
  | { readonly state: 'failed'; readonly finishedAt: number; readonly outcome: string }

/** Host-side K3s client; Pods receive no API token and never write Session events. */
export class PactFlowK3sWorker {
  private readonly batch: BatchV1Api
  private readonly core: CoreV1Api
  private readonly templates = new Map<string, PactFlowHarnessTemplateConfig>()
  private readonly pendingRuntimeSecrets = new Map<string, PactFlowK3sRuntimeSecrets>()
  private requestTimeoutMs = PACTFLOW_K3S_REQUEST_TIMEOUT_MS

  constructor(private readonly config: PactFlowK3sConfig) {
    this.requireDnsName('namespace', config.namespace)
    this.requireDnsName('imagePullSecret', config.imagePullSecret)
    if (config.kubeconfig !== undefined && !isAbsolute(config.kubeconfig)) {
      throw new Error('PactFlow K3s kubeconfig must be an absolute path')
    }
    if (!Number.isSafeInteger(config.pollIntervalMs) || config.pollIntervalMs < 250 || config.pollIntervalMs > 30_000) {
      throw new Error('PactFlow K3s pollIntervalMs must be 250-30000')
    }
    for (const template of config.templates) {
      this.validateTemplate(template)
      if (this.templates.has(template.id)) throw new Error(`duplicate PactFlow K3s template "${template.id}"`)
      this.templates.set(template.id, Object.freeze({ ...template }))
    }
    const kubeconfig = new KubeConfig()
    if (config.kubeconfig === undefined) kubeconfig.loadFromDefault()
    else kubeconfig.loadFromFile(config.kubeconfig)
    if (config.context !== undefined) kubeconfig.setCurrentContext(config.context)
    this.batch = kubeconfig.makeApiClient(BatchV1Api)
    this.core = kubeconfig.makeApiClient(CoreV1Api)
  }

  /** Detached non-secret templates safe for Remote and UI consumers. */
  listTemplates(): readonly PactFlowHarnessTemplateConfig[] {
    return [...this.templates.values()]
  }

  /** Stable non-secret connection identity for durable probe cleanup records. */
  connectionFingerprint(): string {
    return createHash('sha256').update(JSON.stringify({
      namespace: this.config.namespace,
      kubeconfig: this.config.kubeconfig ?? '(default)',
      context: this.config.context ?? '(default)',
    })).digest('hex')
  }

  /**
   * Fail one API call closed after an independent deadline. The abort signal
   * truly closes the request, so the host never keeps a dangling connection
   * behind the race; the caller decides how the uncertain outcome is tracked.
   */
  private async withRequestDeadline<T>(
    operation: (options: ConfigurationOptions) => Promise<T>,
  ): Promise<T> {
    const stop = AbortSignal.timeout(this.requestTimeoutMs)
    const options: ConfigurationOptions = {
      middlewareMergeStrategy: 'append',
      middleware: [{
        pre(request) {
          const existing = request.getSignal()
          request.setSignal(existing === undefined ? stop : AbortSignal.any([existing, stop]))
          return new Observable(Promise.resolve(request))
        },
        post(response) { return new Observable(Promise.resolve(response)) },
      }],
    }
    const call = Promise.resolve().then(() => operation(options))
    void call.catch(() => { /* a late rejection after the deadline belongs to the timeout report */ })
    let clearTimer!: () => void
    const expiration = new Promise<never>((_, reject) => {
      const timer = setTimeout(() => reject(new PactFlowK3sRequestTimeoutError(this.requestTimeoutMs)), this.requestTimeoutMs)
      clearTimer = () => clearTimeout(timer)
    })
    try {
      return await Promise.race([call, expiration])
    } finally {
      clearTimer()
    }
  }

  private isTimeout(error: unknown): error is PactFlowK3sRequestTimeoutError {
    return error instanceof PactFlowK3sRequestTimeoutError
  }

  /** Verify namespace access without reading any Secret payload. */
  async preflight(): Promise<void> {
    try {
      await this.core.readNamespace({ name: this.config.namespace })
    } catch {
      throw new Error(`PactFlow cannot access K3s namespace "${this.config.namespace}"`)
    }
  }

  /** List image-pull Secret names without reading their payloads. */
  async listImagePullSecrets(): Promise<readonly string[]> {
    const response = await this.core.listNamespacedSecret({ namespace: this.config.namespace })
    return (response.items ?? [])
      .filter(secret => secret.type === 'kubernetes.io/dockerconfigjson')
      .map(secret => secret.metadata?.name)
      .filter((name): name is string => typeof name === 'string' && name.length > 0)
      .sort((left, right) => left.localeCompare(right))
  }

  /** List project Git Secret names without reading Secret payloads. */
  async listGitSecrets(): Promise<readonly string[]> {
    const response = await this.core.listNamespacedSecret({ namespace: this.config.namespace })
    return (response.items ?? [])
      .filter(secret => secret.type === 'Opaque')
      .map(secret => secret.metadata?.name)
      .filter((name): name is string => typeof name === 'string' && name.startsWith('pactflow-git-'))
      .sort((left, right) => left.localeCompare(right))
  }

  /** Validate the task inputs that would enter the ConfigMap before claim. */
  preflightRun(git: PactFlowGitRunSpec, prompt: string): void {
    if (!/^(?:ssh:\/\/|[^\s@]+@[^\s:]+:)/.test(git.remoteUrl)) {
      throw new Error('PactFlow K3s Workers require an SSH Git remote')
    }
    const promptBytes = new TextEncoder().encode(prompt).length
    if (promptBytes === 0 || promptBytes > 262_144) {
      throw new Error('PactFlow K3s Worker prompt must contain 1-262144 UTF-8 bytes')
    }
  }

  /** Resolve one configured template into an immutable Run spec. */
  plan(
    runId: PactFlowRunId,
    templateId: string,
    gitSecretName: string,
    leaseDurationMs: number,
    git?: PactFlowGitRunSpec,
    prompt = '',
  ): PactFlowK3sRunSpec {
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    this.requireDnsName('gitSecretName', gitSecretName)
    const suffix = runId.slice('run-'.length, 'run-'.length + 20).toLowerCase()
    const activeDeadlineSeconds = Math.max(1, Math.floor(leaseDurationMs / 1_000))
    const runNonce = randomBytes(32).toString('hex')
    const claimToken = randomBytes(32).toString('hex')
    const base: PactFlowK3sRunSpec = {
      templateId: template.id,
      namespace: this.config.namespace,
      jobName: `dsh-pf-${suffix}`,
      configMapName: `dsh-pf-${suffix}`,
      image: template.image,
      imagePullSecret: this.config.imagePullSecret,
      harness: template.harness,
      apiMode: template.apiMode,
      model: template.model,
      baseUrl: template.baseUrl,
      modelSecretName: template.modelSecretName,
      gitSecretName,
      inputSecretName: `dsh-pf-${suffix}-input`,
      ...(git === undefined ? {} : { expectedBranch: git.branch, expectedBaseCommit: git.baseCommit }),
      runNonceHash: pactFlowSecretHash(runNonce),
      claimTokenHash: pactFlowSecretHash(claimToken),
      cpuRequest: template.cpuRequest,
      memoryRequest: template.memoryRequest,
      cpuLimit: template.cpuLimit,
      memoryLimit: template.memoryLimit,
      activeDeadlineSeconds,
      finishedJobTtlSeconds: this.config.finishedJobTtlSeconds ?? 86_400,
    }
    const spec: PactFlowK3sRunSpec = {
      ...base,
      specDigest: pactFlowK3sSpecDigest(base, git ?? {
        remote: '', remoteUrl: '', defaultBranch: '', baseCommit: '', branch: '', worktreePath: '', validationCommands: [],
      }, prompt),
    }
    this.pendingRuntimeSecrets.set(spec.jobName, { runNonce, claimToken })
    return spec
  }

  /** Create the immutable ConfigMap and Job, then wait for a termination result. */
  async run(
    spec: PactFlowK3sRunSpec,
    git: PactFlowGitRunSpec,
    prompt: string,
    signal: AbortSignal,
    modelApiKey?: string,
    runtimeSecrets?: PactFlowK3sRuntimeSecrets,
    onBound?: (jobUid: string) => void | Promise<void>,
  ): Promise<PactFlowK3sResult> {
    const secrets = runtimeSecrets ?? this.pendingRuntimeSecrets.get(spec.jobName)
    if (spec.specDigest !== undefined && spec.expectedBranch !== undefined
      && pactFlowK3sSpecDigest(spec, git, prompt) !== spec.specDigest) {
      throw new Error(`PactFlow K3s Run "${spec.jobName}" Spec digest does not match its immutable inputs`)
    }
    if (secrets === undefined || pactFlowSecretHash(secrets.runNonce) !== spec.runNonceHash
      || pactFlowSecretHash(secrets.claimToken) !== spec.claimTokenHash) {
      throw new Error(`PactFlow K3s Run "${spec.jobName}" has no matching runtime claim secrets`)
    }
    let createdModelSecret: V1Secret | undefined
    let createdInputSecret: V1Secret | undefined
    if (spec.ephemeralModelSecret === true) {
      if (modelApiKey === undefined || modelApiKey === '') throw new Error('PactFlow model API key is not configured')
      try {
        const modelSecret = this.modelSecret(spec.modelSecretName, spec.namespace, spec.apiMode, modelApiKey)
        createdModelSecret = await this.withRequestDeadline(options => this.core.createNamespacedSecret({
          namespace: spec.namespace,
          body: {
            ...modelSecret,
            metadata: {
              ...modelSecret.metadata,
              labels: this.labels(spec),
              annotations: this.annotations(spec),
            },
          },
        }, options))
      } catch (error) {
        if (this.isTimeout(error)) {
          // The request may still have created this per-run Secret; compensate
          // by its unique name instead of leaving it unowned.
          await this.deleteModelSecret(spec).catch(() => {})
        }
        const note = this.isTimeout(error) ? `; request timed out after ${error.timeoutMs}ms` : ''
        throw new Error(`PactFlow failed to create model Secret "${spec.modelSecretName}"${note}`)
      }
    }
    try {
      createdInputSecret = await this.withRequestDeadline(options => this.core.createNamespacedSecret({
        namespace: spec.namespace,
        body: this.inputSecret(spec, git, prompt, secrets),
      }, options))
    } catch (error) {
      const note = this.isTimeout(error) ? `; request timed out after ${error.timeoutMs}ms` : ''
      const compensationFailed = await this.compensateCreatedChildren(spec, createdModelSecret)
      throw new Error(`PactFlow failed to create K3s input Secret "${spec.inputSecretName ?? spec.jobName}"${note}${compensationFailed ? '; compensation of created resources also failed' : ''}`)
    }
    const configMap = this.configMap(spec)
    let createdConfigMap: V1ConfigMap
    try {
      createdConfigMap = await this.withRequestDeadline(options => this.core.createNamespacedConfigMap({
        namespace: spec.namespace, body: configMap,
      }, options))
    } catch (error) {
      const note = this.isTimeout(error) ? `; request timed out after ${error.timeoutMs}ms` : ''
      const compensationFailed = await this.compensateCreatedChildren(spec, createdModelSecret)
      throw new Error(`PactFlow failed to create K3s ConfigMap "${spec.configMapName}"${note}${compensationFailed ? '; compensation of created resources also failed' : ''}`)
    }
    let createdJob: V1Job
    try {
      createdJob = await this.withRequestDeadline(options => this.batch.createNamespacedJob({
        namespace: spec.namespace, body: this.job(spec),
      }, options))
    } catch (error) {
      const note = this.isTimeout(error) ? `; request timed out after ${error.timeoutMs}ms` : ''
      let compensationFailed = false
      if (this.isTimeout(error)) {
        // The Job may exist without a usable UID; compensate our own lineage
        // by the exact per-run names, children first.
        try { await this.cancel(spec) } catch { compensationFailed = true }
      } else {
        compensationFailed = await this.compensateCreatedChildren(spec, createdModelSecret)
      }
      throw new Error(`PactFlow failed to create K3s Job "${spec.jobName}"${note}${compensationFailed ? '; compensation of created resources also failed' : ''}`)
    }
    const jobUid = createdJob.metadata?.uid
    if (jobUid === undefined) {
      let compensationFailed = false
      try { await this.cancel(spec) } catch { compensationFailed = true }
      throw new Error(`PactFlow K3s Job "${spec.jobName}" has no UID${compensationFailed ? '; compensation of created resources also failed' : ''}`)
    }
    try {
      createdConfigMap.metadata = {
        ...createdConfigMap.metadata,
        ownerReferences: [{
          apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: jobUid,
          controller: true, blockOwnerDeletion: true,
        }],
      }
      await this.withRequestDeadline(options => this.core.replaceNamespacedConfigMap({
        name: spec.configMapName, namespace: spec.namespace, body: createdConfigMap,
      }, options))
      if (createdModelSecret !== undefined) {
        createdModelSecret.metadata = {
          ...createdModelSecret.metadata,
          ownerReferences: [{
            apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: jobUid,
            controller: true, blockOwnerDeletion: true,
          }],
        }
        await this.withRequestDeadline(options => this.core.replaceNamespacedSecret({
          name: spec.modelSecretName, namespace: spec.namespace, body: createdModelSecret,
        }, options))
      }
      if (createdInputSecret !== undefined) {
        createdInputSecret.metadata = {
          ...createdInputSecret.metadata,
          ownerReferences: [{
            apiVersion: 'batch/v1', kind: 'Job', name: spec.jobName, uid: jobUid,
            controller: true, blockOwnerDeletion: true,
          }],
        }
        await this.withRequestDeadline(options => this.core.replaceNamespacedSecret({
          name: spec.inputSecretName!, namespace: spec.namespace, body: createdInputSecret,
        }, options))
      }
    } catch {
      // Children may lack ownerReferences here, so compensation stays name-based;
      // the binding failure itself must not be masked by a cleanup error.
      try { await this.cancel(spec) } catch { /* the failed run leaves a durable cleanup responsibility for the Host */ }
      throw new Error(`PactFlow failed to bind ConfigMap "${spec.configMapName}" to its Job`)
    }
    this.pendingRuntimeSecrets.delete(spec.jobName)
    const boundSpec: PactFlowK3sRunSpec = { ...spec, jobUid }
    try {
      await onBound?.(jobUid)
    } catch (error) {
      // Owner binding already succeeded, so compensation must carry the exact
      // Job UID instead of the reusable name; the not-yet-bound private path
      // above stays name-based because children may lack ownerReferences.
      try { await this.cancel(boundSpec) } catch { /* preserve the binding failure; cleanup is retried by Host */ }
      throw error
    }
    return await this.waitForResult(boundSpec, signal)
  }

  /** Run the real Harness CLI in a short-lived Job and return bounded step logs. */
  async probe(
    templateId: string, prompt: string, timeoutMs: number, modelApiKey?: string,
    signal: AbortSignal = new AbortController().signal,
    record?: PactFlowProbeCleanupRecorder,
  ): Promise<PactFlowHarnessProbeResult> {
    signal.throwIfAborted()
    const startedAt = Date.now()
    const deadline = performance.now() + timeoutMs
    const stages: PactFlowHarnessProbeStage[] = []
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    const promptBytes = new TextEncoder().encode(prompt).length
    if (promptBytes === 0 || promptBytes > 65_536 || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 10_000 || timeoutMs > 600_000) {
      throw new Error('PactFlow Harness probe requires a 1-65536 byte prompt and timeoutMs 10000-600000')
    }
    stages.push({ name: 'validate', state: 'succeeded', detail: 'template, protocol, prompt, and timeout accepted' })
    const jobName = `dsh-pf-probe-${randomUUID().slice(0, 20)}`
    const runtimeTemplate = modelApiKey === undefined
      ? template
      : { ...template, modelSecretName: `${jobName}-model` }
    let output = ''
    let success = false
    let jobUid: string | undefined
    let secretUid: string | undefined
    let createdModelSecret: V1Secret | undefined
    let secretState: 'none' | 'confirmed' | 'unconfirmed' = 'none'
    let jobState: 'none' | 'confirmed' | 'unconfirmed' = 'none'
    try {
      // Persistence of the cleanup responsibility must succeed before any
      // external resource is created; a recorder failure keeps the probe closed.
      await record?.({ phase: 'intent', jobName,
        ...(modelApiKey === undefined ? {} : { secretName: runtimeTemplate.modelSecretName }) })
      if (modelApiKey !== undefined) {
        let createdSecret: V1Secret
        try {
          createdSecret = await this.withRequestDeadline(options => this.core.createNamespacedSecret({
            namespace: this.config.namespace,
            body: this.modelSecret(runtimeTemplate.modelSecretName, this.config.namespace, runtimeTemplate.apiMode, modelApiKey),
          }, options))
        } catch (error) {
          if (this.isTimeout(error)) secretState = 'unconfirmed'
          throw error
        }
        createdModelSecret = createdSecret
        secretUid = createdSecret?.metadata?.uid
        if (typeof secretUid !== 'string' || secretUid.trim() === '') {
          secretState = 'unconfirmed'
          throw new Error('PactFlow probe creation did not return a Secret UID')
        }
        secretState = 'confirmed'
      }
      this.checkProbeLifetime(signal, deadline)
      let createdJob: V1Job
      try {
        createdJob = await this.withRequestDeadline(options => this.batch.createNamespacedJob({
          namespace: this.config.namespace,
          body: this.probeJob(jobName, runtimeTemplate, prompt, timeoutMs),
        }, options))
      } catch (error) {
        if (this.isTimeout(error)) jobState = 'unconfirmed'
        throw error
      }
      jobUid = createdJob?.metadata?.uid
      if (!jobUid) {
        jobState = 'unconfirmed'
        throw new Error('PactFlow probe creation did not return a Job UID')
      }
      jobState = 'confirmed'
      if (createdModelSecret !== undefined) {
        await this.bindProbeSecretOwner(runtimeTemplate.modelSecretName, createdModelSecret, jobName, jobUid)
      }
      await record?.({ phase: 'confirmed', jobName, jobUid,
        ...(modelApiKey === undefined ? {} : { secretName: runtimeTemplate.modelSecretName, secretUid: secretUid! }) })
      stages.push({ name: 'create-job', state: 'succeeded', detail: `Job ${jobName} created` })
      for (;;) {
        this.checkProbeLifetime(signal, deadline)
        const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.config.namespace }, this.probeReadOptions(signal, deadline))
        this.checkProbeLifetime(signal, deadline)
        if (job.metadata?.uid !== jobUid) throw new Error('PactFlow probe Job identity changed')
        if ((job.status?.succeeded ?? 0) > 0 || (job.status?.failed ?? 0) > 0) {
          output = await this.probeLog(jobName, jobUid, this.probeReadOptions(signal, deadline))
          this.checkProbeLifetime(signal, deadline)
          success = (job.status?.succeeded ?? 0) > 0
          if (success && output.trim() === '') success = false
          stages.push({
            name: 'model-response',
            state: success ? 'succeeded' : 'failed',
            detail: success ? 'Harness returned successfully' : 'Harness Job failed',
          })
          break
        }
        await this.delay(signal)
      }
    } catch (error) {
      output = error instanceof Error ? this.redactProbeOutput(error.message, modelApiKey).slice(0, 4_096) : 'Harness probe failed'
      stages.push({ name: 'model-response', state: 'failed', detail: 'Harness probe failed before a result' })
    } finally {
      // 'leftover' keeps the ledger entry only when a created resource may
      // still exist without a usable identity or a confirmed delete failed.
      let leftover = jobState === 'unconfirmed' || secretState === 'unconfirmed'
      try {
        const deletedPods = await this.cleanupProbeResources(jobName, jobUid)
        stages.push({
          name: 'cleanup', state: 'succeeded',
          detail: `Job ${jobName} and ${String(deletedPods)} probe Pods deleted`,
        })
      } catch {
        success = false
        if (jobState === 'confirmed') leftover = true
        stages.push({ name: 'cleanup', state: 'failed', detail: `Job or Pods for ${jobName} cleanup failed` })
      }
      if (modelApiKey !== undefined) {
        try {
          if (typeof secretUid !== 'string' || secretUid.trim() === '') throw new Error('PactFlow probe Secret identity is unconfirmed')
          const uid = secretUid
          await this.withRequestDeadline(options => this.core.deleteNamespacedSecret({ name: runtimeTemplate.modelSecretName, namespace: this.config.namespace,
            body: { preconditions: { uid } } }, options))
        } catch (error) {
          if (!this.isNotFound(error)) {
            success = false
            if (secretState === 'confirmed') leftover = true
            stages.push({ name: 'cleanup', state: 'failed', detail: `Secret ${runtimeTemplate.modelSecretName} cleanup failed` })
          }
        }
      }
      if (!leftover) {
        try { await record?.({ phase: 'cleaned', jobName }) } catch { /* startup reconciliation retries entry removal */ }
      }
    }
    if (signal.aborted) success = false
    return {
      kind: 'harness',
      templateId: template.id,
      harness: template.harness,
      apiMode: template.apiMode,
      model: template.model,
      baseUrl: template.baseUrl,
      image: template.image,
      modelSecretName: runtimeTemplate.modelSecretName,
      prompt,
      timeoutMs,
      success,
      durationMs: Date.now() - startedAt,
      output: this.bounded(this.redactProbeOutput(output, modelApiKey), 16_384),
      stages,
    }
  }

  /** Pull and start one Harness image, then verify its CLI without any model or Worker Pool. */
  async probeImage(
    templateId: string, timeoutMs: number, signal: AbortSignal = new AbortController().signal,
    record?: PactFlowProbeCleanupRecorder,
  ): Promise<PactFlowHarnessImageProbeResult> {
    signal.throwIfAborted()
    const startedAt = Date.now()
    const deadline = performance.now() + timeoutMs
    const stages: PactFlowHarnessProbeStage[] = []
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 10_000 || timeoutMs > 600_000) {
      throw new Error('PactFlow Harness image probe requires timeoutMs 10000-600000')
    }
    stages.push({ name: 'validate', state: 'succeeded', detail: 'image digest, resources, and CLI command accepted' })
    const jobName = `dsh-pf-image-${randomUUID().slice(0, 20)}`
    let output = ''
    let success = false
    let jobUid: string | undefined
    let jobState: 'none' | 'confirmed' | 'unconfirmed' = 'none'
    try {
      // Persistence of the cleanup responsibility must succeed before any
      // external resource is created; a recorder failure keeps the probe closed.
      await record?.({ phase: 'intent', jobName })
      this.checkProbeLifetime(signal, deadline)
      let createdJob: V1Job
      try {
        createdJob = await this.withRequestDeadline(options => this.batch.createNamespacedJob({
          namespace: this.config.namespace,
          body: this.imageProbeJob(jobName, template, timeoutMs),
        }, options))
      } catch (error) {
        if (this.isTimeout(error)) jobState = 'unconfirmed'
        throw error
      }
      jobUid = createdJob?.metadata?.uid
      if (!jobUid) {
        jobState = 'unconfirmed'
        throw new Error('PactFlow probe creation did not return a Job UID')
      }
      jobState = 'confirmed'
      await record?.({ phase: 'confirmed', jobName, jobUid })
      stages.push({ name: 'create-job', state: 'succeeded', detail: `Job ${jobName} created` })
      for (;;) {
        this.checkProbeLifetime(signal, deadline)
        const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.config.namespace }, this.probeReadOptions(signal, deadline))
        this.checkProbeLifetime(signal, deadline)
        if (job.metadata?.uid !== jobUid) throw new Error('PactFlow probe Job identity changed')
        if ((job.status?.succeeded ?? 0) > 0 || (job.status?.failed ?? 0) > 0) {
          output = await this.probeLog(jobName, jobUid, this.probeReadOptions(signal, deadline))
          this.checkProbeLifetime(signal, deadline)
          success = (job.status?.succeeded ?? 0) > 0
          if (success && output.trim() === '') success = false
          stages.push({
            name: 'cli-response', state: success ? 'succeeded' : 'failed',
            detail: success ? 'Harness CLI returned successfully' : 'Harness CLI Job failed',
          })
          break
        }
        await this.delay(signal)
      }
    } catch (error) {
      output = error instanceof Error ? error.message.slice(0, 4_096) : 'Harness image probe failed'
      stages.push({ name: 'cli-response', state: 'failed', detail: 'Harness image probe failed before a result' })
    } finally {
      // 'leftover' keeps the ledger entry only when a created resource may
      // still exist without a usable identity or a confirmed delete failed.
      let leftover = jobState === 'unconfirmed'
      try {
        const deletedPods = await this.cleanupProbeResources(jobName, jobUid)
        stages.push({
          name: 'cleanup', state: 'succeeded',
          detail: `Job ${jobName} and ${String(deletedPods)} probe Pods deleted`,
        })
      } catch {
        success = false
        if (jobState === 'confirmed') leftover = true
        stages.push({ name: 'cleanup', state: 'failed', detail: `Job or Pods for ${jobName} cleanup failed` })
      }
      if (!leftover) {
        try { await record?.({ phase: 'cleaned', jobName }) } catch { /* startup reconciliation retries entry removal */ }
      }
    }
    if (signal.aborted) success = false
    return { success, durationMs: Date.now() - startedAt, output: this.bounded(output, 16_384), stages }
  }

  /** Send one direct protocol request in a short-lived Job without invoking the Harness CLI. */
  async probeApi(
    templateId: string, prompt: string, timeoutMs: number, modelApiKey?: string,
    signal: AbortSignal = new AbortController().signal,
    record?: PactFlowProbeCleanupRecorder,
  ): Promise<PactFlowApiProbeResult> {
    signal.throwIfAborted()
    const startedAt = Date.now()
    const deadline = performance.now() + timeoutMs
    const stages: PactFlowHarnessProbeStage[] = []
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    const promptBytes = new TextEncoder().encode(prompt).length
    if (promptBytes === 0 || promptBytes > 65_536 || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 10_000 || timeoutMs > 600_000) {
      throw new Error('PactFlow API probe requires a 1-65536 byte prompt and timeoutMs 10000-600000')
    }
    const request = this.apiRequest(template, prompt)
    stages.push({ name: 'validate', state: 'succeeded', detail: 'protocol, URL, payload, and timeout accepted' })
    const jobName = `dsh-pf-api-${randomUUID().slice(0, 20)}`
    const runtimeTemplate = modelApiKey === undefined
      ? template
      : { ...template, modelSecretName: `${jobName}-model` }
    let output = ''
    let success = false
    let jobUid: string | undefined
    let secretUid: string | undefined
    let createdModelSecret: V1Secret | undefined
    let secretState: 'none' | 'confirmed' | 'unconfirmed' = 'none'
    let jobState: 'none' | 'confirmed' | 'unconfirmed' = 'none'
    try {
      // Persistence of the cleanup responsibility must succeed before any
      // external resource is created; a recorder failure keeps the probe closed.
      await record?.({ phase: 'intent', jobName,
        ...(modelApiKey === undefined ? {} : { secretName: runtimeTemplate.modelSecretName }) })
      if (modelApiKey !== undefined) {
        let createdSecret: V1Secret
        try {
          createdSecret = await this.withRequestDeadline(options => this.core.createNamespacedSecret({
            namespace: this.config.namespace,
            body: this.modelSecret(runtimeTemplate.modelSecretName, this.config.namespace, runtimeTemplate.apiMode, modelApiKey),
          }, options))
        } catch (error) {
          if (this.isTimeout(error)) secretState = 'unconfirmed'
          throw error
        }
        createdModelSecret = createdSecret
        secretUid = createdSecret?.metadata?.uid
        if (typeof secretUid !== 'string' || secretUid.trim() === '') {
          secretState = 'unconfirmed'
          throw new Error('PactFlow probe creation did not return a Secret UID')
        }
        secretState = 'confirmed'
      }
      this.checkProbeLifetime(signal, deadline)
      let createdJob: V1Job
      try {
        createdJob = await this.withRequestDeadline(options => this.batch.createNamespacedJob({
          namespace: this.config.namespace,
          body: this.apiProbeJob(jobName, runtimeTemplate, request.url, request.payload, timeoutMs),
        }, options))
      } catch (error) {
        if (this.isTimeout(error)) jobState = 'unconfirmed'
        throw error
      }
      jobUid = createdJob?.metadata?.uid
      if (!jobUid) {
        jobState = 'unconfirmed'
        throw new Error('PactFlow probe creation did not return a Job UID')
      }
      jobState = 'confirmed'
      if (createdModelSecret !== undefined) {
        await this.bindProbeSecretOwner(runtimeTemplate.modelSecretName, createdModelSecret, jobName, jobUid)
      }
      await record?.({ phase: 'confirmed', jobName, jobUid,
        ...(modelApiKey === undefined ? {} : { secretName: runtimeTemplate.modelSecretName, secretUid: secretUid! }) })
      stages.push({ name: 'create-job', state: 'succeeded', detail: `Job ${jobName} created` })
      for (;;) {
        this.checkProbeLifetime(signal, deadline)
        const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.config.namespace }, this.probeReadOptions(signal, deadline))
        this.checkProbeLifetime(signal, deadline)
        if (job.metadata?.uid !== jobUid) throw new Error('PactFlow probe Job identity changed')
        if ((job.status?.succeeded ?? 0) > 0 || (job.status?.failed ?? 0) > 0) {
          output = await this.probeLog(jobName, jobUid, this.probeReadOptions(signal, deadline))
          this.checkProbeLifetime(signal, deadline)
          success = (job.status?.succeeded ?? 0) > 0 && output.trim() !== ''
          stages.push({
            name: 'api-response', state: success ? 'succeeded' : 'failed',
            detail: success ? 'API returned successfully' : output.trim() === ''
              ? 'API probe returned no response evidence' : 'API request Job failed',
          })
          break
        }
        await this.delay(signal)
      }
    } catch (error) {
      output = error instanceof Error ? this.redactProbeOutput(error.message, modelApiKey).slice(0, 4_096) : 'API probe failed'
      stages.push({ name: 'api-response', state: 'failed', detail: 'API probe failed before a response' })
    } finally {
      // 'leftover' keeps the ledger entry only when a created resource may
      // still exist without a usable identity or a confirmed delete failed.
      let leftover = jobState === 'unconfirmed' || secretState === 'unconfirmed'
      try {
        const deletedPods = await this.cleanupProbeResources(jobName, jobUid)
        stages.push({
          name: 'cleanup', state: 'succeeded',
          detail: `Job ${jobName} and ${String(deletedPods)} probe Pods deleted`,
        })
      } catch {
        success = false
        if (jobState === 'confirmed') leftover = true
        stages.push({ name: 'cleanup', state: 'failed', detail: `Job or Pods for ${jobName} cleanup failed` })
      }
      if (modelApiKey !== undefined) {
        try {
          if (typeof secretUid !== 'string' || secretUid.trim() === '') throw new Error('PactFlow probe Secret identity is unconfirmed')
          const uid = secretUid
          await this.withRequestDeadline(options => this.core.deleteNamespacedSecret({ name: runtimeTemplate.modelSecretName, namespace: this.config.namespace,
            body: { preconditions: { uid } } }, options))
        } catch (error) {
          if (!this.isNotFound(error)) {
            success = false
            if (secretState === 'confirmed') leftover = true
            stages.push({ name: 'cleanup', state: 'failed', detail: `Secret ${runtimeTemplate.modelSecretName} cleanup failed` })
          }
        }
      }
      if (!leftover) {
        try { await record?.({ phase: 'cleaned', jobName }) } catch { /* startup reconciliation retries entry removal */ }
      }
    }
    if (signal.aborted) success = false
    return {
      kind: 'api', templateId: template.id, harness: template.harness, apiMode: template.apiMode,
      model: template.model, baseUrl: template.baseUrl, image: template.image,
      modelSecretName: runtimeTemplate.modelSecretName, prompt, timeoutMs,
      requestPath: request.path, requestPayload: request.payload,
      success, durationMs: Date.now() - startedAt, output: this.bounded(this.redactProbeOutput(output, modelApiKey), 16_384), stages,
    }
  }

  /** Observe an existing Job without creating or mutating resources. */
  async observe(spec: PactFlowK3sRunSpec): Promise<PactFlowK3sObservation> {
    const missingIdentity = pactFlowK3sResultIdentityError(spec)
    if (missingIdentity !== undefined) return { state: 'failed', finishedAt: Date.now(), outcome: missingIdentity }
    let job: V1Job
    try {
      job = await this.batch.readNamespacedJob({ name: spec.jobName, namespace: spec.namespace })
    } catch (error) {
      const status = (error as { code?: unknown; statusCode?: unknown }).code
        ?? (error as { statusCode?: unknown }).statusCode
      if (status === 404) return { state: 'missing' }
      const reason = error instanceof Error ? error.message.slice(0, 512) : 'unavailable'
      throw new Error(`PactFlow cannot read K3s Job "${spec.jobName}" (status ${String(status ?? 'unavailable')}): ${reason}`)
    }
    const identityError = this.validateJobIdentity(spec, job)
    if (identityError !== undefined) {
      return { state: 'failed', finishedAt: Date.now(), outcome: identityError }
    }
    if ((job.status?.succeeded ?? 0) > 0) return await this.terminalObservation(spec, true)
    if ((job.status?.failed ?? 0) > 0) return await this.terminalObservation(spec, false)
    return { state: 'pending' }
  }

  private validateJobIdentity(spec: PactFlowK3sRunSpec, job: V1Job): string | undefined {
    if (spec.jobUid !== undefined && job.metadata?.uid !== spec.jobUid) {
      return `PactFlow K3s Job "${spec.jobName}" UID does not match the claimed Job`
    }
    if (spec.runNonceHash === undefined && spec.claimTokenHash === undefined && spec.specDigest === undefined) return undefined
    if (spec.jobUid === undefined) return `PactFlow K3s Run "${spec.jobName}" has no persisted Job UID binding`
    const labels = job.metadata?.labels ?? {}
    for (const [key, value] of Object.entries(this.labels(spec)).filter(([key]) => key.startsWith('pactflow.'))) {
      if (labels[key] !== value) return `PactFlow K3s Job "${spec.jobName}" label ${key} does not match the Run`
    }
    const annotations = job.metadata?.annotations ?? {}
    for (const [key, value] of Object.entries(this.annotations(spec))) {
      if (annotations[key] !== value) return `PactFlow K3s Job "${spec.jobName}" annotation ${key} does not match the Run`
    }
    return undefined
  }

  /** Wait for a Job created before the current Host activation. */
  async waitExisting(spec: PactFlowK3sRunSpec, signal: AbortSignal): Promise<PactFlowK3sResult> {
    return await this.waitForResult(spec, signal, false)
  }

  /** Cancel only the exact Job and ConfigMap owned by one Run. */
  async cancelRun(spec: PactFlowK3sRunSpec): Promise<void> {
    const missingIdentity = resourceIdentityError(spec)
    if (missingIdentity !== undefined) throw new Error(missingIdentity)
    await this.cleanupRun(spec)
  }

  /** Precisely remove one recorded probe's resources; unconfirmed identity fails closed. */
  async cleanupProbeIdentity(identity: PactFlowProbeCleanupIdentity): Promise<void> {
    const { jobName, jobUid, secretName, secretUid } = identity
    if (typeof jobUid !== 'string' || jobUid.trim() === '') {
      throw new Error(`PactFlow probe cleanup for "${jobName}" requires a confirmed Job UID; explicit recovery is required`)
    }
    if (secretName !== undefined && (typeof secretUid !== 'string' || secretUid.trim() === '')) {
      throw new Error(`PactFlow probe cleanup for "${jobName}" requires a confirmed Secret UID; explicit recovery is required`)
    }
    if (secretName !== undefined) {
      try {
        await this.withRequestDeadline(options => this.core.deleteNamespacedSecret({ name: secretName, namespace: this.config.namespace,
          body: { preconditions: { uid: secretUid! } } }, options))
      } catch (error) {
        if (!this.isNotFound(error)) throw error
      }
    }
    await this.cleanupProbeResources(jobName, jobUid)
  }

  /** Delete completed resources owned by one Run; missing resources count as clean. */
  async cleanupRun(spec: PactFlowK3sRunSpec): Promise<void> {
    const missingIdentity = resourceIdentityError(spec)
    if (missingIdentity !== undefined) throw new Error(missingIdentity)
    // ConfigMap/model Secret carry an ownerReference to the Job. Deleting all
    // three concurrently races the garbage collector and can return 409 for a
    // child already entering owner-driven deletion. Remove dependants first,
    // then the Job; 404 remains an idempotent clean result at both boundaries.
    if (spec.jobUid !== undefined) {
      try {
        const job = await this.withRequestDeadline(options => this.batch.readNamespacedJob({
          name: spec.jobName, namespace: spec.namespace,
        }, options))
        const identityError = this.validateJobIdentity(spec, job)
        if (identityError !== undefined) throw new Error(identityError)
      } catch (error) {
        if (!this.isNotFound(error)) throw error
      }
    }
    const deletions: Array<() => Promise<unknown>> = []
    const configUid = await this.ownedCleanupUid(spec,
      () => this.withRequestDeadline(options => this.core.readNamespacedConfigMap({
        name: spec.configMapName, namespace: spec.namespace,
      }, options)))
    if (configUid !== undefined) deletions.push(() => this.withRequestDeadline(options => this.core.deleteNamespacedConfigMap({
      name: spec.configMapName, namespace: spec.namespace, body: { preconditions: { uid: configUid } },
    }, options)))
    for (const name of [spec.inputSecretName, ...(spec.ephemeralModelSecret === true ? [spec.modelSecretName] : [])]) {
      if (name === undefined) continue
      const uid = await this.ownedCleanupUid(spec,
        () => this.withRequestDeadline(options => this.core.readNamespacedSecret({ name, namespace: spec.namespace }, options)))
      if (uid !== undefined) deletions.push(() => this.withRequestDeadline(options => this.core.deleteNamespacedSecret({
        name, namespace: spec.namespace, body: { preconditions: { uid } },
      }, options)))
    }
    let pods: readonly V1Pod[] = []
    try {
      pods = (await this.withRequestDeadline(options => this.core.listNamespacedPod({
        namespace: spec.namespace, labelSelector: `job-name=${spec.jobName}`,
      }, options))).items
    } catch (error) { if (!this.isNotFound(error)) throw error }
    for (const pod of pods) {
      if (!pod.metadata?.ownerReferences?.some(owner => owner.apiVersion === 'batch/v1' && owner.kind === 'Job'
        && owner.name === spec.jobName && owner.uid === spec.jobUid && owner.controller === true)) continue
      const uid = await this.ownedCleanupUid(spec, async () => pod)
      const name = pod.metadata?.name
      if (uid === undefined || name === undefined) throw new Error('PactFlow owned cleanup Pod lacks identity')
      deletions.push(() => this.withRequestDeadline(options => this.core.deleteNamespacedPod({ name, namespace: spec.namespace,
        gracePeriodSeconds: 0, body: { preconditions: { uid } } }, options)))
    }
    const childOperations = await Promise.allSettled(deletions.map(remove => remove()))
    const childFailed = childOperations
      .filter(result => result.status === 'rejected' && !this.isNotFound(result.reason))
    if (childFailed.length > 0) {
      throw new Error(`PactFlow failed to clean K3s child resources for Job "${spec.jobName}"`)
    }
    try {
      await this.withRequestDeadline(options => this.batch.deleteNamespacedJob({
        name: spec.jobName, namespace: spec.namespace, gracePeriodSeconds: 0,
        propagationPolicy: 'Background', body: { preconditions: { uid: spec.jobUid! } },
      }, options))
    } catch (error) {
      if (!this.isNotFound(error)) throw new Error(`PactFlow failed to clean K3s Job "${spec.jobName}"`)
    }
  }

  private async ownedCleanupUid(
    spec: PactFlowK3sRunSpec,
    read: () => Promise<{ metadata?: V1ObjectMeta }>,
  ): Promise<string | undefined> {
    let metadata: V1ObjectMeta | undefined
    try { metadata = (await read()).metadata } catch (error) {
      if (this.isNotFound(error)) return undefined
      throw error
    }
    if (typeof metadata?.uid !== 'string' || metadata.uid.trim() === '' || !metadata.ownerReferences?.some(owner => owner.apiVersion === 'batch/v1'
      && owner.kind === 'Job' && owner.name === spec.jobName && owner.uid === spec.jobUid && owner.controller === true)
      || !Object.entries(this.labels(spec)).filter(([key]) => key.startsWith('pactflow.')).every(([key, value]) => metadata.labels?.[key] === value)
      || !Object.entries(this.annotations(spec)).every(([key, value]) => metadata.annotations?.[key] === value)) {
      throw new Error('PactFlow K3s cleanup child resource identity does not match the Run')
    }
    return metadata.uid
  }

  private configMap(spec: PactFlowK3sRunSpec): V1ConfigMap {
    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      immutable: true,
      metadata: { name: spec.configMapName, namespace: spec.namespace, labels: this.labels(spec), annotations: this.annotations(spec) },
      data: {
        'worker.sh': WORKER_SCRIPT,
      },
    }
  }

  private inputSecret(
    spec: PactFlowK3sRunSpec,
    git: PactFlowGitRunSpec,
    prompt: string,
    secrets: PactFlowK3sRuntimeSecrets,
  ): V1Secret {
    if (spec.inputSecretName === undefined) throw new Error('PactFlow K3s Run input Secret name is missing')
    return {
      apiVersion: 'v1', kind: 'Secret', immutable: true,
      metadata: { name: spec.inputSecretName, namespace: spec.namespace, labels: this.labels(spec), annotations: this.annotations(spec) },
      type: 'Opaque',
      stringData: {
        'spec.json': JSON.stringify({
          schema: 'dsh_pactflow_k3s_run/v1', repoUrl: git.remoteUrl,
          baseCommit: git.baseCommit, branch: git.branch, prompt,
          runNonce: secrets.runNonce, claimToken: secrets.claimToken,
          runNonceHash: spec.runNonceHash, claimTokenHash: spec.claimTokenHash,
          specDigest: spec.specDigest,
        }),
      },
    }
  }

  private job(spec: PactFlowK3sRunSpec): V1Job {
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: spec.jobName, namespace: spec.namespace, labels: this.labels(spec), annotations: this.annotations(spec) },
      spec: {
        activeDeadlineSeconds: spec.activeDeadlineSeconds,
        backoffLimit: 0,
        ttlSecondsAfterFinished: spec.finishedJobTtlSeconds,
        template: {
          metadata: { labels: this.labels(spec), annotations: this.annotations(spec) },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            securityContext: { fsGroup: 1_001, fsGroupChangePolicy: 'OnRootMismatch' },
            imagePullSecrets: [{ name: spec.imagePullSecret }],
            terminationGracePeriodSeconds: 30,
            containers: [{
              name: 'worker',
              image: spec.image,
              imagePullPolicy: 'IfNotPresent',
              command: ['/bin/bash', '/opt/dsh-pactflow/worker.sh'],
              env: this.modelEnvironment(spec),
              resources: {
                requests: { cpu: spec.cpuRequest, memory: spec.memoryRequest },
                limits: { cpu: spec.cpuLimit, memory: spec.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                runAsNonRoot: true,
                runAsUser: 1_001,
                runAsGroup: 1_001,
              },
              terminationMessagePath: '/dev/termination-log',
              terminationMessagePolicy: 'File',
              volumeMounts: [
                { name: 'spec', mountPath: '/opt/dsh-pactflow', readOnly: true },
                { name: 'input', mountPath: '/var/run/pactflow-input', readOnly: true },
                { name: 'git', mountPath: '/var/run/pactflow-git', readOnly: true },
              ],
            }],
            volumes: [
              { name: 'spec', configMap: { name: spec.configMapName, defaultMode: 0o555 } },
              ...(spec.inputSecretName === undefined ? [] : [
                { name: 'input', secret: { secretName: spec.inputSecretName, defaultMode: 0o400 } },
              ]),
              { name: 'git', secret: { secretName: spec.gitSecretName, defaultMode: 0o440 } },
            ],
          },
        },
      },
    }
  }

  private probeJob(
    jobName: string,
    template: PactFlowHarnessTemplateConfig,
    prompt: string,
    timeoutMs: number,
  ): V1Job {
    const timeoutSeconds = Math.ceil(timeoutMs / 1_000)
    return {
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: {
        name: jobName, namespace: this.config.namespace,
        labels: { 'app.kubernetes.io/name': 'dsh-pactflow-probe', 'app.kubernetes.io/managed-by': 'dsh-pactflow' },
      },
      spec: {
        activeDeadlineSeconds: timeoutSeconds,
        backoffLimit: 0,
        ttlSecondsAfterFinished: PROBE_FINISHED_JOB_TTL_SECONDS,
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': 'dsh-pactflow-probe' } },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            imagePullSecrets: [{ name: this.config.imagePullSecret }],
            containers: [{
              name: 'probe', image: template.image, imagePullPolicy: 'IfNotPresent',
              command: ['/usr/local/bin/pactflow-harness-runner.sh'],
              env: [
                ...this.modelEnvironment({ ...template, activeDeadlineSeconds: timeoutSeconds }),
                { name: 'PACTFLOW_TEST_PROMPT', value: prompt },
                { name: 'PACTFLOW_HARNESS_PROBE', value: '1' },
              ],
              resources: {
                requests: { cpu: template.cpuRequest, memory: template.memoryRequest },
                limits: { cpu: template.cpuLimit, memory: template.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] },
                runAsNonRoot: true, runAsUser: 1_001, runAsGroup: 1_001,
              },
            }],
          },
        },
      },
    }
  }

  private apiProbeJob(
    jobName: string,
    template: PactFlowHarnessTemplateConfig,
    url: string,
    payload: string,
    timeoutMs: number,
  ): V1Job {
    const timeoutSeconds = Math.ceil(timeoutMs / 1_000)
    return {
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: {
        name: jobName, namespace: this.config.namespace,
        labels: { 'app.kubernetes.io/name': 'dsh-pactflow-api-probe', 'app.kubernetes.io/managed-by': 'dsh-pactflow' },
      },
      spec: {
        activeDeadlineSeconds: timeoutSeconds,
        backoffLimit: 0,
        ttlSecondsAfterFinished: PROBE_FINISHED_JOB_TTL_SECONDS,
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': 'dsh-pactflow-api-probe' } },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            imagePullSecrets: [{ name: this.config.imagePullSecret }],
            containers: [{
              name: 'probe', image: template.image, imagePullPolicy: 'IfNotPresent',
              command: ['python3', '-c', API_PROBE_SCRIPT],
              env: [
                ...this.modelEnvironment({ ...template, activeDeadlineSeconds: timeoutSeconds }),
                { name: 'PACTFLOW_API_URL', value: url },
                { name: 'PACTFLOW_API_PAYLOAD', value: payload },
                { name: 'PACTFLOW_API_MODE', value: template.apiMode },
              ],
              resources: {
                requests: { cpu: template.cpuRequest, memory: template.memoryRequest },
                limits: { cpu: template.cpuLimit, memory: template.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] },
                runAsNonRoot: true, runAsUser: 1_001, runAsGroup: 1_001,
              },
            }],
          },
        },
      },
    }
  }

  private imageProbeJob(
    jobName: string,
    template: PactFlowHarnessTemplateConfig,
    timeoutMs: number,
  ): V1Job {
    return {
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: {
        name: jobName, namespace: this.config.namespace,
        labels: { 'app.kubernetes.io/name': 'dsh-pactflow-image-probe', 'app.kubernetes.io/managed-by': 'dsh-pactflow' },
      },
      spec: {
        activeDeadlineSeconds: Math.ceil(timeoutMs / 1_000), backoffLimit: 0,
        ttlSecondsAfterFinished: PROBE_FINISHED_JOB_TTL_SECONDS,
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': 'dsh-pactflow-image-probe' } },
          spec: {
            automountServiceAccountToken: false, restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            imagePullSecrets: [{ name: this.config.imagePullSecret }],
            containers: [{
              name: 'probe', image: template.image, imagePullPolicy: 'IfNotPresent',
              command: [...harnessVersionCommand(template.harness)],
              resources: {
                requests: { cpu: template.cpuRequest, memory: template.memoryRequest },
                limits: { cpu: template.cpuLimit, memory: template.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] },
                runAsNonRoot: true, runAsUser: 1_001, runAsGroup: 1_001,
              },
            }],
          },
        },
      },
    }
  }

  private apiRequest(
    template: PactFlowHarnessTemplateConfig,
    prompt: string,
  ): { readonly path: string; readonly url: string; readonly payload: string } {
    const path = template.apiMode === 'anthropic-messages'
      ? '/v1/messages'
      : template.apiMode === 'openai-responses' ? '/v1/responses' : '/v1/chat/completions'
    const payload = template.apiMode === 'anthropic-messages'
      ? { model: template.model, max_tokens: 32, messages: [{ role: 'user', content: prompt }] }
      : template.apiMode === 'openai-responses'
        ? { model: template.model, input: prompt, max_output_tokens: 32 }
        : { model: template.model, messages: [{ role: 'user', content: prompt }], max_tokens: 32 }
    return {
      path,
      url: `${template.baseUrl.replace(/\/+$/, '')}${path}`,
      payload: JSON.stringify(payload),
    }
  }

  private modelEnvironment(spec: Pick<
    PactFlowK3sRunSpec,
    'harness' | 'apiMode' | 'model' | 'baseUrl' | 'modelSecretName' | 'activeDeadlineSeconds'
  >): V1EnvVar[] {
    const common: V1EnvVar[] = [
      { name: 'WORKER_TYPE', value: spec.harness },
      { name: 'MODEL', value: spec.model },
      { name: 'HARNESS_TIMEOUT_SECONDS', value: String(Math.max(1, spec.activeDeadlineSeconds - 30)) },
    ]
    if (spec.apiMode === 'anthropic-messages') {
      return [
        ...common,
        { name: 'ANTHROPIC_MODEL', value: spec.model },
        { name: 'ANTHROPIC_BASE_URL', value: spec.baseUrl },
        this.secretEnv('ANTHROPIC_AUTH_TOKEN', spec.modelSecretName),
      ]
    }
    return [
      ...common,
      { name: 'OPENAI_MODEL', value: spec.model },
      { name: 'OPENAI_BASE_URL', value: spec.baseUrl },
      this.secretEnv('OPENAI_API_KEY', spec.modelSecretName),
    ]
  }

  private secretEnv(key: string, secretName: string): V1EnvVar {
    return { name: key, valueFrom: { secretKeyRef: { name: secretName, key } } }
  }

  private ownsProbePod(pod: V1Pod, jobName: string, jobUid: string): boolean {
    return pod.metadata?.ownerReferences?.some(owner => owner.kind === 'Job'
      && owner.controller === true && owner.name === jobName && owner.uid === jobUid) === true
  }

  private async probeLog(jobName: string, jobUid: string, options: ConfigurationOptions): Promise<string> {
    const list = await this.core.listNamespacedPod({
      namespace: this.config.namespace, labelSelector: `job-name=${jobName}`,
    }, options)
    const pod = list.items.find(candidate => this.ownsProbePod(candidate, jobName, jobUid))
    const podName = pod?.metadata?.name
    if (podName === undefined) throw new Error('Harness probe Pod was not found')
    const podUid = pod?.metadata?.uid
    if (!podUid) throw new Error('Harness probe Pod UID was not found')
    const output = await this.core.readNamespacedPodLog({
      name: podName, namespace: this.config.namespace, container: 'probe',
      limitBytes: 32_768, tailLines: 200,
    }, options)
    const current = await this.core.readNamespacedPod({ name: podName, namespace: this.config.namespace }, options)
    if (current.metadata?.uid !== podUid || !this.ownsProbePod(current, jobName, jobUid)) {
      throw new Error('Harness probe Pod identity changed while reading its logs')
    }
    return output
  }

  /** Best-effort owner binding so a host crash leaves a GC-able probe Secret instead of an orphan. */
  private async bindProbeSecretOwner(
    secretName: string, created: V1Secret, jobName: string, jobUid: string,
  ): Promise<void> {
    try {
      await this.withRequestDeadline(options => this.core.replaceNamespacedSecret({
        name: secretName, namespace: this.config.namespace,
        body: {
          ...created,
          metadata: {
            ...created.metadata,
            ownerReferences: [{
              apiVersion: 'batch/v1', kind: 'Job', name: jobName, uid: jobUid,
              controller: true, blockOwnerDeletion: true,
            }],
          },
        },
      }, options))
    } catch { /* in-process UID cleanup stays authoritative; this binding only backstops a host crash */ }
  }

  private async cleanupProbeResources(jobName: string, jobUid?: string): Promise<number> {
    if (jobUid === undefined || jobUid.trim() === '') throw new Error('PactFlow probe cleanup requires a confirmed Job UID')
    const list = await this.withRequestDeadline(options => this.core.listNamespacedPod({
      namespace: this.config.namespace, labelSelector: `job-name=${jobName}`,
    }, options))
    const owned = list.items.filter(pod => this.ownsProbePod(pod, jobName, jobUid))
    if (owned.some(pod => !pod.metadata?.name || !pod.metadata.uid)) {
      throw new Error('PactFlow probe Pod cleanup requires an exact name and UID')
    }
    const deletions = await Promise.allSettled(owned.map(pod => this.withRequestDeadline(options => this.core.deleteNamespacedPod({
      name: pod.metadata!.name!, namespace: this.config.namespace, gracePeriodSeconds: 0,
      propagationPolicy: 'Background', body: { preconditions: { uid: pod.metadata!.uid! } },
    }, options))))
    const podFailed = deletions.some(result => result.status === 'rejected' && !this.isNotFound(result.reason))
    if (podFailed) {
      throw new Error(`PactFlow failed to clean probe resources for Job "${jobName}"`)
    }
    try {
      await this.withRequestDeadline(options => this.batch.deleteNamespacedJob({
        name: jobName, namespace: this.config.namespace, gracePeriodSeconds: 0,
        propagationPolicy: 'Background', body: { preconditions: { uid: jobUid } },
      }, options))
    } catch (error) {
      if (!this.isNotFound(error)) throw error
    }
    return owned.length
  }

  private async waitForResult(spec: PactFlowK3sRunSpec, signal: AbortSignal, cancelOnAbort = true): Promise<PactFlowK3sResult> {
    for (;;) {
      if (signal.aborted) {
        if (cancelOnAbort) await this.cancel(spec)
        throw new Error(`PactFlow K3s Job "${spec.jobName}" was cancelled`)
      }
      const observation = await this.observe(spec)
      if (observation.state === 'succeeded') return observation.result
      if (observation.state === 'failed') throw new Error(observation.outcome)
      if (observation.state === 'missing') throw new Error(`PactFlow K3s Job "${spec.jobName}" is missing`)
      await this.delay(signal)
    }
  }

  private async terminalObservation(
    spec: PactFlowK3sRunSpec,
    expectSuccess: boolean,
  ): Promise<Extract<PactFlowK3sObservation, { state: 'succeeded' | 'failed' }>> {
    const missingIdentity = pactFlowK3sResultIdentityError(spec)
    if (missingIdentity !== undefined) return { state: 'failed', finishedAt: Date.now(), outcome: missingIdentity }
    let pods: readonly V1Pod[]
    try {
      const list = await this.core.listNamespacedPod({
        namespace: spec.namespace, labelSelector: `job-name=${spec.jobName}`,
      })
      pods = list.items
    } catch {
      throw new Error(`PactFlow cannot read Pods for K3s Job "${spec.jobName}"`)
    }
    const candidates = pods.filter(candidate => {
      const owners = candidate.metadata?.ownerReferences ?? []
      return owners.some(owner => owner.apiVersion === 'batch/v1' && owner.kind === 'Job' && owner.name === spec.jobName
        && owner.uid === spec.jobUid && owner.controller === true)
    }).filter(candidate => {
      const labels = candidate.metadata?.labels ?? {}
      const annotations = candidate.metadata?.annotations ?? {}
      return Object.entries(this.labels(spec)).filter(([key]) => key.startsWith('pactflow.'))
        .every(([key, value]) => labels[key] === value)
        && Object.entries(this.annotations(spec)).every(([key, value]) => annotations[key] === value)
    })
    const pod = candidates.toSorted((left, right) =>
      (right.metadata?.creationTimestamp?.valueOf() ?? 0) - (left.metadata?.creationTimestamp?.valueOf() ?? 0))[0]
    const workerStatus = pod?.status?.containerStatuses?.find(status => status.name === 'worker')
    const terminated = workerStatus?.state?.terminated
    if (pod?.metadata?.name === undefined || terminated === undefined) {
      return {
        state: 'failed', finishedAt: Date.now(),
        outcome: `PactFlow K3s Job "${spec.jobName}" has no terminal Worker Pod result`,
      }
    }
    let document: WorkerResultDocument
    try {
      document = JSON.parse(terminated.message ?? '') as WorkerResultDocument
    } catch {
      return {
        state: 'failed', finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
        outcome: `PactFlow K3s Job "${spec.jobName}" returned an invalid termination document`,
      }
    }
    const observedDigest = workerStatus?.imageID?.match(/(?:^|@|:\/\/)(sha256:[0-9a-f]{64})$/)?.[1]
    const imageMatches = observedDigest !== undefined && observedDigest === spec.image.split('@').at(-1)
    const bindingMatches = document !== null && typeof document === 'object'
      && document.runNonceHash === spec.runNonceHash
      && document.claimTokenHash === spec.claimTokenHash
      && document.specDigest === spec.specDigest
    const valid = document !== null && typeof document === 'object'
      && document.schema === 'dsh_pactflow_k3s_result/v1'
      && typeof document.branch === 'string' && document.branch.length > 0
      && typeof document.commit === 'string' && COMMIT.test(document.commit)
      && typeof document.harnessVersion === 'string'
      && document.branch === spec.expectedBranch
      && document.commit !== spec.expectedBaseCommit
      && Number.isInteger(document.agentExitCode) && Number.isInteger(document.pushExitCode)
      && bindingMatches && (spec.runNonceHash === undefined || /^[0-9a-f]{64}$/.test(document.runNonceHash ?? ''))
      && (spec.claimTokenHash === undefined || /^[0-9a-f]{64}$/.test(document.claimTokenHash ?? ''))
      && (spec.specDigest === undefined || /^[0-9a-f]{64}$/.test(document.specDigest ?? ''))
      && imageMatches
    if (!valid || !expectSuccess || document.status !== 'succeeded' || terminated.exitCode !== 0
      || document.agentExitCode !== 0 || document.pushExitCode !== 0) {
      return {
        state: 'failed', finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
        outcome: `PactFlow K3s Worker failed (pod ${pod.metadata.name}, exit ${String(terminated.exitCode)})`,
      }
    }
    return {
      state: 'succeeded',
      result: {
        podName: pod.metadata.name,
        exitCode: terminated.exitCode,
        commit: document.commit,
        branch: document.branch,
        harnessVersion: document.harnessVersion.slice(0, 256),
        finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
        ...(document.runNonceHash === undefined ? {} : { runNonceHash: document.runNonceHash }),
        ...(document.claimTokenHash === undefined ? {} : { claimTokenHash: document.claimTokenHash }),
        ...(document.specDigest === undefined ? {} : { specDigest: document.specDigest }),
      },
    }
  }

  private async cancel(spec: PactFlowK3sRunSpec): Promise<void> {
    if (spec.jobUid !== undefined) return await this.cleanupRun(spec)
    const failures: unknown[] = []
    for (const operation of [
      () => this.deleteConfigMap(spec),
      () => this.deleteInputSecret(spec),
      ...(spec.ephemeralModelSecret === true ? [() => this.deleteModelSecret(spec)] : []),
    ]) {
      try { await operation() } catch (error) { failures.push(error) }
    }
    try {
      await this.withRequestDeadline(options => this.batch.deleteNamespacedJob({
        name: spec.jobName,
        namespace: spec.namespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
        body: {},
      }, options))
    } catch (error) {
      if (!this.isNotFound(error)) failures.push(error)
    }
    if (failures.length > 0) throw new Error(`PactFlow failed to cancel K3s Job "${spec.jobName}" resources`)
  }

  /** Name-based compensation for children created moments ago inside this call. */
  private async compensateCreatedChildren(
    spec: PactFlowK3sRunSpec,
    createdModelSecret: V1Secret | undefined,
  ): Promise<boolean> {
    const failures: unknown[] = []
    for (const operation of [
      () => this.deleteConfigMap(spec),
      ...(createdModelSecret !== undefined ? [() => this.deleteModelSecret(spec)] : []),
      () => this.deleteInputSecret(spec),
    ]) {
      try { await operation() } catch (error) { failures.push(error) }
    }
    return failures.length > 0
  }

  private async deleteConfigMap(spec: PactFlowK3sRunSpec): Promise<void> {
    try {
      await this.withRequestDeadline(options => this.core.deleteNamespacedConfigMap({
        name: spec.configMapName, namespace: spec.namespace,
      }, options))
    } catch (error) {
      if (!this.isNotFound(error) && !this.isTimeout(error)) throw error
    }
  }

  private async deleteInputSecret(spec: PactFlowK3sRunSpec): Promise<void> {
    if (spec.inputSecretName === undefined) return
    try {
      const name = spec.inputSecretName
      await this.withRequestDeadline(options => this.core.deleteNamespacedSecret({
        name, namespace: spec.namespace,
      }, options))
    } catch (error) {
      if (!this.isNotFound(error) && !this.isTimeout(error)) throw error
    }
  }

  private async deleteModelSecret(spec: PactFlowK3sRunSpec): Promise<void> {
    try {
      await this.withRequestDeadline(options => this.core.deleteNamespacedSecret({
        name: spec.modelSecretName, namespace: spec.namespace,
      }, options))
    } catch (error) {
      if (!this.isNotFound(error) && !this.isTimeout(error)) throw error
    }
  }

  private modelSecret(
    name: string,
    namespace: string,
    apiMode: PactFlowApiMode,
    value: string,
  ): V1Secret {
    const key = apiMode === 'anthropic-messages' ? 'ANTHROPIC_AUTH_TOKEN' : 'OPENAI_API_KEY'
    return {
      apiVersion: 'v1', kind: 'Secret', immutable: true,
      metadata: {
        name, namespace,
        labels: { 'app.kubernetes.io/name': 'dsh-pactflow-model', 'app.kubernetes.io/managed-by': 'dsh-pactflow' },
      },
      stringData: { [key]: value },
      type: 'Opaque',
    }
  }

  private probeReadOptions(signal: AbortSignal, deadline: number): ConfigurationOptions {
    const stop = AbortSignal.any([signal, AbortSignal.timeout(Math.max(1, Math.ceil(deadline - performance.now())))])
    return {
      middlewareMergeStrategy: 'append',
      middleware: [{
        pre(request) {
          const existing = request.getSignal()
          request.setSignal(existing === undefined ? stop : AbortSignal.any([existing, stop]))
          return new Observable(Promise.resolve(request))
        },
        post(response) { return new Observable(Promise.resolve(response)) },
      }],
    }
  }

  private checkProbeLifetime(signal: AbortSignal, deadline: number): void {
    signal.throwIfAborted()
    if (performance.now() >= deadline) throw new Error('PactFlow probe exceeded its Host deadline')
  }

  private delay(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve()
    return new Promise((resolveDelay) => {
      const onAbort = (): void => { clearTimeout(timer); resolveDelay() }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolveDelay()
      }, this.config.pollIntervalMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private labels(spec: PactFlowK3sRunSpec): Record<string, string> {
    return {
      'app.kubernetes.io/name': 'dsh-pactflow-worker',
      'app.kubernetes.io/managed-by': 'dsh-pactflow',
      'pactflow.run': spec.jobName.slice('dsh-pf-'.length),
      ...(spec.runNonceHash === undefined ? {} : { 'pactflow.run-nonce-hash': spec.runNonceHash.slice(0, 63) }),
      ...(spec.claimTokenHash === undefined ? {} : { 'pactflow.claim-token-hash': spec.claimTokenHash.slice(0, 63) }),
      ...(spec.specDigest === undefined ? {} : { 'pactflow.spec-digest': spec.specDigest.slice(0, 63) }),
    }
  }

  private annotations(spec: PactFlowK3sRunSpec): Record<string, string> {
    return {
      ...(spec.runNonceHash === undefined ? {} : { 'pactflow.dev/run-nonce-hash': spec.runNonceHash }),
      ...(spec.claimTokenHash === undefined ? {} : { 'pactflow.dev/claim-token-hash': spec.claimTokenHash }),
      ...(spec.specDigest === undefined ? {} : { 'pactflow.dev/spec-digest': spec.specDigest }),
    }
  }

  private validateTemplate(template: PactFlowHarnessTemplateConfig): void {
    this.requireDnsName('template id', template.id)
    this.requireDnsName('modelSecretName', template.modelSecretName)
    if (PACTFLOW_HARNESS_API_MODE[template.harness] !== template.apiMode) {
      throw new Error(`PactFlow Harness ${template.harness} does not support ${template.apiMode}`)
    }
    if (!IMAGE_DIGEST.test(template.image)) throw new Error('PactFlow K3s template image must use a sha256 digest')
    if (template.model.trim().length === 0) throw new Error('PactFlow K3s template model must be non-empty')
    let baseUrl: URL
    try {
      baseUrl = new URL(template.baseUrl)
    } catch {
      throw new Error('PactFlow K3s template baseUrl must be an HTTP(S) URL')
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username !== '' || baseUrl.password !== ''
      || baseUrl.search !== '' || baseUrl.hash !== '') {
      throw new Error('PactFlow K3s template baseUrl must be credential-free')
    }
    for (const value of [template.cpuRequest, template.memoryRequest, template.cpuLimit, template.memoryLimit]) {
      if (value.trim().length === 0 || /[\0\r\n]/.test(value)) throw new Error('PactFlow K3s resources must be non-empty')
    }
  }

  private requireDnsName(label: string, value: string): void {
    if (!DNS_LABEL.test(value)) throw new Error(`PactFlow K3s ${label} must be a DNS label`)
  }

  private redactProbeOutput(value: string, secret?: string): string {
    if (!secret) return value
    const variants = [...new Set([secret, JSON.stringify(secret).slice(1, -1), Buffer.from(secret).toString('base64')])]
      .sort((left, right) => right.length - left.length)
    for (const variant of variants) value = value.split(variant).join('[redacted]')
    return value
  }

  private bounded(value: string, maximumBytes: number): string {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length <= maximumBytes) return value
    return `${new TextDecoder().decode(bytes.slice(0, maximumBytes - 16))}\n[truncated]`
  }

  private isNotFound(error: unknown): boolean {
    const status = (error as { code?: unknown; statusCode?: unknown })?.code
      ?? (error as { statusCode?: unknown })?.statusCode
    return status === 404
  }
}

export const API_PROBE_SCRIPT = String.raw`import json, os, urllib.error, urllib.request
mode = os.environ['PACTFLOW_API_MODE']
url = os.environ['PACTFLOW_API_URL']
payload = os.environ['PACTFLOW_API_PAYLOAD'].encode()
headers = {'Content-Type': 'application/json'}
if mode == 'anthropic-messages':
    headers['Authorization'] = 'Bearer ' + os.environ['ANTHROPIC_AUTH_TOKEN']
    headers['anthropic-version'] = '2023-06-01'
else:
    headers['Authorization'] = 'Bearer ' + os.environ['OPENAI_API_KEY']
request = urllib.request.Request(url, data=payload, headers=headers, method='POST')
try:
    with urllib.request.urlopen(request, timeout=120) as response:
        document = json.load(response)
except urllib.error.HTTPError as error:
    body = error.read(2048).decode('utf-8', 'replace')
    print(json.dumps({'status': error.code, 'error': body}, ensure_ascii=False))
    raise SystemExit(1)
text = ''
if mode == 'anthropic-messages':
    text = ''.join(block.get('text', '') for block in document.get('content', []) if isinstance(block, dict))
elif mode == 'openai-responses':
    text = document.get('output_text', '')
    if not text:
        for item in document.get('output', []):
            for block in item.get('content', []) if isinstance(item, dict) else []:
                if isinstance(block, dict): text += block.get('text', '')
else:
    text = ((document.get('choices') or [{}])[0].get('message') or {}).get('content', '')
if not isinstance(document, dict):
    print(json.dumps({'status': 502, 'error': 'response was not a JSON object'}, ensure_ascii=False))
    raise SystemExit(1)
if not text.strip():
    print(json.dumps({'status': 502, 'error': 'response contained no semantic content', 'response': document}, ensure_ascii=False))
    raise SystemExit(1)
result = {'status': 200, 'text': text}
print(json.dumps(result, ensure_ascii=False))
`

const WORKER_SCRIPT = String.raw`#!/bin/bash
set -euo pipefail
SPEC_PATH=/var/run/pactflow-input/spec.json
eval "$(python3 - <<'PY'
import json, shlex
spec = json.load(open('/var/run/pactflow-input/spec.json', encoding='utf-8'))
for key, field in [('REPO_URL','repoUrl'),('BASE_COMMIT','baseCommit'),('BRANCH','branch'),('RUN_NONCE_HASH','runNonceHash'),('CLAIM_TOKEN_HASH','claimTokenHash'),('SPEC_DIGEST','specDigest')]:
    print(f"{key}={shlex.quote(str(spec[field]))}")
with open('/tmp/prompt.txt', 'w', encoding='utf-8') as output:
    output.write(str(spec['prompt']))
PY
)"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
install -m 600 /var/run/pactflow-git/id_ed25519 "$HOME/.ssh/id_ed25519"
install -m 644 /var/run/pactflow-git/known_hosts "$HOME/.ssh/known_hosts"
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts"
git clone --no-checkout "$REPO_URL" /workspace/repo
git -C /workspace/repo checkout -b "$BRANCH" "$BASE_COMMIT"
git -C /workspace/repo config user.name "PactFlow Worker"
git -C /workspace/repo config user.email "pactflow-worker@local"
cd /workspace/repo
set +e
PROMPT_PATH=/tmp/prompt.txt /usr/local/bin/pactflow-harness-runner.sh
AGENT_EXIT_CODE=$?
set -e
HARNESS_VERSION="$(cat /tmp/harness-version.txt 2>/dev/null || true)"
CURRENT_COMMIT="$(git rev-parse HEAD)"
PUSH_EXIT_CODE=1
STATUS=failed
if [ "$AGENT_EXIT_CODE" -eq 0 ] && [ "$CURRENT_COMMIT" != "$BASE_COMMIT" ] && [ -z "$(git status --porcelain)" ]; then
    if git push origin "HEAD:refs/heads/$BRANCH"; then
        PUSH_EXIT_CODE=0
        STATUS=succeeded
    else
        PUSH_EXIT_CODE=$?
    fi
fi
export STATUS CURRENT_COMMIT PUSH_EXIT_CODE AGENT_EXIT_CODE HARNESS_VERSION BRANCH RUN_NONCE_HASH CLAIM_TOKEN_HASH SPEC_DIGEST
python3 - <<'PY'
import json, os
document = {
    'schema': 'dsh_pactflow_k3s_result/v1',
    'status': os.environ['STATUS'],
    'commit': os.environ.get('CURRENT_COMMIT', ''),
    'branch': os.environ.get('BRANCH', ''),
    'harnessVersion': os.environ.get('HARNESS_VERSION', '')[:256],
    'agentExitCode': int(os.environ.get('AGENT_EXIT_CODE', '1')),
    'pushExitCode': int(os.environ.get('PUSH_EXIT_CODE', '1')),
    'runNonceHash': os.environ.get('RUN_NONCE_HASH', ''),
    'claimTokenHash': os.environ.get('CLAIM_TOKEN_HASH', ''),
    'specDigest': os.environ.get('SPEC_DIGEST', ''),
}
with open('/dev/termination-log', 'w', encoding='utf-8') as output:
    json.dump(document, output, ensure_ascii=False, separators=(',', ':'))
PY
if [ "$STATUS" = succeeded ]; then exit 0; fi
exit 1
`
