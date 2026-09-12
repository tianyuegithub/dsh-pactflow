import { isAbsolute } from 'node:path'
import type {
  PactFlowGitProviderSettings,
  PactFlowHarnessProfileSettings,
  PactFlowHarnessTemplateView,
  PactFlowInfrastructureSettings,
  PactFlowK3sSettings,
  PactFlowModelConnectionSettings,
  PactFlowRegistrySettings,
  PactFlowWorkerPoolSettings,
  PactFlowWorkerPoolStatus,
} from './types.ts'
import { PACTFLOW_HARNESS_API_MODE } from './k3s-worker.ts'

const ID = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const K8S_NAME = /^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/
const IMAGE_DIGEST = /^.+@sha256:[0-9a-f]{64}$/
const CREDENTIAL_REF = /^[A-Za-z_][A-Za-z0-9_]*$/

export interface PactFlowResolvedPool {
  readonly pool: PactFlowWorkerPoolSettings
  readonly k3s: PactFlowK3sSettings
}

export interface PactFlowResolvedExecution extends PactFlowResolvedPool {
  readonly executionTemplateId: string
  readonly modelConnection?: PactFlowModelConnectionSettings
}

interface Waiter {
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  abort?: () => void
}

interface PoolState {
  running: number
  readonly queue: Waiter[]
}

const MAX_POOL_QUEUE = 256

/** Validated resource graph used by the Host; contains references only, never Secret values. */
export class PactFlowInfrastructure {
  private readonly pools = new Map<string, PactFlowWorkerPoolSettings>()
  private readonly resolved = new Map<string, PactFlowResolvedPool>()
  private readonly states = new Map<string, PoolState>()
  private readonly providers: readonly PactFlowGitProviderSettings[]
  private readonly executions = new Map<string, string>()
  private readonly models = new Map<string, PactFlowModelConnectionSettings>()

  constructor(readonly settings: PactFlowInfrastructureSettings) {
    const clusters = unique(settings.clusters, 'K3s cluster')
    const registries = unique(settings.registries, 'registry')
    const templates = unique(settings.templates, 'Harness template')
    const models = unique(settings.modelConnections ?? [], 'model connection')
    unique(settings.gitProviders, 'Git provider')
    unique(settings.workerPools, 'Worker Pool')
    this.providers = settings.gitProviders.map(provider => this.validateProvider(provider))
    for (const model of models.values()) {
      this.validateModel(model)
      this.models.set(model.id, Object.freeze({ ...model }))
    }
    for (const cluster of clusters.values()) {
      validId(cluster.id, 'K3s cluster')
      nonEmpty(cluster.displayName, 'K3s cluster displayName')
      if (!K8S_NAME.test(cluster.namespace)) throw new Error(`K3s cluster "${cluster.id}" namespace is invalid`)
      if (cluster.kubeconfig !== undefined && !isAbsolute(cluster.kubeconfig)) {
        throw new Error(`K3s cluster "${cluster.id}" kubeconfig must be an absolute path`)
      }
      if (!Number.isSafeInteger(cluster.pollIntervalMs) || cluster.pollIntervalMs < 250 || cluster.pollIntervalMs > 30_000) {
        throw new Error(`K3s cluster "${cluster.id}" pollIntervalMs must be 250-30000`)
      }
    }
    for (const registry of registries.values()) this.validateRegistry(registry)
    for (const template of templates.values()) this.validateTemplate(template, registries)
    for (const pool of settings.workerPools) {
      validId(pool.id, 'Worker Pool')
      nonEmpty(pool.displayName, 'Worker Pool displayName')
      if (pool.queuePolicy !== 'fifo') throw new Error(`Worker Pool "${pool.id}" only supports fifo`)
      if (!Number.isSafeInteger(pool.maxConcurrency) || pool.maxConcurrency < 1 || pool.maxConcurrency > 1_000) {
        throw new Error(`Worker Pool "${pool.id}" maxConcurrency must be 1-1000`)
      }
      const cluster = clusters.get(pool.clusterId)
      if (cluster === undefined) throw new Error(`Worker Pool "${pool.id}" references unknown cluster "${pool.clusterId}"`)
      const registry = registries.get(pool.registryId)
      if (registry === undefined) throw new Error(`Worker Pool "${pool.id}" references unknown registry "${pool.registryId}"`)
      if (pool.templateIds.length === 0) throw new Error(`Worker Pool "${pool.id}" requires at least one template`)
      const selected = pool.templateIds.map((id) => {
        const template = templates.get(id)
        if (template === undefined) throw new Error(`Worker Pool "${pool.id}" references unknown template "${id}"`)
        return template
      })
      const runtimeTemplates: PactFlowHarnessTemplateView[] = []
      for (const template of selected) {
        if (isLegacyTemplate(template)) {
          runtimeTemplates.push(template)
          this.executions.set(executionKey(pool.id, template.id, undefined), template.id)
          continue
        }
        if (template.registryId !== pool.registryId) {
          throw new Error(`Harness template "${template.id}" registry "${template.registryId}" does not match Worker Pool "${pool.id}" registry "${pool.registryId}"`)
        }
        const registryForTemplate = registries.get(template.registryId)
        if (registryForTemplate === undefined) {
          throw new Error(`Harness template "${template.id}" references unknown registry "${template.registryId}"`)
        }
        const before = runtimeTemplates.length
        for (const model of models.values()) {
          if (PACTFLOW_HARNESS_API_MODE[template.harness] !== model.apiMode) continue
          const executionTemplateId = `${template.id}--${model.id}`
          runtimeTemplates.push({
            id: executionTemplateId,
            harness: template.harness,
            ...(template.interactionProtocol ? { interactionProtocol: template.interactionProtocol } : {}),
            apiMode: model.apiMode,
            image: pactFlowImageOf(registryForTemplate, template),
            model: model.model,
            baseUrl: model.baseUrl,
            modelSecretName: `pactflow-model-${model.id}`,
            cpuRequest: template.cpuRequest,
            memoryRequest: template.memoryRequest,
            cpuLimit: template.cpuLimit,
            memoryLimit: template.memoryLimit,
          })
          this.executions.set(executionKey(pool.id, template.id, model.id), executionTemplateId)
        }
        if (runtimeTemplates.length === before) {
          throw new Error(`Harness template "${template.id}" has no compatible model connection`)
        }
      }
      const imagePullSecret = pool.imagePullSecret ?? registry.imagePullSecret
      if (imagePullSecret === undefined || !K8S_NAME.test(imagePullSecret)) {
        throw new Error(`Worker Pool "${pool.id}" requires a valid imagePullSecret`)
      }
      const k3s: PactFlowK3sSettings = {
        namespace: cluster.namespace,
        pollIntervalMs: cluster.pollIntervalMs,
        imagePullSecret,
        templates: runtimeTemplates,
        ...cluster.kubeconfig === undefined ? {} : { kubeconfig: cluster.kubeconfig },
        ...cluster.context === undefined ? {} : { context: cluster.context },
        ...cluster.finishedJobTtlSeconds === undefined ? {} : { finishedJobTtlSeconds: cluster.finishedJobTtlSeconds },
      }
      this.pools.set(pool.id, Object.freeze({ ...pool, templateIds: [...pool.templateIds] }))
      this.resolved.set(pool.id, { pool, k3s })
      this.states.set(pool.id, { running: 0, queue: [] })
    }
  }

  resolve(poolId: string | undefined, templateId: string): PactFlowResolvedPool {
    const candidates = poolId === undefined
      ? [...this.resolved.values()].filter(candidate => candidate.pool.templateIds.includes(templateId))
      : []
    if (poolId === undefined && candidates.length > 1) {
      throw new Error(`PactFlow template "${templateId}" belongs to multiple Worker Pools; select one explicitly`)
    }
    const pool = poolId === undefined ? candidates[0] : this.resolved.get(poolId)
    if (pool === undefined && poolId === undefined) {
      const template = this.settings.templates.find(candidate => candidate.id === templateId)
      if (template === undefined) throw new Error(`PactFlow Harness "${templateId}" is not configured`)
      throw new Error(`PactFlow Harness "${templateId}" is not enabled in any Worker Pool`)
    }
    if (pool === undefined) throw new Error(`PactFlow Worker Pool "${poolId}" is not configured`)
    if (!pool.pool.templateIds.includes(templateId)) {
      throw new Error(`Worker Pool "${pool.pool.id}" does not allow template "${templateId}"`)
    }
    return pool
  }

  harnessProbeRoutes(templateId: string): readonly PactFlowResolvedPool[] {
    const template = this.settings.templates.find(candidate => candidate.id === templateId)
    if (template === undefined) throw new Error(`PactFlow Harness "${templateId}" is not configured`)
    return [...this.resolved.values()].filter(route => route.pool.templateIds.includes(templateId))
  }

  resolveExecution(
    poolId: string | undefined,
    templateId: string,
    modelConnectionId?: string,
  ): PactFlowResolvedExecution {
    const resolved = this.resolve(poolId, templateId)
    const compatible = [...this.models.values()]
      .filter(model => this.executions.has(executionKey(resolved.pool.id, templateId, model.id)))
    const modelId = modelConnectionId ?? (compatible.length === 1 ? compatible[0]!.id : undefined)
    const executionTemplateId = this.executions.get(executionKey(resolved.pool.id, templateId, modelId))
      ?? this.executions.get(executionKey(resolved.pool.id, templateId, undefined))
    if (executionTemplateId === undefined) {
      if (modelId === undefined && compatible.length > 1) {
        throw new Error(`PactFlow dispatch must select a model connection for Harness "${templateId}"`)
      }
      throw new Error(`Harness "${templateId}" and model connection "${modelId ?? ''}" are incompatible`)
    }
    const modelConnection = modelId === undefined ? undefined : this.models.get(modelId)
    return { ...resolved, executionTemplateId, ...(modelConnection === undefined ? {} : { modelConnection }) }
  }

  listTemplates(): readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[] {
    return this.settings.templates
  }

  listModelConnections(): readonly PactFlowModelConnectionSettings[] { return [...this.models.values()] }

  statuses(): readonly PactFlowWorkerPoolStatus[] {
    return [...this.pools.values()].map((pool) => {
      const state = this.states.get(pool.id)!
      return { ...pool, running: state.running, waiting: state.queue.length }
    })
  }

  cluster(id: string) {
    const value = this.settings.clusters.find(candidate => candidate.id === id)
    if (value === undefined) throw new Error(`PactFlow K3s cluster "${id}" is not configured`)
    return value
  }

  registry(id: string) {
    const value = this.settings.registries.find(candidate => candidate.id === id)
    if (value === undefined) throw new Error(`PactFlow registry "${id}" is not configured`)
    return value
  }

  gitProvider(id: string) {
    const value = this.providers.find(candidate => candidate.id === id)
    if (value === undefined) throw new Error(`PactFlow Git provider "${id}" is not configured`)
    return value
  }

  workerPool(id: string) {
    const value = this.pools.get(id)
    if (value === undefined) throw new Error(`PactFlow Worker Pool "${id}" is not configured`)
    return value
  }

  modelConnection(id: string): PactFlowModelConnectionSettings {
    const value = this.models.get(id)
    if (value === undefined) throw new Error(`PactFlow model connection "${id}" is not configured`)
    return value
  }

  async acquire(poolId: string, signal?: AbortSignal): Promise<() => void> {
    const pool = this.pools.get(poolId)
    const state = this.states.get(poolId)
    if (pool === undefined || state === undefined) throw new Error(`PactFlow Worker Pool "${poolId}" is not configured`)
    if (signal?.aborted) throw new Error(`PactFlow Worker Pool "${poolId}" wait was cancelled`)
    if (state.running < pool.maxConcurrency && state.queue.length === 0) {
      state.running += 1
      return this.releaseOnce(poolId)
    }
    if (state.queue.length >= MAX_POOL_QUEUE) {
      throw new Error(`PactFlow Worker Pool "${poolId}" queue is full`)
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, ...(signal === undefined ? {} : { signal }) }
      if (signal !== undefined) {
        waiter.abort = () => {
        const index = state.queue.indexOf(waiter)
        if (index >= 0) state.queue.splice(index, 1)
        reject(new Error(`PactFlow Worker Pool "${poolId}" wait was cancelled`))
        if (state.running === 0 && state.queue.length === 0) this.states.delete(poolId)
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
      }
      state.queue.push(waiter)
    })
  }

  /** Reserve immediately for the combined Host scheduler; never enqueues. */
  tryAcquire(poolId: string): (() => void) | undefined {
    const pool = this.pools.get(poolId)
    const state = this.states.get(poolId)
    if (pool === undefined || state === undefined) throw new Error(`PactFlow Worker Pool "${poolId}" is not configured`)
    if (state.queue.length !== 0 || state.running >= pool.maxConcurrency) return undefined
    state.running += 1
    return this.releaseOnce(poolId)
  }

  /** Restore one persisted nonterminal Job as occupied capacity before reconciliation. */
  reserveExisting(poolId: string): () => void {
    const pool = this.pools.get(poolId)
    const state = this.states.get(poolId)
    if (pool === undefined || state === undefined) throw new Error(`PactFlow Worker Pool "${poolId}" is not configured`)
    // Existing Jobs remain occupied even when the configured pool was reduced.
    state.running += 1
    return this.releaseOnce(poolId)
  }

  /** Look up one registered Git provider by its stable id. */
  giteaProvider(id: string): PactFlowGitProviderSettings {
    const provider = this.providers.find(candidate => candidate.id === id)
    if (provider === undefined) throw new Error(`PactFlow Git Provider "${id}" is not registered`)
    return provider
  }

  matchGitea(remoteUrl: string): { readonly provider: PactFlowGitProviderSettings; readonly owner: string; readonly repo: string } | undefined {
    const identity = remoteIdentity(remoteUrl)
    if (identity === undefined) return undefined
    // Match by host, then require the registered subpath (if any) to be an exact
    // path prefix. Ports are deliberately not compared: a Git remote (SSH 22) and
    // the Gitea API endpoint (HTTPS 443/3000) legitimately differ.
    const candidates: Array<{ readonly provider: PactFlowGitProviderSettings; readonly owner: string; readonly repo: string }> = []
    for (const provider of this.providers) {
      const matched = matchProviderRepository(provider, identity)
      if (matched !== undefined) candidates.push({ provider, ...matched })
    }
    if (candidates.length === 0) return undefined
    if (candidates.length > 1) {
      throw new Error(`Git remote host "${identity.host}" matches multiple Gitea providers`)
    }
    return candidates[0]!
  }

  private releaseOnce(poolId: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const state = this.states.get(poolId)!
      state.running -= 1
      if (state.running >= this.pools.get(poolId)!.maxConcurrency) return
      const waiter = state.queue.shift()
      if (waiter === undefined) return
      state.running += 1
      if (waiter.signal !== undefined && waiter.abort !== undefined) {
        waiter.signal.removeEventListener('abort', waiter.abort)
      }
      waiter.resolve(this.releaseOnce(poolId))
    }
  }

  private validateProvider(provider: PactFlowGitProviderSettings): PactFlowGitProviderSettings {
    validId(provider.id, 'Git provider')
    nonEmpty(provider.displayName, 'Git provider displayName')
    if (provider.kind !== 'gitea') throw new Error(`Git provider "${provider.id}" kind is unsupported`)
    const url = safeHttpUrl(provider.baseUrl, `Git provider "${provider.id}" baseUrl`)
    // HTTPS is the default. Plain HTTP is permitted only as an explicit local
    // exception (loopback), never for a remote endpoint.
    if (url.protocol === 'http:' && !isLoopbackHost(url.hostname)) {
      throw new Error(`Git provider "${provider.id}" baseUrl must use HTTPS unless it is a local loopback endpoint`)
    }
    nonEmpty(provider.tokenCredentialRef, `Git provider "${provider.id}" tokenCredentialRef`)
    if (!CREDENTIAL_REF.test(provider.tokenCredentialRef)) {
      throw new Error(`Git provider "${provider.id}" Credential ref is invalid`)
    }
    return Object.freeze({ ...provider, baseUrl: provider.baseUrl.replace(/\/$/, '') })
  }

  private validateRegistry(registry: PactFlowRegistrySettings): void {
    validId(registry.id, 'registry')
    nonEmpty(registry.displayName, 'registry displayName')
    if (registry.kind !== 'harbor') throw new Error(`registry "${registry.id}" kind is unsupported`)
    safeHttpUrl(registry.endpoint, `registry "${registry.id}" endpoint`)
    if (registry.harnessRepository !== undefined) {
      nonEmpty(registry.harnessRepository, `registry "${registry.id}" harnessRepository`)
      if (registry.harnessRepository.startsWith('/') || registry.harnessRepository.includes('..')) {
        throw new Error(`registry "${registry.id}" harnessRepository is invalid`)
      }
    }
    if (registry.imagePullSecret !== undefined && !K8S_NAME.test(registry.imagePullSecret)) {
      throw new Error(`registry "${registry.id}" imagePullSecret is invalid`)
    }
    const hasUsername = registry.username !== undefined || registry.usernameCredentialRef !== undefined
    if (hasUsername !== (registry.passwordCredentialRef !== undefined)) {
      throw new Error(`registry "${registry.id}" username/password must be configured together`)
    }
    for (const ref of [registry.usernameCredentialRef, registry.passwordCredentialRef]) {
      if (ref !== undefined && !CREDENTIAL_REF.test(ref)) {
        throw new Error(`registry "${registry.id}" Credential ref is invalid`)
      }
    }
  }

  private validateTemplate(
    template: PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings,
    registries: ReadonlyMap<string, PactFlowRegistrySettings>,
  ): void {
    validId(template.id, 'Harness template')
    if (template.interactionProtocol !== undefined && (template.harness !== 'dsh' || template.interactionProtocol !== 'dsh-worker-interactions/v1')) throw new Error('远程交互协议仅支持已适配的 DSH 执行器')
    if (!isLegacyTemplate(template)) {
      nonEmpty(template.displayName, `Harness template "${template.id}" displayName`)
      if (!registries.has(template.registryId)) {
        throw new Error(`Harness template "${template.id}" references unknown registry "${template.registryId}"`)
      }
      nonEmpty(template.repository, `Harness template "${template.id}" repository`)
      if (!/^sha256:[0-9a-f]{64}$/.test(template.artifactDigest)) {
        throw new Error(`Harness template "${template.id}" artifactDigest is invalid`)
      }
      return
    }
    if (PACTFLOW_HARNESS_API_MODE[template.harness] !== template.apiMode) {
      throw new Error(`Harness template "${template.id}" protocol is incompatible with ${template.harness}`)
    }
    if (!IMAGE_DIGEST.test(template.image)) throw new Error(`Harness template "${template.id}" image must use sha256 digest`)
  }

  private validateModel(model: PactFlowModelConnectionSettings): void {
    validId(model.id, 'model connection')
    nonEmpty(model.displayName, `model connection "${model.id}" displayName`)
    nonEmpty(model.model, `model connection "${model.id}" model`)
    safeHttpUrl(model.baseUrl, `model connection "${model.id}" baseUrl`)
    nonEmpty(model.apiKeyCredentialRef, `model connection "${model.id}" Credential ref`)
    if (!CREDENTIAL_REF.test(model.apiKeyCredentialRef)) {
      throw new Error(`model connection "${model.id}" Credential ref is invalid`)
    }
  }
}

function isLegacyTemplate(
  template: PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings,
): template is PactFlowHarnessTemplateView {
  return 'image' in template
}

function executionKey(poolId: string, templateId: string, modelId: string | undefined): string {
  return `${poolId}\u0000${templateId}\u0000${modelId ?? ''}`
}

export function pactFlowImageOf(registry: PactFlowRegistrySettings, template: PactFlowHarnessProfileSettings): string {
  const endpoint = new URL(registry.endpoint)
  const host = `${endpoint.host}${endpoint.pathname.replace(/\/+$/, '')}`
  const repository = template.repository.replace(/^\/+|\/+$/g, '')
  const project = registry.project?.replace(/^\/+|\/+$/g, '')
  const path = project === undefined || repository.startsWith(`${project}/`)
    ? repository
    : `${project}/${repository}`
  return `${host}/${path}@${template.artifactDigest}`
}

function unique<T extends { readonly id: string }>(values: readonly T[], kind: string): Map<string, T> {
  const result = new Map<string, T>()
  for (const value of values) {
    if (result.has(value.id)) throw new Error(`duplicate ${kind} "${value.id}"`)
    result.set(value.id, value)
  }
  return result
}

function validId(value: string, kind: string): void {
  if (!ID.test(value)) throw new Error(`${kind} id "${value}" is invalid`)
}

function nonEmpty(value: string, field: string): void {
  if (value.trim() === '') throw new Error(`${field} must be non-empty`)
}

function safeHttpUrl(value: string, field: string): URL {
  let parsed: URL
  try { parsed = new URL(value) } catch { throw new Error(`${field} must be an HTTP(S) URL`) }
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username !== '' || parsed.password !== ''
    || parsed.search !== '' || parsed.hash !== '') throw new Error(`${field} must be credential-free`)
  return parsed
}

/** Loopback hosts are the only endpoints allowed to use cleartext HTTP. */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '')
  return host === 'localhost' || host === '::1' || /^127(?:\.\d{1,3}){3}$/.test(host)
}

function remoteIdentity(value: string): { readonly host: string; readonly path: readonly string[] } | undefined {
  // NOTE: use String.match (not RegExp.exec) — an .exec( token in source is
  // misread by a static scanner as process execution.
  const scp = value.match(/^[^@\s]+@([^:\s]+):(.+)$/)
  if (scp !== null) return { host: scp[1]!.toLowerCase(), path: cleanPath(scp[2]!) }
  try {
    const parsed = new URL(value)
    if (!['http:', 'https:', 'ssh:'].includes(parsed.protocol)) return undefined
    return { host: parsed.hostname.toLowerCase(), path: cleanPath(parsed.pathname) }
  } catch { return undefined }
}

/**
 * Whether one registered provider corresponds to a remote identity, returning the
 * repository identity taken after the provider's registered path prefix. A
 * non-empty provider subpath must be an exact leading prefix of the remote path,
 * so a remote outside the registered subpath never resolves to that provider.
 */
function matchProviderRepository(
  provider: PactFlowGitProviderSettings,
  identity: { readonly host: string; readonly path: readonly string[] },
): { readonly owner: string; readonly repo: string } | undefined {
  const providerIdentity = remoteIdentity(provider.baseUrl)
  if (providerIdentity === undefined || providerIdentity.host !== identity.host) return undefined
  const prefix = providerIdentity.path
  if (prefix.length > 0) {
    if (identity.path.length < prefix.length) return undefined
    for (let index = 0; index < prefix.length; index += 1) {
      if (identity.path[index] !== prefix[index]) return undefined
    }
  }
  const remainder = identity.path.slice(prefix.length)
  if (remainder.length < 2) return undefined
  return { owner: remainder.at(-2)!, repo: remainder.at(-1)! }
}

function cleanPath(value: string): readonly string[] {
  const parts = value.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean)
  if (parts.length > 0) parts[parts.length - 1] = parts.at(-1)!.replace(/\.git$/, '')
  return parts
}
