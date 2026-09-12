import { PACTFLOW_HARNESS_PROTOCOL } from '../harness-discovery.ts'
import { isHarnessProfile } from './resource-model.ts'
import type { InfrastructureResource, InfrastructureTestLog } from './settings-contract.ts'
import type { EditorColumn } from './resource-cards.tsx'
import type {
  PactFlowGitProviderSettings,
  PactFlowHarnessProfileSettings,
  PactFlowHarnessTemplateView,
  PactFlowInfrastructureProbeResult,
  PactFlowInfrastructureResourceKind,
  PactFlowInfrastructureSettings,
  PactFlowK3sClusterSettings,
  PactFlowModelConnectionSettings,
  PactFlowRegistrySettings,
  PactFlowWorkerPoolSettings,
} from '../types.ts'

export const EMPTY_INFRASTRUCTURE: PactFlowInfrastructureSettings = {
  clusters: [], registries: [], gitProviders: [], templates: [], modelConnections: [], workerPools: [],
}

export function compatibleHarnessTemplateIds(
  templates: readonly PactFlowHarnessProfileSettings[],
  models: readonly PactFlowModelConnectionSettings[],
): readonly string[] {
  const modes = new Set(models.map(model => model.apiMode))
  return templates.filter(template => modes.has(PACTFLOW_HARNESS_PROTOCOL[template.harness])).map(template => template.id)
}

export const clusterColumns: readonly EditorColumn<PactFlowK3sClusterSettings>[] = [
  { key: 'displayName', label: '名称', hint: '例如「家庭 K3s」。' },
  { key: 'namespace', label: 'Worker Namespace', hint: '零脉 Job 运行的 Kubernetes Namespace。' },
  { key: 'kubeconfig', label: 'Kubeconfig 文件', kind: 'file', hint: '从 DSH 宿主机选择，文件内容不会传到浏览器。' },
  { key: 'context', label: '集群上下文', hint: 'Kubeconfig 中的集群、用户和 Namespace 组合。' },
  { key: 'pollIntervalMs', label: '状态轮询（毫秒）', kind: 'number', advanced: true },
]
export const registryColumns: readonly EditorColumn<PactFlowRegistrySettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'endpoint', label: 'Harbor URL' }, { key: 'project', label: 'Project' },
  { key: 'harnessRepository', label: 'Harness 镜像仓库', hint: '只从该仓库发现 Worker 镜像，不扫描项目内其它业务仓库。' },
  { key: 'tlsVerify', label: '校验 TLS 证书', kind: 'boolean', hint: '自签名测试环境可关闭，生产环境应开启。' },
  { key: 'username', label: '账号' },
]
export const gitProviderColumns: readonly EditorColumn<PactFlowGitProviderSettings>[] = [
  { key: 'displayName', label: '名称' }, { key: 'baseUrl', label: 'Gitea URL' },
  { key: 'username', label: '账号' },
]
export const templateColumns: readonly EditorColumn<PactFlowHarnessProfileSettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'harness', label: 'Harness', options: ['claude', 'codex', 'opencode', 'dsh'] },
  { key: 'registryId', label: '镜像仓库' },
  { key: 'repository', label: 'Repository', hidden: true }, { key: 'artifactDigest', label: 'Digest', hidden: true },
  { key: 'cpuRequest', label: 'CPU 请求' }, { key: 'memoryRequest', label: '内存请求' },
  { key: 'cpuLimit', label: 'CPU 上限' }, { key: 'memoryLimit', label: '内存上限' },
]
export const modelColumns: readonly EditorColumn<PactFlowModelConnectionSettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'apiMode', label: '接口协议', options: ['anthropic-messages', 'openai-responses', 'openai-chat-completions'], hint: '必须与要使用的 Harness 兼容。' },
  { key: 'baseUrl', label: '模型服务 URL' },
  { key: 'apiKeyCredentialRef', label: 'Credential Ref', hidden: true },
]
export const workerPoolColumns: readonly EditorColumn<PactFlowWorkerPoolSettings>[] = [
  { key: 'displayName', label: '名称' }, { key: 'clusterId', label: 'K3s 集群' },
  { key: 'templateIds', label: '允许调度的 Harness', kind: 'list', hint: '只有选中的 Harness 才能由这个调度组启动。' },
  { key: 'maxConcurrency', label: '同时运行的 Worker 上限', kind: 'number', hint: '该池同时运行的 Worker Pod 总数上限：不分 Harness（各类共享同一总量），且被所有使用此池的项目共享；超出上限的任务自动排队。' },
  { key: 'imagePullSecret', label: 'Harbor 镜像拉取密钥', hint: 'K3s 使用该 dockerconfigjson Secret 从私有 Harbor 拉取 Worker 镜像。' },
  { key: 'registryId', label: 'Registry', hidden: true }, { key: 'queuePolicy', label: '队列', hidden: true },
]

export const newCluster = (rows: readonly PactFlowK3sClusterSettings[]): PactFlowK3sClusterSettings => ({
  id: nextId('cluster', rows), displayName: 'K3s 集群', namespace: 'pactflow', pollIntervalMs: 2_000,
})
export const newRegistry = (rows: readonly PactFlowRegistrySettings[]): PactFlowRegistrySettings => ({
  id: nextId('harbor', rows), displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
  harnessRepository: 'pactflow-worker', tlsVerify: false,
  passwordCredentialRef: credentialRefFor('HARBOR', nextId('harbor', rows), 'PASSWORD'),
})
export const newGitProvider = (rows: readonly PactFlowGitProviderSettings[]): PactFlowGitProviderSettings => ({
  id: nextId('gitea', rows), displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.example',
  tokenCredentialRef: credentialRefFor('GITEA', nextId('gitea', rows), 'PASSWORD'),
})
export const newTemplate = (
  rows: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[],
  registryId: string,
): PactFlowHarnessProfileSettings => ({
  id: nextId('claude', rows), displayName: 'Claude Code', harness: 'claude', registryId,
  repository: '', artifactDigest: `sha256:${'0'.repeat(64)}`,
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
})
export const newModel = (rows: readonly PactFlowModelConnectionSettings[]): PactFlowModelConnectionSettings => ({
  id: nextId('model', rows), displayName: '模型连接', apiMode: 'anthropic-messages',
  model: '', baseUrl: '', apiKeyCredentialRef: credentialRefFor('MODEL', nextId('model', rows), 'API_KEY'),
})
export const newWorkerPool = (
  rows: readonly PactFlowWorkerPoolSettings[], clusterId: string, registryId: string, templateIds: readonly string[],
): PactFlowWorkerPoolSettings => ({
  id: nextId('default', rows), displayName: '默认执行资源池', clusterId, registryId,
  templateIds, maxConcurrency: 1, queuePolicy: 'fifo',
})

export function nextId<T extends { readonly id: string }>(base: string, rows: readonly T[]): string {
  if (!rows.some(row => row.id === base)) return base
  let suffix = 2
  while (rows.some(row => row.id === `${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

export function toggleSet(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

export function credentialRefFor(kind: string, id: string, purpose: string): string {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `PACTFLOW_${kind}_${normalized}_${purpose}`
}

export function probeStageEntry(stage: PactFlowInfrastructureProbeResult['stages'][number]): InfrastructureTestLog['entries'][number] {
  const names: Readonly<Record<string, string>> = {
    start: '启动测试',
    'resolve-config': '校验配置',
    'namespace-access': '访问 K3s Namespace',
    'harbor-ping': '连接 Harbor API',
    'project-access': '访问 Harbor 项目',
    'harness-images': '读取 Harness 镜像',
    'gitea-api': '连接 Gitea API',
    'harness-profile': '校验 Harness',
    'harness-validate': '校验 Harness 镜像',
    'harness-create-job': '启动临时 Pod',
    'harness-cli-response': '验证 Harness CLI',
    'harness-cleanup': '清理临时资源',
    'model-api': '连接模型 API',
    'resource-graph': '校验执行资源池',
    connection: '连接失败',
  }
  const details: Readonly<Record<string, string>> = {
    start: stage.detail.includes('currently saved')
      ? '读取当前已保存的配置'
      : '读取当前卡片中未保存的表单值，本次测试不依赖重启后配置',
    'resolve-config': '字段格式和资源引用有效',
    'namespace-access': stage.detail.replace(/^namespace /, 'Namespace ').replace(/ is accessible$/, ' 可访问'),
    'harbor-ping': stage.detail.replace('Harbor API returned', 'Harbor API 返回'),
    'project-access': stage.detail.replace(/^project /, '项目 ').replace(/ is accessible$/, ' 可访问'),
    'harness-images': stage.detail.replace(/^repository /, '仓库 ').replace(' exposes ', ' 已识别 ').replace(' Harness image families', ' 类 Harness 镜像'),
    'gitea-api': stage.detail.replace('Gitea API returned', 'Gitea API 返回'),
    'harness-profile': 'Harness 镜像引用和 CPU/内存资源规格有效',
    'model-api': stage.detail.replace('model endpoint accepted', '模型端点已接受'),
    'resource-graph': '集群、镜像仓库、Harness、凭证和并发配置引用有效',
  }
  return {
    state: stage.state,
    name: names[stage.name] ?? stage.name,
    detail: stage.state === 'failed' ? stage.detail : details[stage.name] ?? stage.detail,
  }
}

export function normalizeInfrastructure(value: PactFlowInfrastructureSettings): PactFlowInfrastructureSettings {
  const models = (value.modelConnections ?? []).map(model => ({
    ...model,
    apiKeyCredentialRef: /^[A-Za-z_][A-Za-z0-9_]*$/.test(model.apiKeyCredentialRef)
      ? model.apiKeyCredentialRef
      : credentialRefFor('MODEL', model.id, 'API_KEY'),
  }))
  const templates = value.templates.map((template): PactFlowHarnessProfileSettings => {
    if (isHarnessProfile(template)) return template
    const registry = value.registries.find((candidate) => {
      try { return new URL(candidate.endpoint).host === template.image.split('/')[0] } catch { return false }
    }) ?? value.registries[0]
    const modelId = nextId(`${template.id}-model`, models)
    models.push({
      id: modelId, displayName: `${template.model} (${template.harness})`, apiMode: template.apiMode,
      model: template.model, baseUrl: template.baseUrl, apiKeyCredentialRef: credentialRefFor('MODEL', modelId, 'API_KEY'),
    })
    const image = template.image.split('@')
    const repositoryPath = image[0]?.split('/').slice(1).join('/') ?? ''
    const project = registry?.project
    const repository = project !== undefined && repositoryPath.startsWith(`${project}/`)
      ? repositoryPath.slice(project.length + 1)
      : repositoryPath
    return {
      id: template.id, displayName: template.id, harness: template.harness,
      registryId: registry?.id ?? '', repository, artifactDigest: image[1] ?? `sha256:${'0'.repeat(64)}`,
      cpuRequest: template.cpuRequest, memoryRequest: template.memoryRequest,
      cpuLimit: template.cpuLimit, memoryLimit: template.memoryLimit,
    }
  })
  return {
    ...value,
    registries: value.registries.map(registry => ({
      ...registry,
      ...(registry.project === undefined ? {} : { project: registry.project.trim().replace(/^\/+|\/+$/g, '') }),
      harnessRepository: registry.harnessRepository?.trim() || 'pactflow-worker',
      ...(registry.passwordCredentialRef === undefined ? {} : {
        passwordCredentialRef: /^[A-Za-z_][A-Za-z0-9_]*$/.test(registry.passwordCredentialRef)
          ? registry.passwordCredentialRef
          : credentialRefFor('HARBOR', registry.id, 'PASSWORD'),
      }),
    })),
    gitProviders: value.gitProviders.map(provider => ({
      ...provider,
      tokenCredentialRef: /^[A-Za-z_][A-Za-z0-9_]*$/.test(provider.tokenCredentialRef)
        ? provider.tokenCredentialRef
        : credentialRefFor('GITEA', provider.id, 'PASSWORD'),
    })),
    templates,
    modelConnections: models,
    workerPools: value.workerPools.map((pool) => {
      const imagePullSecret = pool.imagePullSecret
        ?? value.registries.find(registry => registry.id === pool.registryId)?.imagePullSecret
      return { ...pool, ...(imagePullSecret === undefined ? {} : { imagePullSecret }) }
    }),
  }
}

export function resourceRows(
  settings: PactFlowInfrastructureSettings,
  kind: PactFlowInfrastructureResourceKind,
): readonly InfrastructureResource[] {
  if (kind === 'cluster') return settings.clusters
  if (kind === 'registry') return settings.registries
  if (kind === 'git-provider') return settings.gitProviders
  if (kind === 'harness') return settings.templates.filter(isHarnessProfile)
  if (kind === 'model-connection') return settings.modelConnections ?? []
  return settings.workerPools
}

export function resourceCredentialRefs(
  kind: PactFlowInfrastructureResourceKind,
  resource: InfrastructureResource,
): readonly string[] {
  if (kind === 'registry') {
    const registry = resource as PactFlowRegistrySettings
    return [registry.usernameCredentialRef, registry.passwordCredentialRef]
      .filter((ref): ref is string => ref !== undefined)
  }
  if (kind === 'git-provider') return [(resource as PactFlowGitProviderSettings).tokenCredentialRef]
  if (kind === 'model-connection') return [(resource as PactFlowModelConnectionSettings).apiKeyCredentialRef]
  return []
}

export function replaceResource(
  settings: PactFlowInfrastructureSettings,
  kind: PactFlowInfrastructureResourceKind,
  resource: InfrastructureResource,
): PactFlowInfrastructureSettings {
  const replace = <T extends InfrastructureResource>(rows: readonly T[]): readonly T[] => [
    ...rows.filter(row => row.id !== resource.id), resource as T,
  ]
  if (kind === 'cluster') return { ...settings, clusters: replace(settings.clusters) }
  if (kind === 'registry') return { ...settings, registries: replace(settings.registries) }
  if (kind === 'git-provider') return { ...settings, gitProviders: replace(settings.gitProviders) }
  if (kind === 'harness') return { ...settings, templates: replace(settings.templates.filter(isHarnessProfile)) }
  if (kind === 'model-connection') return { ...settings, modelConnections: replace(settings.modelConnections ?? []) }
  return { ...settings, workerPools: replace(settings.workerPools) }
}

export function removeResource(
  settings: PactFlowInfrastructureSettings,
  kind: PactFlowInfrastructureResourceKind,
  id: string,
): PactFlowInfrastructureSettings {
  if (kind === 'cluster') return { ...settings, clusters: settings.clusters.filter(row => row.id !== id) }
  if (kind === 'registry') return { ...settings, registries: settings.registries.filter(row => row.id !== id) }
  if (kind === 'git-provider') return { ...settings, gitProviders: settings.gitProviders.filter(row => row.id !== id) }
  if (kind === 'harness') return { ...settings, templates: settings.templates.filter(row => row.id !== id) }
  if (kind === 'model-connection') {
    return { ...settings, modelConnections: (settings.modelConnections ?? []).filter(row => row.id !== id) }
  }
  return { ...settings, workerPools: settings.workerPools.filter(row => row.id !== id) }
}
