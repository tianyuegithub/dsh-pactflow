import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { RemoteResult } from '@deepseek-ai/dsh-typert-protocol'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import pactflowRemote from 'dsh-pactflow/remote'
import { synchronizeHarnessTemplates } from '../harness-discovery.ts'
import { ActionFeedbackToast, useActionFeedback } from './action-feedback.tsx'
import { PactFlowProjectPanel, type PactFlowProjectPanelFace } from './project-panel.tsx'
import type {
  PactFlowHarnessProbeResult,
  PactFlowApiMode,
  PactFlowApiProbeResult,
  PactFlowHarnessTemplateView,
  PactFlowHarnessProfileSettings,
  PactFlowHarborArtifactOption,
  PactFlowHealth,
  PactFlowSnapshot,
  PactFlowSettingsView,
  PactFlowGiteaStatus,
  PactFlowInfrastructureSettings,
  PactFlowInfrastructureProbeResult,
  PactFlowInfrastructureHealthRecord,
  PactFlowInfrastructureDeletionImpact,
  PactFlowInfrastructureResourceKind,
  PactFlowDiscoveredModel,
  PactFlowGitProviderSettings,
  PactFlowK3sClusterSettings,
  PactFlowKubeconfigView,
  PactFlowModelConnectionSettings,
  PactFlowRegistrySettings,
  PactFlowWorkerPoolSettings,
  PactFlowWorkerPoolStatus,
  PactFlowWorkspaceProjectConfig,
} from '../types.ts'

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/remote'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'

const NS = 'pactflow'

type PactFlowLocaleKey =
  | 'open'
  | 'title'
  | 'subtitle'
  | 'close'
  | 'loading'
  | 'ready'
  | 'failed'
  | 'project'
  | 'needs'
  | 'dag'
  | 'runs'
  | 'gitRemote'
  | 'gitBaseline'
  | 'gitBranch'
  | 'gitCommit'
  | 'attempt'
  | 'validations'
  | 'k3sTemplates'
  | 'workerPools'
  | 'apiMode'
  | 'harnessTest'
  | 'apiTest'
  | 'testing'
  | 'settingsTitle'
  | 'settingsDescription'
  | 'settingsRestart'
  | 'settingsSave'
  | 'settingsDisable'
  | 'settingsInvalid'
  | 'settingsSaved'
  | 'verifyGitea'
  | 'giteaProtected'
  | 'giteaUnprotected'
  | 'empty'

const zh: Record<PactFlowLocaleKey, string> = {
  open: '打开零脉',
  title: '零脉 · PactFlow',
  subtitle: 'DSH 原生项目工作流模式',
  close: '关闭',
  loading: '正在验证 Host 与 Typert Remote…',
  ready: '外部 Bundle、Preset Root 与事件生产者已就绪',
  failed: '连接验证失败',
  project: '项目',
  needs: '需求与阶段',
  dag: 'DAG 节点',
  runs: 'Worker 运行',
  gitRemote: 'Git 远端',
  gitBaseline: '基线分支',
  gitBranch: '任务分支',
  gitCommit: '提交',
  attempt: '尝试',
  validations: '验证命令',
  k3sTemplates: 'K3s Harness 模板',
  workerPools: 'Worker Pool 容量',
  apiMode: 'API 模式',
  harnessTest: 'Harness 测试',
  apiTest: 'API 测试',
  testing: '测试中…',
  settingsTitle: '零脉基础设施',
  settingsDescription: '按顺序配置 K3s、Harbor、Gitea、Harness、模型连接和执行资源池。密码与 API Key 由 DSH Credentials 安全保存。',
  settingsRestart: '保存后重启 Profile 生效。',
  settingsSave: '保存配置',
  settingsDisable: '禁用基础设施',
  settingsInvalid: 'JSON 配置无效',
  settingsSaved: '已保存，等待重启',
  verifyGitea: '验证 Gitea',
  giteaProtected: '默认分支已保护',
  giteaUnprotected: '默认分支未保护',
  empty: '暂无数据',
}

const en: Record<PactFlowLocaleKey, string> = {
  open: 'Open PactFlow',
  title: 'PactFlow',
  subtitle: 'Native project workflow mode for DSH',
  close: 'Close',
  loading: 'Checking Host and Typert Remote…',
  ready: 'External Bundle, preset root, and event producer are ready',
  failed: 'Connection check failed',
  project: 'Project',
  needs: 'Needs and phases',
  dag: 'DAG nodes',
  runs: 'Worker runs',
  gitRemote: 'Git remote',
  gitBaseline: 'Baseline branch',
  gitBranch: 'Task branch',
  gitCommit: 'Commit',
  attempt: 'Attempt',
  validations: 'Validation commands',
  k3sTemplates: 'K3s Harness templates',
  workerPools: 'Worker Pool capacity',
  apiMode: 'API mode',
  harnessTest: 'Harness test',
  apiTest: 'API test',
  testing: 'Testing…',
  settingsTitle: 'PactFlow infrastructure',
  settingsDescription: 'Configure K3s, Harbor, Gitea, Harnesses, model connections, and execution pools in order. Passwords and API keys are stored by DSH Credentials.',
  settingsRestart: 'Restart the Profile after saving.',
  settingsSave: 'Save configuration',
  settingsDisable: 'Disable infrastructure',
  settingsInvalid: 'Invalid JSON configuration',
  settingsSaved: 'Saved; restart required',
  verifyGitea: 'Verify Gitea',
  giteaProtected: 'Default branch protected',
  giteaUnprotected: 'Default branch unprotected',
  empty: 'No data',
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    pactflow: PactFlowLocaleKey
  }
}

interface OverlayState {
  readonly open: boolean
  readonly sessionId: string | null
  readonly phase: 'idle' | 'loading' | 'ready' | 'failed'
  readonly health: PactFlowHealth | null
  readonly snapshot: PactFlowSnapshot | null
  readonly error: string | null
  readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
  readonly workerPools: readonly PactFlowWorkerPoolStatus[]
  readonly probingTemplateId: string | null
  readonly probe: PactFlowHarnessProbeResult | PactFlowApiProbeResult | null
  readonly giteaStatus: PactFlowGiteaStatus | null
  readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
}

const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  phase: 'idle',
  health: null,
  snapshot: null,
  error: null,
  templates: [],
  workerPools: [],
  probingTemplateId: null,
  probe: null,
  giteaStatus: null,
  workspaceProject: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

interface OverlayInjected {
  load(sessionId: string): Promise<{
    readonly health: PactFlowHealth
    readonly snapshot: PactFlowSnapshot
    readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
    readonly workerPools: readonly PactFlowWorkerPoolStatus[]
    readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
  }>
  probeHarness(templateId: string, prompt: string, timeoutMs: number): Promise<PactFlowHarnessProbeResult>
  probeApi(templateId: string, prompt: string, timeoutMs: number): Promise<PactFlowApiProbeResult>
  verifyGitea(sessionId: string): Promise<PactFlowGiteaStatus>
}

type OverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OverlayInjected>

type SettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<typeof NS>
  & InjectFace<{
    readonly settings: SettingsScope<PactFlowSettingsView>
    probeInfrastructure(
      kind: PactFlowInfrastructureResourceKind,
      id: string,
      draft?: PactFlowInfrastructureSettings,
    ): Promise<PactFlowInfrastructureProbeResult>
    listInfrastructureHealth(): Promise<readonly PactFlowInfrastructureHealthRecord[]>
    pickHostFile(): Promise<string | null>
    inspectKubeconfig(path: string): Promise<PactFlowKubeconfigView>
    listImagePullSecrets(clusterId: string, draft: PactFlowInfrastructureSettings): Promise<readonly string[]>
    listHarborArtifacts(registryId: string, draft: PactFlowInfrastructureSettings): Promise<readonly PactFlowHarborArtifactOption[]>
    discoverModels(model: PactFlowModelConnectionSettings, apiKey: string): Promise<readonly PactFlowDiscoveredModel[]>
    setCredential(ref: string, value: string): Promise<void>
    unsetCredential(ref: string): Promise<void>
    deletionImpact(
      kind: PactFlowInfrastructureResourceKind, id: string, draft: PactFlowInfrastructureSettings,
    ): Promise<PactFlowInfrastructureDeletionImpact>
  }>

interface InfrastructureTestLog {
  readonly running: boolean
  readonly success?: boolean
  readonly durationMs?: number
  readonly testedAt?: string
  readonly entries: readonly {
    readonly state: 'running' | 'succeeded' | 'failed'
    readonly name: string
    readonly detail: string
  }[]
}

type InfrastructureResource =
  | PactFlowK3sClusterSettings | PactFlowRegistrySettings | PactFlowGitProviderSettings
  | PactFlowHarnessProfileSettings | PactFlowModelConnectionSettings | PactFlowWorkerPoolSettings

interface ActiveResourceEditor {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly mode: 'new' | 'edit'
}

interface DeleteResourceDialogState {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly name: string
  readonly impact: PactFlowInfrastructureDeletionImpact | null
  readonly error: string | null
}

/** Header entry rendered only for sessions composed from the PactFlow preset. */
function PactFlowHeaderAction({ sessionId, useSessions, t }: HeaderActionProps) {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  if (preset !== 'pactflow') return null
  return (
    <button
      type="button"
      onClick={() => {
        overlay.set({
          open: true, sessionId, phase: 'idle', health: null, snapshot: null, error: null,
          templates: [], workerPools: [], probingTemplateId: null, probe: null,
          giteaStatus: null, workspaceProject: null,
        })
      }}
      style={buttonStyle}
    >
      {t('open')}
    </button>
  )
}

/** Root-scoped native overlay; the current session id arrives through the header action. */
function PactFlowOverlay({ load, probeApi, probeHarness, verifyGitea, t }: OverlayProps) {
  const state = useSyncExternalStore(overlay.subscribe, overlay.getSnapshot)

  useEffect(() => {
    if (!state.open || state.phase !== 'idle') return
    if (state.sessionId === null) return
    overlay.set({ ...state, phase: 'loading', error: null })
    void load(state.sessionId).then(
      value => { overlay.set({ ...overlay.getSnapshot(), phase: 'ready', ...value }) },
      error => {
        overlay.set({
          ...overlay.getSnapshot(),
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }, [load, state])

  if (!state.open) return null
  return (
    <div role="dialog" aria-modal="true" aria-label={t('title')} style={backdropStyle}>
      <section style={panelStyle}>
        <header style={headerStyle}>
          <div>
            <h1 style={titleStyle}>{t('title')}</h1>
            <p style={subtitleStyle}>{t('subtitle')}</p>
          </div>
          <button
            type="button"
            onClick={() => { overlay.set({ ...overlay.getSnapshot(), open: false }) }}
            style={buttonStyle}
          >
            {t('close')}
          </button>
        </header>
        <div style={bodyStyle}>
          <p>
            {state.phase === 'loading' && t('loading')}
            {state.phase === 'ready' && t('ready')}
            {state.phase === 'failed' && t('failed')}
          </p>
          {state.health !== null && (
            <details style={diagnosticStyle}>
              <summary>插件运行诊断</summary>
              <p style={hintStyle}>
                {state.health.plugin} {state.health.version} · {state.health.externalEventTypes.length} events
              </p>
              <pre style={preStyle}>{JSON.stringify(state.health, null, 2)}</pre>
            </details>
          )}
          <section style={diagnosticStyle}>
            <strong>工作区项目配置</strong>
            <p style={hintStyle}>{state.workspaceProject === null
              ? '当前会话尚未关联工作区级项目配置；请使用左侧“零脉项目”。'
              : `${state.workspaceProject.workspaceTitle} · 修订 ${String(state.workspaceProject.revision)}`}</p>
          </section>
          {state.snapshot !== null && (
            <PactFlowProjectionTables
              snapshot={state.snapshot}
              templates={state.templates}
              workerPools={state.workerPools}
              probingTemplateId={state.probingTemplateId}
              onProbe={(templateId) => {
                overlay.set({ ...overlay.getSnapshot(), probingTemplateId: templateId, probe: null })
                void probeHarness(templateId, 'say hi to me', 180_000).then(
                  probe => overlay.set({ ...overlay.getSnapshot(), probingTemplateId: null, probe }),
                  error => overlay.set({
                    ...overlay.getSnapshot(), probingTemplateId: null,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                )
              }}
              onApiProbe={(templateId) => {
                overlay.set({ ...overlay.getSnapshot(), probingTemplateId: templateId, probe: null })
                void probeApi(templateId, 'say hi to me', 180_000).then(
                  probe => overlay.set({ ...overlay.getSnapshot(), probingTemplateId: null, probe }),
                  error => overlay.set({
                    ...overlay.getSnapshot(), probingTemplateId: null,
                    error: error instanceof Error ? error.message : String(error),
                  }),
                )
              }}
              giteaStatus={state.giteaStatus}
              onVerifyGitea={() => {
                if (state.sessionId === null) return
                void verifyGitea(state.sessionId).then(
                  giteaStatus => overlay.set({ ...overlay.getSnapshot(), giteaStatus }),
                  error => overlay.set({
                    ...overlay.getSnapshot(),
                    error: error instanceof Error ? error.message : String(error),
                  }),
                )
              }}
              t={t}
            />
          )}
          {state.probe !== null && <pre style={probeStyle}>{JSON.stringify(state.probe, null, 2)}</pre>}
          {state.error !== null && <pre style={errorStyle}>{state.error}</pre>}
        </div>
      </section>
    </div>
  )
}

const EMPTY_INFRASTRUCTURE: PactFlowInfrastructureSettings = {
  clusters: [], registries: [], gitProviders: [], templates: [], modelConnections: [], workerPools: [],
}

const HARNESS_PROTOCOL: Readonly<Record<PactFlowHarnessProfileSettings['harness'], PactFlowApiMode>> = {
  claude: 'anthropic-messages', codex: 'openai-responses',
  opencode: 'openai-chat-completions', dsh: 'openai-chat-completions',
}

function compatibleHarnessTemplateIds(
  templates: readonly PactFlowHarnessProfileSettings[],
  models: readonly PactFlowModelConnectionSettings[],
): readonly string[] {
  const modes = new Set(models.map(model => model.apiMode))
  return templates.filter(template => modes.has(HARNESS_PROTOCOL[template.harness])).map(template => template.id)
}

const clusterColumns: readonly EditorColumn<PactFlowK3sClusterSettings>[] = [
  { key: 'displayName', label: '名称', hint: '例如「家庭 K3s」。' },
  { key: 'namespace', label: 'Worker Namespace', hint: '零脉 Job 运行的 Kubernetes Namespace。' },
  { key: 'kubeconfig', label: 'Kubeconfig 文件', kind: 'file', hint: '从 DSH 宿主机选择，文件内容不会传到浏览器。' },
  { key: 'context', label: '集群上下文', hint: 'Kubeconfig 中的集群、用户和 Namespace 组合。' },
  { key: 'pollIntervalMs', label: '状态轮询（毫秒）', kind: 'number', advanced: true },
]
const registryColumns: readonly EditorColumn<PactFlowRegistrySettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'endpoint', label: 'Harbor URL' }, { key: 'project', label: 'Project' },
  { key: 'harnessRepository', label: 'Harness 镜像仓库', hint: '只从该仓库发现 Worker 镜像，不扫描项目内其它业务仓库。' },
  { key: 'tlsVerify', label: '校验 TLS 证书', kind: 'boolean', hint: '自签名测试环境可关闭，生产环境应开启。' },
  { key: 'username', label: '账号' },
]
const gitProviderColumns: readonly EditorColumn<PactFlowGitProviderSettings>[] = [
  { key: 'displayName', label: '名称' }, { key: 'baseUrl', label: 'Gitea URL' },
  { key: 'username', label: '账号' },
]
const templateColumns: readonly EditorColumn<PactFlowHarnessProfileSettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'harness', label: 'Harness', options: ['claude', 'codex', 'opencode', 'dsh'] },
  { key: 'registryId', label: '镜像仓库' },
  { key: 'repository', label: 'Repository', hidden: true }, { key: 'artifactDigest', label: 'Digest', hidden: true },
  { key: 'cpuRequest', label: 'CPU 请求' }, { key: 'memoryRequest', label: '内存请求' },
  { key: 'cpuLimit', label: 'CPU 上限' }, { key: 'memoryLimit', label: '内存上限' },
]
const modelColumns: readonly EditorColumn<PactFlowModelConnectionSettings>[] = [
  { key: 'displayName', label: '名称' },
  { key: 'apiMode', label: '接口协议', options: ['anthropic-messages', 'openai-responses', 'openai-chat-completions'], hint: '必须与要使用的 Harness 兼容。' },
  { key: 'baseUrl', label: '模型服务 URL' },
  { key: 'apiKeyCredentialRef', label: 'Credential Ref', hidden: true },
]
const workerPoolColumns: readonly EditorColumn<PactFlowWorkerPoolSettings>[] = [
  { key: 'displayName', label: '名称' }, { key: 'clusterId', label: 'K3s 集群' },
  { key: 'templateIds', label: '允许调度的 Harness', kind: 'list', hint: '只有选中的 Harness 才能由这个调度组启动。' },
  { key: 'maxConcurrency', label: '同时运行的 Worker 上限', kind: 'number', hint: '每增加 1，最多可多启动 1 个 Worker Pod；超出的任务自动排队。' },
  { key: 'imagePullSecret', label: 'Harbor 镜像拉取密钥', hint: 'K3s 使用该 dockerconfigjson Secret 从私有 Harbor 拉取 Worker 镜像。' },
  { key: 'registryId', label: 'Registry', hidden: true }, { key: 'queuePolicy', label: '队列', hidden: true },
]

const newCluster = (rows: readonly PactFlowK3sClusterSettings[]): PactFlowK3sClusterSettings => ({
  id: nextId('cluster', rows), displayName: 'K3s 集群', namespace: 'pactflow', pollIntervalMs: 2_000,
})
const newRegistry = (rows: readonly PactFlowRegistrySettings[]): PactFlowRegistrySettings => ({
  id: nextId('harbor', rows), displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
  harnessRepository: 'pactflow-worker', tlsVerify: false,
  passwordCredentialRef: credentialRefFor('HARBOR', nextId('harbor', rows), 'PASSWORD'),
})
const newGitProvider = (rows: readonly PactFlowGitProviderSettings[]): PactFlowGitProviderSettings => ({
  id: nextId('gitea', rows), displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.example',
  tokenCredentialRef: credentialRefFor('GITEA', nextId('gitea', rows), 'PASSWORD'),
})
const newTemplate = (
  rows: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[],
  registryId: string,
): PactFlowHarnessProfileSettings => ({
  id: nextId('claude', rows), displayName: 'Claude Code', harness: 'claude', registryId,
  repository: '', artifactDigest: `sha256:${'0'.repeat(64)}`,
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
})
const newModel = (rows: readonly PactFlowModelConnectionSettings[]): PactFlowModelConnectionSettings => ({
  id: nextId('model', rows), displayName: '模型连接', apiMode: 'anthropic-messages',
  model: '', baseUrl: '', apiKeyCredentialRef: credentialRefFor('MODEL', nextId('model', rows), 'API_KEY'),
})
const newWorkerPool = (
  rows: readonly PactFlowWorkerPoolSettings[], clusterId: string, registryId: string, templateIds: readonly string[],
): PactFlowWorkerPoolSettings => ({
  id: nextId('default', rows), displayName: '默认执行资源池', clusterId, registryId,
  templateIds, maxConcurrency: 1, queuePolicy: 'fifo',
})

function nextId<T extends { readonly id: string }>(base: string, rows: readonly T[]): string {
  if (!rows.some(row => row.id === base)) return base
  let suffix = 2
  while (rows.some(row => row.id === `${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

function toggleSet(current: ReadonlySet<string>, value: string): ReadonlySet<string> {
  const next = new Set(current)
  if (next.has(value)) next.delete(value)
  else next.add(value)
  return next
}

function credentialRefFor(kind: string, id: string, purpose: string): string {
  const normalized = id.toUpperCase().replace(/[^A-Z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  return `PACTFLOW_${kind}_${normalized}_${purpose}`
}

function friendlyOption(value: string): string {
  return ({
    claude: 'Claude Code', codex: 'Codex', opencode: 'OpenCode', dsh: 'DeepSeek Harness',
    'anthropic-messages': 'Anthropic Messages',
    'openai-responses': 'OpenAI Responses',
    'openai-chat-completions': 'OpenAI Chat Completions',
    true: '开启', false: '关闭',
  } as Readonly<Record<string, string>>)[value] ?? value
}

function probeStageEntry(stage: PactFlowInfrastructureProbeResult['stages'][number]): InfrastructureTestLog['entries'][number] {
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
    start: stage.detail.includes('restart-applied')
      ? '读取 Host 当前已生效的保存配置'
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

function isHarnessProfile(
  template: PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings,
): template is PactFlowHarnessProfileSettings {
  return 'registryId' in template
}

function normalizeInfrastructure(value: PactFlowInfrastructureSettings): PactFlowInfrastructureSettings {
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

function resourceRows(
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

function replaceResource(
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

function removeResource(
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

interface EditorColumn<T extends object> {
  readonly key: keyof T
  readonly label: string
  readonly kind?: 'text' | 'number' | 'boolean' | 'list' | 'file'
  readonly options?: readonly string[]
  readonly hint?: string
  readonly hidden?: boolean
  readonly advanced?: boolean
}

function EditableResourceCards<T extends { readonly id: string }>({
  title, description, rows, columns, disabled, create, onChange, probeKind, probingId, onProbe,
  optionsFor, renderField, renderExtraFields,
  labelForOption,
  testLogFor,
  showLogFor, onToggleLog, onViewProbe,
  modeFor, summaryFor, canSave, savingId, onEdit, onSave, onCancel, onRequestDelete,
  onAdd,
  addDisabled,
}: {
  readonly title: string
  readonly description: string
  readonly rows: readonly T[]
  readonly columns: readonly EditorColumn<T>[]
  readonly disabled: boolean
  readonly create: () => T
  readonly onChange: (rows: readonly T[]) => void
  readonly probeKind?: PactFlowInfrastructureResourceKind
  readonly probingId?: string | null
  readonly onProbe?: (kind: PactFlowInfrastructureResourceKind, id: string) => void
  readonly optionsFor?: (row: T, column: EditorColumn<T>) => readonly string[] | undefined
  readonly labelForOption?: (row: T, column: EditorColumn<T>, value: string) => string
  readonly testLogFor?: (row: T) => InfrastructureTestLog | undefined
  readonly showLogFor?: (row: T) => boolean
  readonly onToggleLog?: (row: T) => void
  readonly onViewProbe?: (row: T) => void
  readonly modeFor?: (row: T) => 'view' | 'edit' | 'new'
  readonly summaryFor?: (row: T) => ReactNode
  readonly canSave?: (row: T) => boolean
  readonly savingId?: string | null
  readonly onEdit?: (row: T) => void
  readonly onSave?: (row: T) => void
  readonly onCancel?: (row: T) => void
  readonly onRequestDelete?: (row: T) => void
  readonly onAdd?: (row: T) => void
  readonly addDisabled?: boolean
  readonly renderField?: (
    row: T, index: number, column: EditorColumn<T>, update: (key: keyof T, value: string | boolean) => void,
  ) => ReactNode | undefined
  readonly renderExtraFields?: (
    row: T, index: number, update: (key: keyof T, value: string | boolean) => void,
  ) => ReactNode
}) {
  const update = (index: number, key: keyof T, raw: string | boolean): void => {
    const column = columns.find(candidate => candidate.key === key)
    let value: unknown = raw
    if (column?.kind === 'number') value = Number(raw)
    if (column?.kind === 'list') value = String(raw).split(',').map(item => item.trim()).filter(Boolean)
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }
  return (
    <section style={resourceSectionStyle}>
      <div style={resourceHeaderStyle}>
        <div style={resourceHeadingCopyStyle}>
          <h3 style={resourceTitleStyle}>{title}</h3>
          <p style={resourceDescriptionStyle}>{description}</p>
        </div>
        <button type="button" disabled={disabled || addDisabled === true} onClick={() => {
          const row = create()
          if (onAdd === undefined) onChange([...rows, row])
          else onAdd(row)
        }} style={buttonStyle}>
          + 新增
        </button>
      </div>
      {rows.length === 0 ? <p style={hintStyle}>尚未配置</p> : (
        <div style={resourceListStyle}>
          {rows.map((row, index) => (
            <article key={`${row.id}-${String(index)}`} style={resourceCardStyle}>
              <div style={resourceCardHeadingStyle}>
                <strong>{'displayName' in row && typeof row.displayName === 'string' && row.displayName !== ''
                  ? row.displayName
                  : `${title} ${String(index + 1)}`}</strong>
                {modeFor?.(row) === 'view' ? <HealthStatus
                  log={testLogFor?.(row)} onClick={() => onToggleLog?.(row)}
                /> : <span style={resourceIndexStyle}>{modeFor?.(row) === 'new' ? '未保存' : '编辑中'}</span>}
              </div>
              {modeFor?.(row) === 'view' ? <div style={resourceSummaryStyle}>{summaryFor?.(row)}</div> : <div style={resourceFieldsStyle}>
                {columns.filter(column => column.hidden !== true && column.advanced !== true).map((column) => {
                  const value = row[column.key] as unknown
                  const updateField = (key: keyof T, next: string | boolean): void => update(index, key, next)
                  const custom = renderField?.(row, index, column, updateField)
                  const options = optionsFor?.(row, column) ?? column.options
                  return <label key={String(column.key)} style={resourceFieldStyle}>
                    <span style={resourceFieldLabelStyle}>{column.label}</span>
                    {custom ?? (column.kind === 'boolean' ? (
                      <select
                        value={String(Boolean(value))}
                        disabled={disabled}
                        onChange={event => update(index, column.key, event.currentTarget.value === 'true')}
                        style={inputStyle}
                      ><option value="true">true</option><option value="false">false</option></select>
                    ) : options !== undefined ? (
                      <select
                        {...column.kind === 'list'
                          ? { multiple: true, value: Array.isArray(value) ? value.map(String) : [] }
                          : { value: String(value ?? '') }}
                        disabled={disabled}
                        onChange={event => update(
                          index,
                          column.key,
                          column.kind === 'list'
                            ? [...event.currentTarget.selectedOptions].map(option => option.value).join(',')
                            : event.currentTarget.value,
                        )}
                        style={inputStyle}
                      >{column.kind === 'list' ? null : <option value="">请选择</option>}{options.map(option => <option key={option} value={option}>{labelForOption?.(row, column, option) ?? friendlyOption(option)}</option>)}</select>
                    ) : (
                      <input
                        type={column.kind === 'number' ? 'number' : 'text'}
                        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                        disabled={disabled}
                        onChange={event => update(index, column.key, event.currentTarget.value)}
                        style={inputStyle}
                      />
                    ))}
                    {column.hint === undefined ? null : <span style={fieldHintStyle}>{column.hint}</span>}
                  </label>
                })}
                {renderExtraFields?.(row, index, (key, value) => update(index, key, value))}
              </div>}
              <div style={resourceCardActionsStyle}>
                  {modeFor?.(row) === 'view' ? <>
                    {probeKind !== undefined && onViewProbe !== undefined && <button
                      type="button" disabled={disabled || probingId !== null}
                      onClick={() => onViewProbe(row)} style={secondaryButtonStyle}
                    >{probingId === row.id ? '测试中…' : '可用性测试'}</button>}
                    <button type="button" onClick={() => onEdit?.(row)} style={secondaryButtonStyle}>编辑</button>
                    <button type="button" onClick={() => onRequestDelete?.(row)} style={dangerButtonStyle}>删除</button>
                  </> : <>
                  {probeKind !== undefined && onProbe !== undefined && <button
                    type="button" disabled={disabled || probingId !== null}
                    onClick={() => onProbe(probeKind, row.id)} style={buttonStyle}
                  >{probingId === row.id ? '测试中…' : '测试'}</button>}
                  <button type="button" disabled={disabled || canSave?.(row) !== true || savingId !== null}
                    onClick={() => onSave?.(row)} style={buttonStyle}
                  >{savingId === row.id ? '保存中…' : '保存'}</button>
                  <button type="button" disabled={disabled || savingId !== null}
                    onClick={() => onCancel?.(row)} style={secondaryButtonStyle}>取消</button>
                  </>}
              </div>
              {testLogFor?.(row) === undefined || (modeFor?.(row) === 'view' && showLogFor?.(row) !== true)
                ? null : <InfrastructureTestLogView log={testLogFor(row)!} />}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

function HealthStatus({ log, onClick }: { readonly log: InfrastructureTestLog | undefined; readonly onClick: () => void }) {
  const stale = log?.testedAt !== undefined && Date.now() - Date.parse(log.testedAt) > 300_000
  const state = log === undefined ? 'untested' : log.running ? 'running' : log.success === true ? 'succeeded' : 'failed'
  const label = state === 'untested' ? '未测试'
    : state === 'running' ? '测试中'
      : `${state === 'succeeded' ? '联通' : '失败'}${stale ? ' · 已过期' : ''}`
  return <button type="button" onClick={onClick} style={healthStatusButtonStyle} aria-label={`可用性状态：${label}`}>
    <span style={{ ...healthDotStyle, ...healthDotColors[state] }} />
    <span>{label}</span>
  </button>
}

function InfrastructureTestLogView({ log }: { readonly log: InfrastructureTestLog }) {
  return <section aria-label="测试日志" style={testLogStyle}>
    <div style={testLogHeaderStyle}>
      <strong>测试日志</strong>
      <span>{log.running ? '进行中' : log.success === true ? '成功' : '失败'}
        {log.durationMs === undefined ? '' : ` · ${(log.durationMs / 1_000).toFixed(1)}s`}</span>
    </div>
    <div style={testLogBodyStyle}>{log.entries.map((entry, index) => <div
      key={`${entry.name}-${String(index)}`}
      style={entry.state === 'failed' ? testLogFailedStyle : testLogLineStyle}
    >
      <span style={testLogStateStyle}>[{entry.state === 'running' ? '进行中' : entry.state === 'succeeded' ? '成功' : '失败'}]</span>
      <span>{entry.name}</span>
      <span style={testLogDetailStyle}>{entry.detail}</span>
    </div>)}</div>
  </section>
}

function DeleteResourceDialog({ state, busy, onCancel, onConfirm }: {
  readonly state: DeleteResourceDialogState
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const loading = state.impact === null && state.error === null
  const blocked = (state.impact?.blockers.length ?? 0) > 0
  return <div role="presentation" style={confirmBackdropStyle}>
    <section role="alertdialog" aria-modal="true" aria-label={`删除${state.name}`} style={confirmDialogStyle}>
      <h3 style={confirmTitleStyle}>删除「{state.name}」？</h3>
      {loading ? <p>正在检查项目和资源引用…</p> : null}
      {state.error === null ? null : <p style={errorTextStyle}>{state.error}</p>}
      {blocked ? <>
        <p>该资源仍被引用，不能删除：</p>
        <ul>{state.impact!.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
      </> : null}
      {!loading && !blocked && state.error === null ? <p>
        将删除资源配置，并清理 {String(state.impact?.credentialRefs.length ?? 0)} 个专用凭证。此操作不可撤销。
      </p> : null}
      <div style={confirmActionsStyle}>
        <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>取消</button>
        <button
          type="button" onClick={onConfirm}
          disabled={busy || loading || blocked || state.error !== null}
          style={dangerPrimaryButtonStyle}
        >{busy ? '删除中…' : '确认删除'}</button>
      </div>
    </section>
  </div>
}

function CredentialInput({ label, hint, value, disabled, onChange }: {
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return <label style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>{label}</span>
    <input
      type="password" autoComplete="off" value={value} disabled={disabled}
      placeholder="留空保持现有凭证"
      onChange={event => onChange(event.currentTarget.value)} style={inputStyle}
    />
    <span style={fieldHintStyle}>{hint}</span>
  </label>
}

function HarborArtifactField({ artifacts, value, onChange }: {
  readonly artifacts: readonly PactFlowHarborArtifactOption[]
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return <label style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>Worker 镜像</span>
    <select value={value} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}>
      <option value="">请先保存并测试 Harbor</option>
      {artifacts.map(artifact => <option
        key={`${artifact.repository}@${artifact.digest}`}
        value={`${artifact.repository}\u0000${artifact.digest}`}
      >{artifact.label}</option>)}
    </select>
    <span style={fieldHintStyle}>Harbor 返回的 digest 作为不可变运行镜像。</span>
  </label>
}

function ModelDiscoveryField({ models, value, busy, failure, manual, onLoad, onManual, onChange }: {
  readonly models: readonly PactFlowDiscoveredModel[]
  readonly value: string
  readonly busy: boolean
  readonly failure: string | undefined
  readonly manual: boolean
  readonly onLoad: () => void
  readonly onManual: () => void
  readonly onChange: (value: string) => void
}) {
  return <div style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>模型</span>
    <div style={filePickerStyle}>
      <button type="button" onClick={onLoad} disabled={busy} style={secondaryButtonStyle}>
        {busy ? '加载中…' : '加载模型列表'}
      </button>
      {failure === undefined || manual ? null : <button type="button" onClick={onManual} style={secondaryButtonStyle}>
        手动填写模型 ID
      </button>}
    </div>
    {models.length > 0 && !manual ? <select value={value} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}>
      <option value="">请选择模型</option>
      {value !== '' && !models.some(model => model.id === value)
        ? <option value={value}>{value}（当前配置，模型列表未返回）</option>
        : null}
      {models.map(model => <option key={model.id} value={model.id}>{
        model.name === undefined || model.name === model.id ? model.id : `${model.name} (${model.id})`
      }</option>)}
    </select> : manual ? <input
      aria-label="手动模型 ID" value={value} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}
    /> : <span style={fieldHintStyle}>填写 URL 和 API Key 后加载服务端模型列表。</span>}
    {failure === undefined ? null : <span style={errorTextStyle}>{failure}</span>}
    {manual ? <span style={fieldHintStyle}>模型列表未验证；保存前仍会发送真实消息测试。</span> : null}
  </div>
}

function HarnessSelectionField({ templates, models, value, onChange }: {
  readonly templates: readonly PactFlowHarnessProfileSettings[]
  readonly models: readonly PactFlowModelConnectionSettings[]
  readonly value: readonly string[]
  readonly onChange: (value: readonly string[]) => void
}) {
  return <div role="group" aria-label="允许调度的 Harness" style={choiceGridStyle}>
    {templates.map(template => {
      const selected = value.includes(template.id)
      const compatible = models.some(model => model.apiMode === HARNESS_PROTOCOL[template.harness])
      return <button
        key={template.id} type="button" aria-pressed={selected} disabled={!compatible}
        title={compatible ? undefined : `缺少 ${friendlyOption(HARNESS_PROTOCOL[template.harness])} 模型连接`}
        onClick={() => onChange(selected ? value.filter(id => id !== template.id) : [...value, template.id])}
        style={compatible ? selected ? selectedChoiceStyle : choiceStyle : disabledChoiceStyle}
      >{template.displayName}{compatible ? '' : '（缺少兼容模型）'}</button>
    })}
  </div>
}

/** Restart-applied structured editor for non-secret infrastructure resources. */
function PactFlowSettingsCard({
  settings, probeInfrastructure, pickHostFile, inspectKubeconfig,
  listImagePullSecrets, listHarborArtifacts, discoverModels, listInfrastructureHealth,
  setCredential, unsetCredential, deletionImpact, t,
}: SettingsCardProps) {
  const snapshot = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
  )
  const [persisted, setPersisted] = useState<PactFlowInfrastructureSettings>(EMPTY_INFRASTRUCTURE)
  const [draft, setDraft] = useState<PactFlowInfrastructureSettings>(EMPTY_INFRASTRUCTURE)
  const [advanced, setAdvanced] = useState(JSON.stringify(EMPTY_INFRASTRUCTURE, null, 2))
  const [notice, setNotice] = useState('')
  const { feedback, showFeedback, clearFeedback } = useActionFeedback()
  const [probingId, setProbingId] = useState<string | null>(null)
  const [testLogs, setTestLogs] = useState<Record<string, InfrastructureTestLog>>({})
  const [contextOptions, setContextOptions] = useState<Record<string, readonly string[]>>({})
  const [pullSecrets, setPullSecrets] = useState<Record<string, readonly string[]>>({})
  const [harborArtifacts, setHarborArtifacts] = useState<Record<string, readonly PactFlowHarborArtifactOption[]>>({})
  const [modelOptions, setModelOptions] = useState<Record<string, readonly PactFlowDiscoveredModel[]>>({})
  const [modelDiscovery, setModelDiscovery] = useState<Record<string, { readonly busy: boolean; readonly failure?: string; readonly manual: boolean }>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [activeEditor, setActiveEditor] = useState<ActiveResourceEditor | null>(null)
  const [testedFingerprints, setTestedFingerprints] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteResourceDialogState | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<ReadonlySet<string>>(new Set())
  const postSaveRef = useRef<{
    readonly persisted: PactFlowInfrastructureSettings
    readonly draft: PactFlowInfrastructureSettings
    readonly active: ActiveResourceEditor | null
  } | null>(null)

  useEffect(() => {
    if (snapshot.value === undefined) return
    const source = snapshot.value.infrastructure === false
      ? EMPTY_INFRASTRUCTURE
      : snapshot.value.infrastructure
    const value = normalizeInfrastructure(source)
    const postSave = postSaveRef.current
    if (postSave !== null && JSON.stringify(postSave.persisted) === JSON.stringify(value)) {
      postSaveRef.current = null
      setPersisted(postSave.persisted)
      setDraft(postSave.draft)
      setActiveEditor(postSave.active)
      setAdvanced(JSON.stringify(postSave.draft, null, 2))
      return
    }
    setPersisted(value)
    setDraft(value)
    setActiveEditor(null)
    setAdvanced(JSON.stringify(value, null, 2))
  }, [snapshot.value])

  useEffect(() => {
    void listInfrastructureHealth().then(records => {
      setTestLogs(current => {
        const next = { ...current }
        for (const record of records) next[`${record.kind}:${record.id}`] = {
          running: false, success: record.state === 'succeeded', durationMs: record.durationMs,
          testedAt: record.testedAt,
          entries: record.stages.map(probeStageEntry),
        }
        return next
      })
    }).catch(error => { setNotice(error instanceof Error ? error.message : String(error)) })
  }, [snapshot.value, listInfrastructureHealth])

  const change = <K extends keyof PactFlowInfrastructureSettings>(
    key: K, rows: PactFlowInfrastructureSettings[K],
  ): void => {
    const value = { ...draft, [key]: rows }
    setDraft(value)
    setAdvanced(JSON.stringify(value, null, 2))
  }
  const changeRows = (
    kind: PactFlowInfrastructureResourceKind,
    key: keyof PactFlowInfrastructureSettings,
    rows: PactFlowInfrastructureSettings[typeof key],
  ): void => {
    change(key, rows)
    if (activeEditor?.kind === kind) {
      const testKey = `${kind}:${activeEditor.id}`
      setTestedFingerprints(current => {
        const next = { ...current }
        delete next[testKey]
        return next
      })
    }
  }
  const disabled = !snapshot.writable
  const modeFor = (kind: PactFlowInfrastructureResourceKind, id: string): 'view' | 'edit' | 'new' => {
    return activeEditor?.kind === kind && activeEditor.id === id ? activeEditor.mode : 'view'
  }
  const refreshPoolPullSecrets = (pool: PactFlowWorkerPoolSettings): void => {
    const clusterDraft = {
      ...EMPTY_INFRASTRUCTURE,
      clusters: draft.clusters.filter(cluster => cluster.id === pool.clusterId),
    }
    void listImagePullSecrets(pool.clusterId, clusterDraft).then(
      values => {
        setPullSecrets(current => ({ ...current, [pool.clusterId]: values }))
        if (values.length !== 1 || pool.imagePullSecret !== undefined) return
        setDraft(current => {
          const currentPool = current.workerPools.find(item => item.id === pool.id)
          if (currentPool === undefined || currentPool.imagePullSecret !== undefined) return current
          const next = replaceResource(current, 'worker-pool', { ...currentPool, imagePullSecret: values[0]! })
          setAdvanced(JSON.stringify(next, null, 2))
          return next
        })
      },
      error => { setNotice(error instanceof Error ? error.message : String(error)) },
    )
  }
  const beginAdd = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (activeEditor !== null) return
    const value = replaceResource(persisted, kind, resource)
    setDraft(value)
    setAdvanced(JSON.stringify(value, null, 2))
    setActiveEditor({ kind, id: resource.id, mode: 'new' })
    if (kind === 'worker-pool') refreshPoolPullSecrets(resource as PactFlowWorkerPoolSettings)
  }
  const beginEdit = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (activeEditor !== null) return
    setDraft(persisted)
    setAdvanced(JSON.stringify(persisted, null, 2))
    setActiveEditor({ kind, id: resource.id, mode: 'edit' })
    if (kind === 'worker-pool') refreshPoolPullSecrets(resource as PactFlowWorkerPoolSettings)
  }
  const cancelEdit = (): void => {
    setDraft(persisted)
    setAdvanced(JSON.stringify(persisted, null, 2))
    setActiveEditor(null)
  }
  const resourceFingerprint = (kind: PactFlowInfrastructureResourceKind, id: string): string => {
    return JSON.stringify(resourceRows(draft, kind).find(row => row.id === id) ?? null)
  }
  const canSaveResource = (kind: PactFlowInfrastructureResourceKind, id: string): boolean => {
    return testedFingerprints[`${kind}:${id}`] === resourceFingerprint(kind, id)
  }
  const updateSecret = (ref: string, value: string): void => {
    setCredentialDrafts(current => ({ ...current, [ref]: value }))
    if (activeEditor !== null) {
      const key = `${activeEditor.kind}:${activeEditor.id}`
      setTestedFingerprints(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }
  const credentialRefsOf = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): readonly string[] => {
    if (kind === 'registry') {
      const registry = resource as PactFlowRegistrySettings
      return [registry.usernameCredentialRef, registry.passwordCredentialRef]
        .filter((ref): ref is string => ref !== undefined)
    }
    if (kind === 'git-provider') return [(resource as PactFlowGitProviderSettings).tokenCredentialRef]
    if (kind === 'model-connection') return [(resource as PactFlowModelConnectionSettings).apiKeyCredentialRef]
    return []
  }
  const saveResource = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (!canSaveResource(kind, resource.id) || savingId !== null) return
    const nextPersisted = replaceResource(persisted, kind, resource)
    let nextDraft = nextPersisted
    let nextActive: ActiveResourceEditor | null = null
    if (kind === 'model-connection' && nextPersisted.workerPools.length === 0
      && nextPersisted.clusters.length > 0 && nextPersisted.registries.length > 0
      && nextPersisted.templates.some(isHarnessProfile)) {
      const pool = newWorkerPool(
        [], nextPersisted.clusters[0]!.id, nextPersisted.registries[0]!.id,
        compatibleHarnessTemplateIds(
          nextPersisted.templates.filter(isHarnessProfile), nextPersisted.modelConnections ?? [],
        ),
      )
      nextDraft = replaceResource(nextPersisted, 'worker-pool', pool)
      nextActive = { kind: 'worker-pool', id: pool.id, mode: 'new' }
    }
    const refs = credentialRefsOf(kind, resource)
    const writes = refs.map(ref => [ref, credentialDrafts[ref] ?? ''] as const)
      .filter((entry): entry is [string, string] => entry[1].trim() !== '')
    setSavingId(resource.id)
    postSaveRef.current = { persisted: nextPersisted, draft: nextDraft, active: nextActive }
    void Promise.all(writes.map(([ref, secret]) => setCredential(ref, secret)))
      .then(() => snapshot.value?.k3s === false ? undefined : settings.set('k3s', false))
      .then(() => settings.set('infrastructure', nextPersisted))
      .then(() => {
        setPersisted(nextPersisted)
        setDraft(nextDraft)
        setAdvanced(JSON.stringify(nextDraft, null, 2))
        setActiveEditor(nextActive)
        setSavingId(null)
        setNotice('已保存，重启 Profile 后运行时生效')
        showFeedback('success', '保存成功，重启 Profile 后运行时生效')
        setCredentialDrafts(current => {
          const next = { ...current }
          for (const ref of refs) delete next[ref]
          return next
        })
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error)
        postSaveRef.current = null
        setSavingId(null)
        setNotice(detail)
        showFeedback('error', `保存失败：${detail}`)
      })
  }
  const resourceName = (resource: InfrastructureResource): string => {
    return 'displayName' in resource && typeof resource.displayName === 'string'
      ? resource.displayName
      : resource.id
  }
  const requestDelete = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    setDeleteDialog({ kind, id: resource.id, name: resourceName(resource), impact: null, error: null })
    void deletionImpact(kind, resource.id, persisted).then(
      impact => setDeleteDialog(current => current?.kind === kind && current.id === resource.id
        ? { ...current, impact }
        : current),
      error => setDeleteDialog(current => current?.kind === kind && current.id === resource.id
        ? { ...current, error: error instanceof Error ? error.message : String(error) }
        : current),
    )
  }
  const confirmDelete = (): void => {
    const candidate = deleteDialog
    if (candidate === null || candidate.impact === null
      || candidate.impact.blockers.length > 0 || savingId !== null) return
    const nextPersisted = removeResource(persisted, candidate.kind, candidate.id)
    setSavingId(candidate.id)
    postSaveRef.current = { persisted: nextPersisted, draft: nextPersisted, active: null }
    void settings.set('infrastructure', nextPersisted)
      .then(async () => {
        const failures: string[] = []
        for (const ref of candidate.impact!.credentialRefs) {
          try { await unsetCredential(ref) } catch { failures.push(ref) }
        }
        setPersisted(nextPersisted)
        setDraft(nextPersisted)
        setAdvanced(JSON.stringify(nextPersisted, null, 2))
        setActiveEditor(null)
        setSavingId(null)
        setDeleteDialog(null)
        setNotice(failures.length === 0
          ? `已删除「${candidate.name}」`
          : `资源已删除，但凭证清理失败：${failures.join(', ')}`)
      })
      .catch((error) => {
        postSaveRef.current = null
        setSavingId(null)
        setDeleteDialog(current => current === null
          ? null
          : { ...current, error: error instanceof Error ? error.message : String(error) })
      })
  }
  const pickKubeconfig = (index: number): void => {
    void pickHostFile().then(async (path) => {
      if (path === null) return
      const view = await inspectKubeconfig(path)
      const context = view.currentContext ?? view.contexts[0]
      const rows = draft.clusters.map((cluster, rowIndex) => rowIndex === index
        ? { ...cluster, kubeconfig: view.path, ...(context === undefined ? {} : { context }) }
        : cluster)
      changeRows('cluster', 'clusters', rows)
      setContextOptions(current => ({ ...current, [rows[index]!.id]: view.contexts }))
    }).catch(error => { setNotice(error instanceof Error ? error.message : String(error)) })
  }
  const loadModels = (model: PactFlowModelConnectionSettings): void => {
    setModelDiscovery(current => ({ ...current, [model.id]: { busy: true, manual: false } }))
    void discoverModels(model, credentialDrafts[model.apiKeyCredentialRef] ?? '').then(
      (models) => {
        if (models.length === 0) throw new Error('模型服务返回空列表')
        setModelOptions(current => ({ ...current, [model.id]: models }))
        setModelDiscovery(current => ({ ...current, [model.id]: { busy: false, manual: false } }))
      },
      (error) => setModelDiscovery(current => ({
        ...current,
        [model.id]: { busy: false, manual: false, failure: error instanceof Error ? error.message : String(error) },
      })),
    )
  }
  const draftForProbe = (
    kind: PactFlowInfrastructureResourceKind, id: string,
  ): PactFlowInfrastructureSettings => {
    if (kind === 'cluster') return { ...EMPTY_INFRASTRUCTURE, clusters: draft.clusters.filter(item => item.id === id) }
    if (kind === 'registry') return { ...EMPTY_INFRASTRUCTURE, registries: draft.registries.filter(item => item.id === id) }
    if (kind === 'git-provider') return { ...EMPTY_INFRASTRUCTURE, gitProviders: draft.gitProviders.filter(item => item.id === id) }
    if (kind === 'harness') return {
      ...EMPTY_INFRASTRUCTURE,
      registries: draft.registries,
      templates: draft.templates.filter(item => item.id === id),
      modelConnections: draft.modelConnections ?? [],
    }
    if (kind === 'model-connection') return {
      ...EMPTY_INFRASTRUCTURE,
      modelConnections: (draft.modelConnections ?? []).filter(item => item.id === id),
    }
    return draft
  }
  const credentialsForProbe = (
    kind: PactFlowInfrastructureResourceKind, id: string,
  ): readonly [string, string][] => {
    const refs: string[] = []
    if (kind === 'registry') {
      const ref = draft.registries.find(item => item.id === id)?.passwordCredentialRef
      if (ref !== undefined) refs.push(ref)
    }
    if (kind === 'git-provider') {
      const ref = draft.gitProviders.find(item => item.id === id)?.tokenCredentialRef
      if (ref !== undefined) refs.push(ref)
    }
    if (kind === 'model-connection') {
      const ref = draft.modelConnections?.find(item => item.id === id)?.apiKeyCredentialRef
      if (ref !== undefined) refs.push(ref)
    }
    return refs.map(ref => [ref, credentialDrafts[ref] ?? ''] as const)
      .filter((entry): entry is [string, string] => entry[1].trim() !== '')
  }
  const appendDiscoveryFailure = (key: string, name: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error)
    setTestLogs(current => ({
      ...current,
      [key]: {
        ...current[key]!, running: false, success: false,
        entries: [...current[key]!.entries, { state: 'failed', name, detail }],
      },
    }))
  }
  const probe = (kind: PactFlowInfrastructureResourceKind, id: string, saved = false): void => {
    const key = `${kind}:${id}`
    const startedAt = Date.now()
    setProbingId(id)
    setTestedFingerprints(current => {
      const next = { ...current }
      delete next[key]
      return next
    })
    setTestLogs(current => ({
      ...current,
      [key]: {
        running: true,
        entries: [{
          state: 'running', name: '准备测试',
          detail: saved ? '读取已保存资源及其当前依赖配置' : '读取当前卡片中未保存的表单值',
        }],
      },
    }))
    const credentialWrites = credentialsForProbe(kind, id)
    void Promise.all(credentialWrites.map(([ref, secret]) => setCredential(ref, secret)))
      .then(() => {
        if (credentialWrites.length === 0) return
        setTestLogs(current => ({
          ...current,
          [key]: {
            ...current[key]!,
            entries: [...current[key]!.entries, {
              state: 'succeeded', name: '凭证准备', detail: '新凭证已写入 DSH Credentials，日志不包含原值',
            }],
          },
        }))
      })
      .then(() => probeInfrastructure(kind, id, saved ? undefined : draftForProbe(kind, id))).then(
      result => {
        setProbingId(null)
        setTestLogs(current => ({
          ...current,
          [key]: {
            running: result.success && (kind === 'cluster' || kind === 'registry'),
            success: result.success, durationMs: Date.now() - startedAt,
            ...(saved ? { testedAt: new Date().toISOString() } : {}),
            entries: [
              ...(current[key]?.entries ?? []).map(entry => entry.state === 'running'
                ? { ...entry, state: 'succeeded' as const }
                : entry),
              ...result.stages.map(probeStageEntry),
            ],
          },
        }))
        if (!result.success) return
        if (saved && kind !== 'registry') {
          setExpandedLogs(current => new Set(current).add(key))
          return
        }
        if (kind !== 'cluster' && kind !== 'registry') {
          setTestedFingerprints(current => ({ ...current, [key]: resourceFingerprint(kind, id) }))
        }
        const discoveryDraft = draftForProbe(kind, id)
        if (kind === 'cluster') {
          void listImagePullSecrets(id, discoveryDraft).then(
            (values) => {
              setPullSecrets(current => ({ ...current, [id]: values }))
              setTestLogs(current => ({
                ...current,
                [key]: {
                  ...current[key]!, running: false,
                  entries: [...current[key]!.entries, {
                    state: 'succeeded', name: '读取镜像拉取凭证',
                    detail: `发现 ${String(values.length)} 个 dockerconfigjson Secret`,
                  }],
                },
              }))
              setTestedFingerprints(current => ({ ...current, [key]: resourceFingerprint(kind, id) }))
            },
            error => appendDiscoveryFailure(key, '读取镜像拉取凭证', error),
          )
        }
        if (kind === 'registry') {
          void listHarborArtifacts(id, discoveryDraft).then(
            (values) => {
              setHarborArtifacts(current => ({ ...current, [id]: values }))
              const registry = discoveryDraft.registries.find(item => item.id === id)
              const profiles = draft.templates.filter(isHarnessProfile)
              const synchronized = synchronizeHarnessTemplates(
                id, registry?.harnessRepository?.trim() || 'pactflow-worker', values, profiles,
              )
              const legacy = draft.templates.filter(template => !isHarnessProfile(template))
              const nextDraft = { ...draft, templates: [...legacy, ...synchronized.templates] }
              setDraft(nextDraft)
              setAdvanced(JSON.stringify(nextDraft, null, 2))
              setTestLogs(current => ({
                ...current,
                [key]: {
                  ...current[key]!, running: false, success: synchronized.missing.length === 0,
                  entries: [...current[key]!.entries, {
                    state: 'succeeded', name: '读取 Harness 镜像',
                    detail: `从 ${registry?.harnessRepository ?? 'pactflow-worker'} 发现 ${String(values.length)} 个制品，识别 ${String(synchronized.found.length)} 类 Harness`,
                  }, ...(synchronized.missing.length === 0 ? [] : [{
                    state: 'failed' as const, name: 'Harness 镜像完整性',
                    detail: `缺少 ${synchronized.missing.map(friendlyOption).join('、')}，已有模板未删除`,
                  }])],
                },
              }))
              if (synchronized.missing.length === 0) {
                if (saved) {
                  setSavingId(id)
                  postSaveRef.current = { persisted: nextDraft, draft: nextDraft, active: null }
                  void settings.set('infrastructure', nextDraft).then(
                    () => {
                      setPersisted(nextDraft)
                      setDraft(nextDraft)
                      setSavingId(null)
                      setExpandedLogs(current => new Set(current).add(key))
                      setNotice(`已从 ${registry?.harnessRepository ?? 'pactflow-worker'} 同步 ${String(synchronized.found.length)} 个 Harness 模板`)
                    },
                    error => {
                      postSaveRef.current = null
                      setSavingId(null)
                      appendDiscoveryFailure(key, '保存 Harness 模板', error)
                    },
                  )
                } else {
                  setTestedFingerprints(current => ({ ...current, [key]: resourceFingerprint(kind, id) }))
                }
              }
            },
            error => appendDiscoveryFailure(key, '读取 Harbor 制品', error),
          )
        }
      },
      error => {
        const detail = error instanceof Error ? error.message : String(error)
        setProbingId(null)
        setTestLogs(current => ({
          ...current,
          [key]: {
            running: false, success: false, durationMs: Date.now() - startedAt,
            entries: [
              ...(current[key]?.entries ?? []).map(entry => entry.state === 'running'
                ? { ...entry, state: 'succeeded' as const }
                : entry),
              { state: 'failed', name: '测试调用', detail },
            ],
          },
        }))
      },
    )
  }
  const summaryFor = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): ReactNode => {
    const values: readonly [string, string][] = kind === 'cluster'
      ? [['Namespace', (resource as PactFlowK3sClusterSettings).namespace], ['Context', (resource as PactFlowK3sClusterSettings).context ?? '默认']]
      : kind === 'registry'
        ? [['URL', (resource as PactFlowRegistrySettings).endpoint], ['Project', (resource as PactFlowRegistrySettings).project ?? '—'], ['Harness 仓库', (resource as PactFlowRegistrySettings).harnessRepository ?? 'pactflow-worker'], ['TLS', (resource as PactFlowRegistrySettings).tlsVerify ? '开启' : '关闭']]
        : kind === 'git-provider'
          ? [['URL', (resource as PactFlowGitProviderSettings).baseUrl], ['账号', (resource as PactFlowGitProviderSettings).username ?? '—']]
          : kind === 'harness'
            ? [['Harness', friendlyOption((resource as PactFlowHarnessProfileSettings).harness)], ['镜像', (resource as PactFlowHarnessProfileSettings).repository || '—'], ['资源', `${(resource as PactFlowHarnessProfileSettings).cpuLimit} CPU / ${(resource as PactFlowHarnessProfileSettings).memoryLimit}`]]
            : kind === 'model-connection'
              ? [['协议', friendlyOption((resource as PactFlowModelConnectionSettings).apiMode)], ['模型', (resource as PactFlowModelConnectionSettings).model], ['URL', (resource as PactFlowModelConnectionSettings).baseUrl]]
              : [['K3s 集群', (resource as PactFlowWorkerPoolSettings).clusterId], ['Harness', (resource as PactFlowWorkerPoolSettings).templateIds.join(', ')], ['并发', String((resource as PactFlowWorkerPoolSettings).maxConcurrency)], ['拉取凭证', (resource as PactFlowWorkerPoolSettings).imagePullSecret ?? '—']]
    return <dl style={summaryGridStyle}>{values.map(([label, value]) => <div key={label} style={summaryItemStyle}>
      <dt style={summaryLabelStyle}>{label}</dt><dd style={summaryValueStyle}>{value}</dd>
    </div>)}</dl>
  }
  return (
    <section style={settingsCardStyle}>
      <h2 style={sectionTitleStyle}>{t('settingsTitle')}</h2>
      <p>{t('settingsDescription')}</p>
      <p style={hintStyle}>{t('settingsRestart')}</p>
      <EditableResourceCards title="K3s 集群" description="连接集群并选择 Worker 运行的 Namespace。"
        rows={draft.clusters} disabled={disabled}
        columns={clusterColumns} create={() => newCluster(draft.clusters)} onChange={rows => changeRows('cluster', 'clusters', rows)}
        onAdd={row => beginAdd('cluster', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('cluster', row.id)} summaryFor={row => summaryFor('cluster', row)}
        canSave={row => canSaveResource('cluster', row.id)} savingId={savingId}
        onEdit={row => beginEdit('cluster', row)} onSave={row => saveResource('cluster', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('cluster', row)}
        optionsFor={(row, column) => column.key === 'context'
          ? contextOptions[row.id] ?? (row.context === undefined ? [] : [row.context])
          : undefined}
        renderField={(row, index, column) => column.kind === 'file' ? (
          <div style={filePickerStyle}>
            <input value={row.kubeconfig ?? ''} readOnly style={readOnlyInputStyle} />
            <button type="button" onClick={() => pickKubeconfig(index)} style={secondaryButtonStyle}>选择文件</button>
          </div>
        ) : undefined}
        probeKind="cluster" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`cluster:${row.id}`]}
        showLogFor={row => expandedLogs.has(`cluster:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `cluster:${row.id}`))}
        onViewProbe={row => probe('cluster', row.id, true)} />
      <EditableResourceCards title="Harbor 镜像仓库" description="配置镜像服务、项目、TLS 策略和拉取密钥引用。"
        rows={draft.registries} disabled={disabled}
        columns={registryColumns} create={() => newRegistry(draft.registries)} onChange={rows => changeRows('registry', 'registries', rows)}
        onAdd={row => beginAdd('registry', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('registry', row.id)} summaryFor={row => summaryFor('registry', row)}
        canSave={row => canSaveResource('registry', row.id)} savingId={savingId}
        onEdit={row => beginEdit('registry', row)} onSave={row => saveResource('registry', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('registry', row)}
        renderExtraFields={row => <CredentialInput
          label="密码 / Token" hint="留空保留已配置的凭证；新值仅写入 DSH Credentials。"
          value={credentialDrafts[row.passwordCredentialRef ?? ''] ?? ''}
          disabled={disabled || row.passwordCredentialRef === undefined}
          onChange={value => { if (row.passwordCredentialRef !== undefined) updateSecret(row.passwordCredentialRef, value) }}
        />}
        probeKind="registry" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`registry:${row.id}`]}
        showLogFor={row => expandedLogs.has(`registry:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `registry:${row.id}`))}
        onViewProbe={row => probe('registry', row.id, true)} />
      <EditableResourceCards title="Gitea Git Provider" description="根据项目本地 Git remote 自动匹配代码仓库。"
        rows={draft.gitProviders} disabled={disabled}
        columns={gitProviderColumns} create={() => newGitProvider(draft.gitProviders)} onChange={rows => changeRows('git-provider', 'gitProviders', rows)}
        onAdd={row => beginAdd('git-provider', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('git-provider', row.id)} summaryFor={row => summaryFor('git-provider', row)}
        canSave={row => canSaveResource('git-provider', row.id)} savingId={savingId}
        onEdit={row => beginEdit('git-provider', row)} onSave={row => saveResource('git-provider', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('git-provider', row)}
        renderExtraFields={row => <CredentialInput
          label="密码 / Token" hint="用于 Gitea API，原值不写入 Settings。"
          value={credentialDrafts[row.tokenCredentialRef] ?? ''} disabled={disabled}
          onChange={value => updateSecret(row.tokenCredentialRef, value)}
        />}
        probeKind="git-provider" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`git-provider:${row.id}`]}
        showLogFor={row => expandedLogs.has(`git-provider:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `git-provider:${row.id}`))}
        onViewProbe={row => probe('git-provider', row.id, true)} />
      <EditableResourceCards title="Harness 模板" description="只定义开发工具、Worker 镜像与 CPU/内存规格；不绑定模型。"
        rows={draft.templates.filter(isHarnessProfile)} disabled={disabled}
        columns={templateColumns}
        create={() => newTemplate(draft.templates, draft.registries[0]?.id ?? '')}
        onChange={rows => changeRows('harness', 'templates', rows)}
        onAdd={row => beginAdd('harness', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('harness', row.id)} summaryFor={row => summaryFor('harness', row)}
        canSave={row => canSaveResource('harness', row.id)} savingId={savingId}
        onEdit={row => beginEdit('harness', row)} onSave={row => saveResource('harness', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('harness', row)}
        optionsFor={(_row, column) => column.key === 'registryId' ? draft.registries.map(item => item.id) : undefined}
        labelForOption={(_row, column, value) => column.key === 'registryId'
          ? draft.registries.find(registry => registry.id === value)?.displayName ?? value
          : friendlyOption(value)}
        renderExtraFields={(row, _index, update) => <HarborArtifactField
          artifacts={harborArtifacts[row.registryId] ?? []}
          value={`${row.repository}\u0000${row.artifactDigest}`}
          onChange={(value) => {
            const [repository, artifactDigest] = value.split('\u0000')
            update('repository', repository ?? '')
            update('artifactDigest', artifactDigest ?? '')
          }}
        />}
        probeKind="harness" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`harness:${row.id}`]}
        showLogFor={row => expandedLogs.has(`harness:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `harness:${row.id}`))}
        onViewProbe={row => probe('harness', row.id, true)} />
      <EditableResourceCards title="模型连接" description="模型与 Harness 独立配置，运行任务时再选择兼容组合。"
        rows={draft.modelConnections ?? []} disabled={disabled}
        columns={modelColumns} create={() => newModel(draft.modelConnections ?? [])}
        onChange={rows => changeRows('model-connection', 'modelConnections', rows)}
        onAdd={row => beginAdd('model-connection', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('model-connection', row.id)} summaryFor={row => summaryFor('model-connection', row)}
        canSave={row => canSaveResource('model-connection', row.id)} savingId={savingId}
        onEdit={row => beginEdit('model-connection', row)} onSave={row => saveResource('model-connection', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('model-connection', row)}
        renderExtraFields={(row, _index, update) => <>
          <CredentialInput
            label="API Key" hint="原值只写入 DSH Credentials，不进入 Settings 或日志。"
            value={credentialDrafts[row.apiKeyCredentialRef] ?? ''} disabled={disabled}
            onChange={value => updateSecret(row.apiKeyCredentialRef, value)}
          />
          <ModelDiscoveryField
            models={modelOptions[row.id] ?? []} value={row.model}
            busy={modelDiscovery[row.id]?.busy === true}
            failure={modelDiscovery[row.id]?.failure}
            manual={modelDiscovery[row.id]?.manual === true}
            onLoad={() => loadModels(row)}
            onManual={() => setModelDiscovery(current => {
              const failure = current[row.id]?.failure
              return {
                ...current, [row.id]: {
                  busy: false, manual: true, ...(failure === undefined ? {} : { failure }),
                },
              }
            })}
            onChange={value => update('model', value)}
          />
        </>}
        probeKind="model-connection" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`model-connection:${row.id}`]}
        showLogFor={row => expandedLogs.has(`model-connection:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `model-connection:${row.id}`))}
        onViewProbe={row => probe('model-connection', row.id, true)} />
      <EditableResourceCards title="Worker 并发与调度" description="选择运行集群、允许使用的 Harness 和最多同时启动的 Worker Pod 数；超出的任务自动排队。"
        rows={draft.workerPools} disabled={disabled}
        columns={workerPoolColumns}
        create={() => newWorkerPool(
          draft.workerPools, draft.clusters[0]?.id ?? '', draft.registries[0]?.id ?? '',
          compatibleHarnessTemplateIds(draft.templates.filter(isHarnessProfile), draft.modelConnections ?? []),
        )}
        onChange={rows => changeRows('worker-pool', 'workerPools', rows)}
        onAdd={row => beginAdd('worker-pool', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('worker-pool', row.id)} summaryFor={row => summaryFor('worker-pool', row)}
        canSave={row => canSaveResource('worker-pool', row.id)} savingId={savingId}
        onEdit={row => beginEdit('worker-pool', row)} onSave={row => saveResource('worker-pool', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('worker-pool', row)}
        renderField={(row, _index, column, update) => {
          if (column.key === 'clusterId') return <select
            value={row.clusterId} style={inputStyle}
            onChange={event => {
              const clusterId = event.currentTarget.value
              update('clusterId', clusterId)
              const { imagePullSecret: _previousSecret, ...withoutSecret } = row
              refreshPoolPullSecrets({ ...withoutSecret, clusterId })
            }}
          ><option value="">请选择运行集群</option>{draft.clusters.map(cluster => <option
            key={cluster.id} value={cluster.id}
          >{cluster.displayName}</option>)}</select>
          if (column.key === 'templateIds') return <HarnessSelectionField
            templates={draft.templates.filter(isHarnessProfile)} models={draft.modelConnections ?? []} value={row.templateIds}
            onChange={value => update('templateIds', value.join(','))}
          />
          if (column.key === 'imagePullSecret') {
            const secrets = pullSecrets[row.clusterId] ?? []
            return <select value={row.imagePullSecret ?? ''} style={inputStyle}
              onChange={event => update('imagePullSecret', event.currentTarget.value)}
            ><option value="">{secrets.length === 0 ? '未发现 Harbor 拉取密钥' : '请选择 Harbor 拉取密钥'}</option>
              {secrets.map(secret => <option key={secret} value={secret}>{secret}</option>)}
            </select>
          }
          return undefined
        }}
        probeKind="worker-pool" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`worker-pool:${row.id}`]}
        showLogFor={row => expandedLogs.has(`worker-pool:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `worker-pool:${row.id}`))}
        onViewProbe={row => probe('worker-pool', row.id, true)} />
      <details><summary>高级 JSON（只读排障）</summary><textarea
        aria-label="PactFlow infrastructure JSON"
        value={advanced}
        readOnly
        rows={20}
        style={settingsEditorStyle}
      /></details>
      {notice === '' ? null : <p role="status" style={noticeStyle}>{notice}</p>}
      <ActionFeedbackToast feedback={feedback} onDone={clearFeedback} />
      {deleteDialog === null ? null : <DeleteResourceDialog
        state={deleteDialog}
        busy={savingId !== null}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />}
    </section>
  )
}

/** Services required before the native entry, overlay, locale, and Remote can activate. */
export const inject = [
  'remote', 'remote.credentials', 'remote.directoryPicker', 'sessions', 'slots', 'locale', 'settingsScope',
]

/** Mount the generated PactFlow Remote contribution and native DSH UI surfaces. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(pactflowRemote)
  const pactflow = ctx.get('remote.pactflow')
  if (pactflow === undefined) {
    await disposeRemote()
    throw new Error('PactFlow Remote contribution mounted without its namespace service')
  }
  const directoryPicker = ctx.remote.directoryPicker as typeof ctx.remote.directoryPicker & {
    pickFile(signal?: AbortSignal): Promise<RemoteResult<string | null>>
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pactflow: locale dictionaries')
  const settings = ctx.settingsScope.bind<PactFlowSettingsView>({
    namespace: NS,
    decode: (section) => {
      if (typeof section !== 'object' || section === null) return undefined
      const value = section as Partial<PactFlowSettingsView>
      return { k3s: value.k3s ?? false, infrastructure: value.infrastructure ?? false }
    },
  })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => ({
      settings,
      t: ctx.locale.bind(NS),
      probeInfrastructure: async (
        kind: PactFlowInfrastructureResourceKind,
        id: string,
        draft?: PactFlowInfrastructureSettings,
      ) => {
        const result = await pactflow.probeInfrastructure({ kind, id, ...(draft === undefined ? {} : { draft }) })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listInfrastructureHealth: async () => {
        const result = await pactflow.listInfrastructureHealth()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      pickHostFile: async () => {
        const result = await directoryPicker.pickFile()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      inspectKubeconfig: async (path: string) => {
        const result = await pactflow.inspectKubeconfig(path)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listImagePullSecrets: async (clusterId: string, draft: PactFlowInfrastructureSettings) => {
        const result = await pactflow.listImagePullSecrets(clusterId, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      listHarborArtifacts: async (registryId: string, draft: PactFlowInfrastructureSettings) => {
        const result = await pactflow.listHarborArtifacts(registryId, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      discoverModels: async (model: PactFlowModelConnectionSettings, apiKey: string) => {
        if (apiKey.trim() !== '') {
          const stored = await ctx.remote.credentials.set(model.apiKeyCredentialRef, apiKey)
          if (!stored.ok) throw new Error(stored.error.message)
        }
        const result = await pactflow.discoverModels(model)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      setCredential: async (ref: string, value: string) => {
        const result = await ctx.remote.credentials.set(ref, value)
        if (!result.ok) throw new Error(result.error.message)
      },
      unsetCredential: async (ref: string) => {
        const result = await ctx.remote.credentials.unset(ref)
        if (!result.ok) throw new Error(result.error.message)
      },
      deletionImpact: async (
        kind: PactFlowInfrastructureResourceKind, id: string, draft: PactFlowInfrastructureSettings,
      ) => {
        const result = await pactflow.infrastructureDeletionImpact(kind, id, draft)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowSettingsCard))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'pactflow',
    order: 30,
    locale: NS,
  }, PactFlowHeaderAction))
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action', id: 'pactflow-projects',
    inject: (): PactFlowProjectPanelFace => ({
      list: async () => {
        const result = await pactflow.listWorkspaceProjects()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      catalogs: async () => {
        const [clusters, pools, templates, models, providers] = await Promise.all([
          pactflow.listK3sClusters(),
          pactflow.listWorkerPools(), pactflow.listK3sTemplates(),
          pactflow.listModelConnections(), pactflow.listGiteaProviders(),
        ])
        for (const result of [clusters, pools, templates, models, providers]) {
          if (!result.ok) throw new Error(result.error.message)
        }
        return {
          clusters: clusters.value,
          pools: pools.value,
          templates: templates.value.filter(isHarnessProfile),
          models: models.value,
          giteaProviders: providers.value.map((provider: { readonly id: string; readonly displayName: string; readonly username?: string }) => ({
            id: provider.id, name: provider.displayName,
            ...(provider.username === undefined ? {} : { username: provider.username }),
          })),
        }
      },
      initializeGit: async (workspaceId, expectedPath) => {
        const result = await pactflow.initializeWorkspaceGit({
          workspaceId, expectedPath, confirm: 'initialize-local-git',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      adoptGit: async (workspaceId, expectedRevision) => {
        const result = await pactflow.adoptWorkspaceGit({ workspaceId, expectedRevision })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      gitSecrets: async clusterId => {
        const result = await pactflow.listK3sGitSecrets(clusterId)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      saveWorker: async (workspaceId, expectedRevision, k3sGitSecretName, worker) => {
        const result = await pactflow.saveWorkspaceWorkerPolicy({
          workspaceId, expectedRevision, k3sGitSecretName, worker,
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      createRemote: async request => {
        const result = await pactflow.createWorkspaceRemote({
          ...request, confirm: 'create-gitea-repository',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      migrate: async (workspaceId, sessionId, expectedRevision) => {
        const result = await pactflow.migrateWorkspaceProject({
          workspaceId, sessionId, expectedRevision, confirm: 'migrate-session-project',
        })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowProjectPanel))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pactflow',
    order: 30,
    locale: NS,
    inject: (): OverlayInjected => ({
      load: async (sessionId) => {
        const [health, snapshot, templates, workerPools, workspaceProject] = await Promise.all([
          pactflow.health(),
          pactflow.snapshot(sessionId),
          pactflow.listK3sTemplates(),
          pactflow.listWorkerPools(),
          pactflow.workspaceProjectForSession(sessionId),
        ])
        if (!health.ok) throw new Error(health.error.message)
        if (!snapshot.ok) throw new Error(snapshot.error.message)
        if (!templates.ok) throw new Error(templates.error.message)
        if (!workerPools.ok) throw new Error(workerPools.error.message)
        if (!workspaceProject.ok) throw new Error(workspaceProject.error.message)
        return {
          health: health.value, snapshot: snapshot.value,
          templates: templates.value, workerPools: workerPools.value,
          workspaceProject: workspaceProject.value,
        }
      },
      probeHarness: async (templateId, prompt, timeoutMs) => {
        const result = await pactflow.probeHarness({ templateId, prompt, timeoutMs })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      probeApi: async (templateId, prompt, timeoutMs) => {
        const result = await pactflow.probeApi({ templateId, prompt, timeoutMs })
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
      verifyGitea: async (sessionId) => {
        const result = await pactflow.verifyGitea(sessionId)
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowOverlay))
  return disposeRemote
}

function PactFlowProjectionTables({
  snapshot, templates, workerPools, probingTemplateId, giteaStatus, onApiProbe, onProbe, onVerifyGitea, t,
}: {
  readonly snapshot: PactFlowSnapshot
  readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
  readonly workerPools: readonly PactFlowWorkerPoolStatus[]
  readonly probingTemplateId: string | null
  readonly onProbe: (templateId: string) => void
  readonly onApiProbe: (templateId: string) => void
  readonly giteaStatus: PactFlowGiteaStatus | null
  readonly onVerifyGitea: () => void
  readonly t: (key: PactFlowLocaleKey) => string
}) {
  const needs = Object.values(snapshot.needs.byId)
  const nodes = Object.values(snapshot.dag.byId)
  const runs = Object.values(snapshot.runs.byId)
  return (
    <div style={gridStyle}>
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>{t('project')}</h2>
        <p>{snapshot.project.project?.name ?? t('empty')}</p>
        {snapshot.project.project?.git !== undefined && (
          <dl>
            <dt>{t('gitRemote')}</dt>
            <dd>{snapshot.project.project.git.remote} · {snapshot.project.project.git.remoteUrl}</dd>
            <dt>{t('gitBaseline')}</dt>
            <dd>{snapshot.project.project.git.defaultBranch}</dd>
            <dt>{t('validations')}</dt>
            <dd>{String(snapshot.project.project.git.validationCommands.length)}</dd>
            {snapshot.project.project.git.gitea !== undefined && (
              <>
                <dt>Gitea</dt>
                <dd>
                  {snapshot.project.project.git.gitea.owner}/{snapshot.project.project.git.gitea.repo}
                  {' '}
                  <button type="button" onClick={onVerifyGitea} style={buttonStyle}>{t('verifyGitea')}</button>
                </dd>
                {giteaStatus !== null && (
                  <>
                    <dt>{giteaStatus.fullName}</dt>
                    <dd>{giteaStatus.branchProtected ? t('giteaProtected') : t('giteaUnprotected')}</dd>
                  </>
                )}
              </>
            )}
          </dl>
        )}
      </section>
      <ProjectionTable title={t('needs')} rows={needs.map(need => [need.id, need.title, need.phase, `r${need.revision}`])} empty={t('empty')} />
      <ProjectionTable title={t('dag')} rows={nodes.map(node => [node.id, node.title, node.state, node.dependencies.join(', ') || '—'])} empty={t('empty')} />
      <ProjectionTable title={t('runs')} rows={runs.map(run => [
        run.id,
        run.provider,
        run.state,
        `${t('attempt')}: ${run.attempt}`,
        run.git === undefined ? '—' : `${t('gitBranch')}: ${run.git.branch}`,
        run.gitResult === undefined ? '—' : `${t('gitCommit')}: ${run.gitResult.commit.slice(0, 12)}`,
        run.gitResult === undefined ? '—' : `${t('validations')}: ${run.gitResult.validations.length}`,
      ])} empty={t('empty')} />
      <ProjectionTable title={t('workerPools')} rows={workerPools.map(pool => [
        pool.id,
        `${pool.running}/${pool.maxConcurrency}`,
        `${pool.waiting} waiting`,
        pool.queuePolicy,
        pool.clusterId,
      ])} empty={t('empty')} />
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>{t('k3sTemplates')}</h2>
        {templates.length === 0 ? <p>{t('empty')}</p> : (
          <table style={tableStyle}>
            <tbody>{templates.map(template => (
              <tr key={template.id}>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.displayName : template.id}</td>
                <td style={cellStyle}>{template.harness}</td>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.registryId : template.apiMode}</td>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.repository : template.model}</td>
                <td style={cellStyle}>
                  <div style={probeActionsStyle}>
                    <button
                      type="button"
                      disabled={probingTemplateId !== null}
                      onClick={() => onApiProbe(template.id)}
                      style={buttonStyle}
                    >
                      {probingTemplateId === template.id ? t('testing') : t('apiTest')}
                    </button>
                    <button
                      type="button"
                      disabled={probingTemplateId !== null}
                      onClick={() => onProbe(template.id)}
                      style={buttonStyle}
                    >
                      {probingTemplateId === template.id ? t('testing') : t('harnessTest')}
                    </button>
                  </div>
                </td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </section>
    </div>
  )
}

function ProjectionTable({ title, rows, empty }: {
  readonly title: string
  readonly rows: readonly (readonly string[])[]
  readonly empty: string
}) {
  return (
    <section style={cardStyle}>
      <h2 style={sectionTitleStyle}>{title}</h2>
      {rows.length === 0 ? <p>{empty}</p> : (
        <table style={tableStyle}>
          <tbody>{rows.map(row => (
            <tr key={row[0]}>{row.map((cell, index) => (
              <td key={`${row[0]}-${String(index)}`} style={cellStyle}>{cell}</td>
            ))}</tr>
          ))}</tbody>
        </table>
      )}
    </section>
  )
}

const buttonStyle: CSSProperties = {
  border: '1px solid transparent',
  borderRadius: 8,
  background: 'var(--dsw-alias-label-primary)',
  color: 'var(--dsw-alias-bg-layer-3)',
  cursor: 'pointer',
  padding: '6px 10px',
}

const backdropStyle: CSSProperties = {
  position: 'fixed',
  inset: 0,
  zIndex: 100,
  display: 'grid',
  placeItems: 'center',
  background: 'rgba(1, 12, 11, 0.72)',
  pointerEvents: 'auto',
}

const panelStyle: CSSProperties = {
  width: 'min(920px, calc(100vw - 48px))',
  minHeight: 420,
  maxHeight: 'calc(100vh - 48px)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden',
  border: '1px solid var(--border, #36504c)',
  borderRadius: 12,
  background: 'var(--surface, #071c1a)',
  color: 'var(--text, #f4e3c8)',
  boxShadow: '0 28px 80px rgba(0, 0, 0, 0.45)',
}

const headerStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '24px 28px',
  borderBottom: '1px solid var(--border, #263d39)',
  flex: '0 0 auto',
}

const titleStyle: CSSProperties = { margin: 0, fontSize: 28 }
const subtitleStyle: CSSProperties = { margin: '6px 0 0', opacity: 0.72 }
const bodyStyle: CSSProperties = { padding: 28, overflowY: 'auto' }
const preStyle: CSSProperties = { padding: 16, overflow: 'auto', background: '#03100f' }
const diagnosticStyle: CSSProperties = {
  border: '1px solid var(--border, #263d39)', borderRadius: 8, padding: 12, marginBottom: 16,
}
const errorStyle: CSSProperties = { ...preStyle, color: '#ff8b8b' }
const probeStyle: CSSProperties = { ...preStyle, maxHeight: 320, whiteSpace: 'pre-wrap' }
const settingsCardStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 20,
  display: 'grid', gap: 12, minWidth: 0, maxWidth: '100%', overflow: 'hidden', boxSizing: 'border-box',
}
const hintStyle: CSSProperties = { opacity: 0.72, margin: 0 }
const settingsEditorStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 280,
  border: '1px solid var(--border, #36504c)', borderRadius: 6,
  background: 'var(--surface, #03100f)', color: 'var(--text, #f4e3c8)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: 12,
}
const resourceSectionStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 16,
  background: 'var(--dsw-alias-bg-layer-3)',
  minWidth: 0, maxWidth: '100%', boxSizing: 'border-box', overflow: 'hidden',
}
const resourceHeaderStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16,
}
const resourceHeadingCopyStyle: CSSProperties = { display: 'grid', gap: 4, minWidth: 0 }
const resourceTitleStyle: CSSProperties = { margin: 0, fontSize: 16 }
const resourceDescriptionStyle: CSSProperties = {
  margin: 0, fontSize: 13, opacity: 0.62, lineHeight: 1.55, overflowWrap: 'anywhere',
}
const resourceListStyle: CSSProperties = { display: 'grid', gap: 12, minWidth: 0 }
const resourceCardStyle: CSSProperties = {
  display: 'grid', gap: 16, padding: 16, minWidth: 0,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const resourceCardHeadingStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
  minWidth: 0, overflowWrap: 'anywhere',
}
const resourceIndexStyle: CSSProperties = { opacity: 0.55, fontSize: 12, flex: '0 0 auto' }
const healthStatusButtonStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 7, border: 0, background: 'none',
  color: 'var(--dsw-alias-label-secondary)', padding: 0, cursor: 'pointer', fontSize: 12,
}
const healthDotStyle: CSSProperties = { width: 9, height: 9, borderRadius: '50%', flex: '0 0 auto' }
const healthDotColors: Record<'untested' | 'running' | 'succeeded' | 'failed', CSSProperties> = {
  untested: { background: '#8a8f98', boxShadow: '0 0 0 3px rgba(138,143,152,.14)' },
  running: { background: '#e9b949', boxShadow: '0 0 10px rgba(233,185,73,.9)' },
  succeeded: { background: '#35c878', boxShadow: '0 0 10px rgba(53,200,120,.9)' },
  failed: { background: '#ef5f67', boxShadow: '0 0 10px rgba(239,95,103,.9)' },
}
const resourceFieldsStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))',
  gap: '16px 18px', minWidth: 0,
}
const resourceFieldStyle: CSSProperties = { display: 'grid', gap: 6, minWidth: 0 }
const resourceFieldLabelStyle: CSSProperties = {
  fontSize: 13, fontWeight: 500, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
}
const fieldHintStyle: CSSProperties = {
  fontSize: 12, lineHeight: 1.5, color: 'var(--dsw-alias-label-tertiary)',
}
const resourceCardActionsStyle: CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', gap: 8,
}
const resourceSummaryStyle: CSSProperties = { minWidth: 0 }
const summaryGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))', gap: 12, margin: 0,
}
const summaryItemStyle: CSSProperties = { display: 'grid', gap: 3, minWidth: 0 }
const summaryLabelStyle: CSSProperties = { fontSize: 12, color: 'var(--dsw-alias-label-tertiary)' }
const summaryValueStyle: CSSProperties = {
  margin: 0, fontSize: 13, color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere',
}
const testLogStyle: CSSProperties = {
  borderTop: '1px solid var(--dsw-alias-border-l2)', paddingTop: 12, display: 'grid', gap: 8,
}
const testLogHeaderStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12,
  fontSize: 12, color: 'var(--dsw-alias-label-secondary)',
}
const testLogBodyStyle: CSSProperties = {
  maxHeight: 220, overflowY: 'auto', display: 'grid', gap: 6, padding: 10,
  borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 12,
}
const testLogLineStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: '64px minmax(90px, auto) 1fr', gap: 8,
  color: 'var(--dsw-alias-label-secondary)', overflowWrap: 'anywhere',
}
const testLogFailedStyle: CSSProperties = { ...testLogLineStyle, color: 'var(--dsw-alias-label-error)' }
const testLogStateStyle: CSSProperties = { whiteSpace: 'nowrap', fontWeight: 600 }
const testLogDetailStyle: CSSProperties = { color: 'inherit', opacity: 0.82 }
const inputStyle: CSSProperties = {
  minWidth: 0, width: '100%', minHeight: 34, boxSizing: 'border-box',
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
  background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
  font: 'inherit', fontSize: 13, padding: '6px 12px',
}
const readOnlyInputStyle: CSSProperties = {
  ...inputStyle, color: 'var(--dsw-alias-label-secondary)', flex: '1 1 260px',
}
const secondaryButtonStyle: CSSProperties = {
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'none',
  color: 'var(--dsw-alias-label-secondary)', padding: '6px 12px', cursor: 'pointer', whiteSpace: 'nowrap',
}
const filePickerStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
const choiceGridStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const choiceStyle: CSSProperties = {
  ...secondaryButtonStyle, color: 'var(--dsw-alias-label-secondary)', background: 'var(--dsw-alias-bg-layer-3)',
}
const selectedChoiceStyle: CSSProperties = {
  ...choiceStyle, color: 'var(--dsw-alias-label-primary)', borderColor: 'var(--dsw-alias-label-primary)',
  boxShadow: 'inset 0 0 0 1px var(--dsw-alias-label-primary)',
}
const disabledChoiceStyle: CSSProperties = {
  ...choiceStyle, opacity: 0.48, cursor: 'not-allowed', textDecoration: 'none',
}
const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle, color: 'var(--dsw-alias-label-error)', whiteSpace: 'nowrap',
}
const dangerPrimaryButtonStyle: CSSProperties = {
  ...buttonStyle, background: 'var(--dsw-alias-label-error)', color: 'var(--dsw-alias-bg-layer-3)',
}
const noticeStyle: CSSProperties = {
  margin: 0, padding: 10, borderRadius: 8, background: 'var(--dsw-alias-bg-module-platform)',
  color: 'var(--dsw-alias-label-secondary)', fontSize: 13,
}
const confirmBackdropStyle: CSSProperties = {
  position: 'fixed', inset: 0, zIndex: 500, display: 'grid', placeItems: 'center',
  background: 'rgba(0, 0, 0, 0.38)', padding: 24,
}
const confirmDialogStyle: CSSProperties = {
  width: 'min(460px, 100%)', display: 'grid', gap: 14, padding: 20,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-3)', color: 'var(--dsw-alias-label-primary)',
}
const confirmTitleStyle: CSSProperties = { margin: 0, fontSize: 17 }
const confirmActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const errorTextStyle: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-error)' }
const probeActionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const gridStyle: CSSProperties = { display: 'grid', gap: 16, marginTop: 20 }
const cardStyle: CSSProperties = { border: '1px solid #263d39', borderRadius: 8, padding: 16 }
const sectionTitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 16 }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const cellStyle: CSSProperties = { padding: '8px 10px', borderTop: '1px solid #263d39', textAlign: 'left' }
