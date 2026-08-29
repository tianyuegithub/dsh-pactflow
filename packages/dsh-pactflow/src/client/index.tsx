import { useEffect, useState, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import pactflowRemote from 'dsh-pactflow/remote'
import type {
  PactFlowHarnessProbeResult,
  PactFlowApiProbeResult,
  PactFlowHarnessTemplateView,
  PactFlowHealth,
  PactFlowSnapshot,
  PactFlowSettingsView,
  PactFlowGiteaStatus,
} from '../types.ts'

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings-plugins/client'

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
  apiMode: 'API 模式',
  harnessTest: 'Harness 测试',
  apiTest: 'API 测试',
  testing: '测试中…',
  settingsTitle: '零脉 K3s 模板',
  settingsDescription: '编辑非密钥集群与 Harness 模板。API key/token 只填写 Kubernetes Secret 名称。',
  settingsRestart: '保存后重启 Profile 生效。',
  settingsSave: '保存配置',
  settingsDisable: '禁用 K3s',
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
  apiMode: 'API mode',
  harnessTest: 'Harness test',
  apiTest: 'API test',
  testing: 'Testing…',
  settingsTitle: 'PactFlow K3s templates',
  settingsDescription: 'Edit non-secret cluster and Harness templates. Enter only Kubernetes Secret names for API credentials.',
  settingsRestart: 'Restart the Profile after saving.',
  settingsSave: 'Save configuration',
  settingsDisable: 'Disable K3s',
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
  readonly templates: readonly PactFlowHarnessTemplateView[]
  readonly probingTemplateId: string | null
  readonly probe: PactFlowHarnessProbeResult | PactFlowApiProbeResult | null
  readonly giteaStatus: PactFlowGiteaStatus | null
}

const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  phase: 'idle',
  health: null,
  snapshot: null,
  error: null,
  templates: [],
  probingTemplateId: null,
  probe: null,
  giteaStatus: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

interface OverlayInjected {
  load(sessionId: string): Promise<{
    readonly health: PactFlowHealth
    readonly snapshot: PactFlowSnapshot
    readonly templates: readonly PactFlowHarnessTemplateView[]
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
  & InjectFace<{ readonly settings: SettingsScope<PactFlowSettingsView> }>

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
          templates: [], probingTemplateId: null, probe: null,
          giteaStatus: null,
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
            <pre style={preStyle}>{JSON.stringify(state.health, null, 2)}</pre>
          )}
          {state.snapshot !== null && (
            <PactFlowProjectionTables
              snapshot={state.snapshot}
              templates={state.templates}
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

/** Restart-applied settings card for non-secret K3s and Harness template metadata. */
function PactFlowSettingsCard({ settings, t }: SettingsCardProps) {
  const snapshot = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
  )
  const [draft, setDraft] = useState('false')
  const [notice, setNotice] = useState('')

  useEffect(() => {
    if (snapshot.value !== undefined) setDraft(JSON.stringify(snapshot.value.k3s, null, 2))
  }, [snapshot.value])

  const save = (): void => {
    let value: unknown
    try {
      value = JSON.parse(draft) as unknown
      if (value !== false && (typeof value !== 'object' || value === null || Array.isArray(value))) throw new Error()
    } catch {
      setNotice(t('settingsInvalid'))
      return
    }
    setNotice('')
    void settings.set('k3s', value).then(() => { setNotice(t('settingsSaved')) })
  }

  const templates = snapshot.value?.k3s === false ? [] : snapshot.value?.k3s.templates ?? []
  return (
    <section style={settingsCardStyle}>
      <h2 style={sectionTitleStyle}>{t('settingsTitle')}</h2>
      <p>{t('settingsDescription')}</p>
      <p style={hintStyle}>{t('settingsRestart')}</p>
      {templates.length > 0 && (
        <table style={tableStyle}>
          <tbody>{templates.map(template => (
            <tr key={template.id}>
              <td style={cellStyle}>{template.id}</td>
              <td style={cellStyle}>{template.harness}</td>
              <td style={cellStyle}>{template.apiMode}</td>
              <td style={cellStyle}>{template.model}</td>
            </tr>
          ))}</tbody>
        </table>
      )}
      <textarea
        aria-label={t('settingsTitle')}
        value={draft}
        onChange={event => setDraft(event.currentTarget.value)}
        rows={20}
        disabled={!snapshot.writable}
        style={settingsEditorStyle}
      />
      <div style={settingsActionsStyle}>
        <button type="button" onClick={save} disabled={!snapshot.writable} style={buttonStyle}>
          {t('settingsSave')}
        </button>
        <button
          type="button"
          onClick={() => { setDraft('false'); void settings.set('k3s', false) }}
          disabled={!snapshot.writable}
          style={buttonStyle}
        >
          {t('settingsDisable')}
        </button>
        {notice !== '' && <span>{notice}</span>}
      </div>
    </section>
  )
}

/** Services required before the native entry, overlay, locale, and Remote can activate. */
export const inject = ['remote', 'sessions', 'slots', 'locale', 'settingsScope']

/** Mount the generated PactFlow Remote contribution and native DSH UI surfaces. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(pactflowRemote)
  const pactflow = ctx.get('remote.pactflow')
  if (pactflow === undefined) {
    await disposeRemote()
    throw new Error('PactFlow Remote contribution mounted without its namespace service')
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pactflow: locale dictionaries')
  const settings = ctx.settingsScope.bind<PactFlowSettingsView>({
    namespace: NS,
    decode: section => typeof section === 'object' && section !== null && 'k3s' in section
      ? section as PactFlowSettingsView
      : undefined,
  })
  ctx.slots.inject('settings.plugin.item', () => ctx.slots.register({
    name: 'settings.plugin.item',
    key: NS,
    locale: NS,
    inject: () => ({ settings }),
  }, PactFlowSettingsCard))
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'pactflow',
    order: 30,
    locale: NS,
  }, PactFlowHeaderAction))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({
    name: 'shell.overlay',
    id: 'pactflow',
    order: 30,
    locale: NS,
    inject: (): OverlayInjected => ({
      load: async (sessionId) => {
        const [health, snapshot, templates] = await Promise.all([
          pactflow.health(),
          pactflow.snapshot(sessionId),
          pactflow.listK3sTemplates(),
        ])
        if (!health.ok) throw new Error(health.error.message)
        if (!snapshot.ok) throw new Error(snapshot.error.message)
        if (!templates.ok) throw new Error(templates.error.message)
        return { health: health.value, snapshot: snapshot.value, templates: templates.value }
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
  snapshot, templates, probingTemplateId, giteaStatus, onApiProbe, onProbe, onVerifyGitea, t,
}: {
  readonly snapshot: PactFlowSnapshot
  readonly templates: readonly PactFlowHarnessTemplateView[]
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
      <section style={cardStyle}>
        <h2 style={sectionTitleStyle}>{t('k3sTemplates')}</h2>
        {templates.length === 0 ? <p>{t('empty')}</p> : (
          <table style={tableStyle}>
            <tbody>{templates.map(template => (
              <tr key={template.id}>
                <td style={cellStyle}>{template.id}</td>
                <td style={cellStyle}>{template.harness}</td>
                <td style={cellStyle}>{template.apiMode}</td>
                <td style={cellStyle}>{template.model}</td>
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
  border: '1px solid var(--border, #3a4a48)',
  borderRadius: 6,
  background: 'var(--surface, #102321)',
  color: 'var(--text, #f4e3c8)',
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
const errorStyle: CSSProperties = { ...preStyle, color: '#ff8b8b' }
const probeStyle: CSSProperties = { ...preStyle, maxHeight: 320, whiteSpace: 'pre-wrap' }
const settingsCardStyle: CSSProperties = {
  border: '1px solid var(--border, #263d39)', borderRadius: 10, padding: 20,
  display: 'grid', gap: 12,
}
const hintStyle: CSSProperties = { opacity: 0.72, margin: 0 }
const settingsEditorStyle: CSSProperties = {
  width: '100%', boxSizing: 'border-box', resize: 'vertical', minHeight: 280,
  border: '1px solid var(--border, #36504c)', borderRadius: 6,
  background: 'var(--surface, #03100f)', color: 'var(--text, #f4e3c8)',
  fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', padding: 12,
}
const settingsActionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10 }
const probeActionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8 }
const gridStyle: CSSProperties = { display: 'grid', gap: 16, marginTop: 20 }
const cardStyle: CSSProperties = { border: '1px solid #263d39', borderRadius: 8, padding: 16 }
const sectionTitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 16 }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const cellStyle: CSSProperties = { padding: '8px 10px', borderTop: '1px solid #263d39', textAlign: 'left' }
