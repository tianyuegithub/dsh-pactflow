import { useEffect, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import pactflowRemote from 'dsh-pactflow/remote'
import type { PactFlowHealth, PactFlowSnapshot } from '../types.ts'

import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-session/client'

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
}

const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  phase: 'idle',
  health: null,
  snapshot: null,
  error: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

interface OverlayInjected {
  load(sessionId: string): Promise<{ readonly health: PactFlowHealth; readonly snapshot: PactFlowSnapshot }>
}

type OverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OverlayInjected>

/** Header entry rendered only for sessions composed from the PactFlow preset. */
function PactFlowHeaderAction({ sessionId, useSessions, t }: HeaderActionProps) {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  if (preset !== 'pactflow') return null
  return (
    <button
      type="button"
      onClick={() => {
        overlay.set({ open: true, sessionId, phase: 'idle', health: null, snapshot: null, error: null })
      }}
      style={buttonStyle}
    >
      {t('open')}
    </button>
  )
}

/** Root-scoped native overlay; the current session id arrives through the header action. */
function PactFlowOverlay({ load, t }: OverlayProps) {
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
          {state.snapshot !== null && <PactFlowProjectionTables snapshot={state.snapshot} t={t} />}
          {state.error !== null && <pre style={errorStyle}>{state.error}</pre>}
        </div>
      </section>
    </div>
  )
}

/** Services required before the native entry, overlay, locale, and Remote can activate. */
export const inject = ['remote', 'sessions', 'slots', 'locale']

/** Mount the generated PactFlow Remote contribution and native DSH UI surfaces. */
export async function apply(ctx: ClientContext): Promise<() => Promise<void>> {
  const disposeRemote = await ctx.remote.$mount(pactflowRemote)
  const pactflow = ctx.get('remote.pactflow')
  if (pactflow === undefined) {
    await disposeRemote()
    throw new Error('PactFlow Remote contribution mounted without its namespace service')
  }
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'pactflow: locale dictionaries')
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
        const [health, snapshot] = await Promise.all([
          pactflow.health(),
          pactflow.snapshot(sessionId),
        ])
        if (!health.ok) throw new Error(health.error.message)
        if (!snapshot.ok) throw new Error(snapshot.error.message)
        return { health: health.value, snapshot: snapshot.value }
      },
    }),
  }, PactFlowOverlay))
  return disposeRemote
}

function PactFlowProjectionTables({
  snapshot, t,
}: {
  readonly snapshot: PactFlowSnapshot
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
      </section>
      <ProjectionTable title={t('needs')} rows={needs.map(need => [need.id, need.title, need.phase, `r${need.revision}`])} empty={t('empty')} />
      <ProjectionTable title={t('dag')} rows={nodes.map(node => [node.id, node.title, node.state, node.dependencies.join(', ') || '—'])} empty={t('empty')} />
      <ProjectionTable title={t('runs')} rows={runs.map(run => [run.id, run.provider, run.state, `attempt ${run.attempt}`])} empty={t('empty')} />
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
}

const titleStyle: CSSProperties = { margin: 0, fontSize: 28 }
const subtitleStyle: CSSProperties = { margin: '6px 0 0', opacity: 0.72 }
const bodyStyle: CSSProperties = { padding: 28 }
const preStyle: CSSProperties = { padding: 16, overflow: 'auto', background: '#03100f' }
const errorStyle: CSSProperties = { ...preStyle, color: '#ff8b8b' }
const gridStyle: CSSProperties = { display: 'grid', gap: 16, marginTop: 20 }
const cardStyle: CSSProperties = { border: '1px solid #263d39', borderRadius: 8, padding: 16 }
const sectionTitleStyle: CSSProperties = { margin: '0 0 12px', fontSize: 16 }
const tableStyle: CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const cellStyle: CSSProperties = { padding: '8px 10px', borderTop: '1px solid #263d39', textAlign: 'left' }
