import { useEffect, useSyncExternalStore } from 'react'
import type { CSSProperties } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import pactflowRemote from 'dsh-pactflow/remote'
import type { PactFlowHealth } from '../types.ts'

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

const zh: Record<PactFlowLocaleKey, string> = {
  open: '打开零脉',
  title: '零脉 · PactFlow',
  subtitle: 'DSH 原生项目工作流模式',
  close: '关闭',
  loading: '正在验证 Host 与 Typert Remote…',
  ready: '外部 Bundle、Preset Root 与事件生产者已就绪',
  failed: '连接验证失败',
}

const en: Record<PactFlowLocaleKey, string> = {
  open: 'Open PactFlow',
  title: 'PactFlow',
  subtitle: 'Native project workflow mode for DSH',
  close: 'Close',
  loading: 'Checking Host and Typert Remote…',
  ready: 'External Bundle, preset root, and event producer are ready',
  failed: 'Connection check failed',
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
  readonly error: string | null
}

const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  phase: 'idle',
  health: null,
  error: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

interface OverlayInjected {
  health(): Promise<PactFlowHealth>
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
        overlay.set({ open: true, sessionId, phase: 'idle', health: null, error: null })
      }}
      style={buttonStyle}
    >
      {t('open')}
    </button>
  )
}

/** Root-scoped native overlay; the current session id arrives through the header action. */
function PactFlowOverlay({ health, t }: OverlayProps) {
  const state = useSyncExternalStore(overlay.subscribe, overlay.getSnapshot)

  useEffect(() => {
    if (!state.open || state.phase !== 'idle') return
    overlay.set({ ...state, phase: 'loading', error: null })
    void health().then(
      value => { overlay.set({ ...overlay.getSnapshot(), phase: 'ready', health: value }) },
      error => {
        overlay.set({
          ...overlay.getSnapshot(),
          phase: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      },
    )
  }, [health, state])

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
      health: async () => {
        const result = await ctx.remote.pactflow.health()
        if (!result.ok) throw new Error(result.error.message)
        return result.value
      },
    }),
  }, PactFlowOverlay))
  return disposeRemote
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
