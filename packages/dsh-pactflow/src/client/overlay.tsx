import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Button, Modal, IconCloseOutline16 } from '@deepseek-ai/dsh-client-ui-primitives'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PactFlowHealth, PactFlowSnapshot, PactFlowWorkerPoolStatus, PactFlowGiteaStatus, PactFlowWorkspaceProjectConfig, PactFlowRetentionSummary, PactFlowHandoverSummary, PactFlowAutopilotPreview, PactFlowAutopilotRecord, PactFlowStartAutopilotRequest } from '../types.ts'
import type { AnswerWorkerInteractionRequest, WorkerInteractionRecord } from '../worker-interaction-types.ts'
import { pactFlowDiscussionView } from '../discussion-view.ts'
import { NS } from './locale.ts'
import { createRequestGate } from './request-gate.ts'
import { createFreshnessTracker, PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS, type PactFlowFreshnessState } from './runtime-freshness.ts'
import { PactFlowAutopilotControls } from './autopilot-controls.tsx'
import { WorkerInteractions } from './worker-interactions.tsx'
import { WorkbenchEvidenceView } from './session-workbench-view.tsx'
import { phaseLabel } from './workbench-labels.ts'
import { WORKBENCH_CSS } from './workbench-styles.ts'
import { requestProjectPanel } from './project-panel.tsx'

interface OverlayState {
  readonly open: boolean
  readonly sessionId: SessionId | null
  /** Monotonically increases whenever this root-scoped overlay changes owner. */
  readonly generation: number
  readonly phase: 'idle' | 'loading' | 'ready' | 'failed'
  readonly health: PactFlowHealth | null
  readonly snapshot: PactFlowSnapshot | null
  readonly error: string | null
  readonly workerPools: readonly PactFlowWorkerPoolStatus[]
  readonly giteaStatus: PactFlowGiteaStatus | null
  readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
  /** A05: read-only retained failure-scene status (capacity and overdue). */
  readonly retention: PactFlowRetentionSummary | null
  /** A12-c: the read-only handover summary shown by the export entry (null until requested). */
  readonly handover: PactFlowHandoverSummary | null
}

export const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  generation: 0,
  phase: 'idle',
  health: null,
  snapshot: null,
  error: null,
  workerPools: [],
  giteaStatus: null,
  workspaceProject: null,
  retention: null,
  handover: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

export interface OverlayInjected {
  answerWorkerInteraction(sessionId: string, request: AnswerWorkerInteractionRequest): Promise<WorkerInteractionRecord>
  autopilotPreview(sessionId: string, needId: string): Promise<PactFlowAutopilotPreview>
  startAutopilot(sessionId: string, request: PactFlowStartAutopilotRequest): Promise<PactFlowAutopilotRecord>
  controlAutopilot(sessionId: string, needId: string, expectedRevision: number, action: 'pause' | 'resume' | 'stop'): Promise<PactFlowAutopilotRecord>
  load(sessionId: string, signal: AbortSignal): Promise<{
    readonly health: PactFlowHealth
    readonly snapshot: PactFlowSnapshot
    readonly workerPools: readonly PactFlowWorkerPoolStatus[]
    readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
    readonly retention: PactFlowRetentionSummary | null
  }>
  /** Refreshes only the runtime-bound fields that change outside the Session event log. */
  loadRuntime(sessionId: string, signal: AbortSignal): Promise<{
    readonly workerPools: readonly PactFlowWorkerPoolStatus[]
    readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
    readonly retention: PactFlowRetentionSummary | null
  }>
  verifyGitea(sessionId: string, signal: AbortSignal): Promise<PactFlowGiteaStatus>
  /** A12-c: read-only handover summary; never mutates state. */
  exportHandover(sessionId: string, signal: AbortSignal): Promise<PactFlowHandoverSummary>
  /** A11: explicit human resume for a paused node. */
  resumeNode(sessionId: string, nodeId: string, expectedRevision: number, signal: AbortSignal): Promise<unknown>
  artifactLog(sessionId: string, runId: string, signal?: AbortSignal): Promise<{ readonly uri: string; readonly summary: string; readonly bytes: number; readonly content: string }>
  addComment(sessionId: string, request: { readonly needId: string; readonly body: string }, signal?: AbortSignal): Promise<unknown>
  voidComment(sessionId: string, request: { readonly commentId: string }, signal?: AbortSignal): Promise<unknown>
  listComments(sessionId: string, request: { readonly needId: string; readonly limit?: number }, signal?: AbortSignal): Promise<{
    readonly total: number
    readonly comments: readonly { readonly id: string; readonly author: 'human' | 'agent'; readonly body: string; readonly createdAt: number; readonly voided: boolean }[]
  }>
}

type OverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OverlayInjected>

export function PactFlowHeaderAction({ sessionId, useSessions, t }: HeaderActionProps) {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  const pending = useSessions(state => Object.values(state.byId[sessionId]?.projectionValues?.pactflowDelivery?.workerInteractions ?? {}).filter(record => record.state === 'pending').length)
  if (preset !== 'pactflow') return null
  return (
    <Button variant="toolbar" size="sm"
      type="button"
      onClick={() => {
        overlay.set({
          open: true, sessionId, generation: overlay.getSnapshot().generation + 1,
          phase: 'idle', health: null, snapshot: null, error: null,
          workerPools: [],
          giteaStatus: null, workspaceProject: null, retention: null, handover: null,
        })
      }}
    >
      {t('open')}{pending > 0 && <span aria-label={`${pending} 项待人工处理`}> · 待确认 {pending}</span>}
    </Button>
  )
}

/** Root-scoped native overlay; the current session id arrives through the header action. */
export function PactFlowOverlay({ load, loadRuntime, verifyGitea, exportHandover, resumeNode, artifactLog, addComment, voidComment, listComments, answerWorkerInteraction, autopilotPreview, startAutopilot, controlAutopilot, useSessions, t }: OverlayProps) {
  const state = useSyncExternalStore(overlay.subscribe, overlay.getSnapshot)
  const sessionCwd = useSessions(sessions => state.sessionId === null ? undefined : sessions.byId[state.sessionId]?.cwd)
  const projections = useSessions(sessions => state.open && state.sessionId !== null
    ? sessions.byId[state.sessionId]?.projectionValues : undefined)
  const snapshot: PactFlowSnapshot | null = projections?.pactflowProject !== undefined
    && projections.pactflowNeeds !== undefined && projections.pactflowDag !== undefined
    && projections.pactflowRuns !== undefined && projections.pactflowDelivery !== undefined
    ? { project: projections.pactflowProject, needs: projections.pactflowNeeds, dag: projections.pactflowDag,
      runs: projections.pactflowRuns, delivery: projections.pactflowDelivery,
      // Discussion is additive: a host that has not yet written a comment has no
      // collaboration projection, and the panel must still render.
      discussion: pactFlowDiscussionView(projections.pactflowCollaboration) }
    : state.snapshot
  const activeRequests = useRef(new Set<AbortController>())
  // Capacity and workspace data live outside the Session event log, so they are
  // refreshed whenever the run/cleanup/need shape of the live projection moves.
  const runtimeSignatureRef = useRef<string | null>(null)
  // Only the most recent runtime refresh may apply: a slow earlier refresh must not
  // overwrite a newer one within the same session/generation.
  const runtimeGate = useRef(createRequestGate())
  // Runtime data lives outside the Session log, so its freshness is tracked apart
  // from the projection-driven snapshot.
  const freshness = useRef(createFreshnessTracker())
  const [freshnessState, setFreshnessState] = useState<PactFlowFreshnessState>({ stale: false, lastSuccessAt: null })

  const refreshRuntime = (): void => {
    const current = overlay.getSnapshot()
    if (!current.open || current.phase !== 'ready' || current.sessionId === null) return
    const { sessionId, generation } = current
    // Supersede any in-flight runtime refresh so its late response cannot win.
    runtimeGate.current.invalidate()
    const token = runtimeGate.current.next()
    void startRequest(signal => loadRuntime(sessionId, signal)).then(
      value => {
        if (!isCurrent(sessionId, generation) || !runtimeGate.current.isLatest(token)) return
        freshness.current.onSuccess()
        setFreshnessState(freshness.current.state())
        overlay.set({ ...overlay.getSnapshot(), ...value })
      },
      error => {
        if (!isCurrent(sessionId, generation) || (error instanceof DOMException && error.name === 'AbortError')) return
        // Keep the last known values but mark them stale; the next interval or
        // projection change retries instead of failing the open overlay.
        freshness.current.onFailure()
        setFreshnessState(freshness.current.state())
        runtimeSignatureRef.current = null
      },
    )
  }
  const runtimeSignature = projections === undefined ? null : JSON.stringify({
    runs: Object.values(projections.pactflowRuns?.byId ?? {}).map(run => run.state).sort(),
    cleanups: Object.values(projections.pactflowDelivery?.cleanups ?? {}).map(record => record.state).sort(),
    needs: Object.keys(projections.pactflowNeeds?.byId ?? {}).length,
  })

  const isCurrent = (sessionId: string, generation: number): boolean => {
    const current = overlay.getSnapshot()
    return current.open && current.sessionId === sessionId && current.generation === generation
  }

  const abortOutstanding = (): void => {
    for (const controller of activeRequests.current) controller.abort()
    activeRequests.current.clear()
  }

  const startRequest = <T,>(
    request: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> => {
    const controller = new AbortController()
    activeRequests.current.add(controller)
    return Promise.resolve().then(() => {
      controller.signal.throwIfAborted()
      return request(controller.signal)
    })
      .finally(() => { activeRequests.current.delete(controller) })
  }

  useEffect(() => {
    if (!state.open || state.phase !== 'idle') return
    if (state.sessionId === null) return
    const { sessionId, generation } = state
    overlay.set({ ...state, phase: 'loading', error: null })
    void startRequest(signal => load(sessionId, signal)).then(
      value => {
        if (!isCurrent(sessionId, generation)) return
        // The initial load already fetched fresh runtime data; record that so the
        // overlay does not briefly claim it has no confirmed data.
        freshness.current.onSuccess()
        setFreshnessState(freshness.current.state())
        overlay.set({ ...overlay.getSnapshot(), phase: 'ready', ...value })
      },
      error => {
        if (isCurrent(sessionId, generation) && !(error instanceof DOMException && error.name === 'AbortError')) {
          overlay.set({
            ...overlay.getSnapshot(),
            phase: 'failed',
            error: error instanceof Error ? error.message : String(error),
          })
        }
      },
    )
  }, [load, state.open, state.sessionId, state.generation])

  useEffect(() => () => {
    abortOutstanding()
    // The component stays mounted across open/close; a stale signature from
    // the previous owner must not suppress the next session's first refresh.
    runtimeSignatureRef.current = null
    runtimeGate.current.invalidate()
    // Freshness belongs to the previous owner; do not show its timestamp next.
    freshness.current = createFreshnessTracker()
    setFreshnessState(freshness.current.state())
  }, [state.sessionId, state.generation])

  useEffect(() => {
    if (!state.open || state.phase !== 'ready' || state.sessionId === null) return
    if (runtimeSignature === null) return
    // The initial load already fetched fresh runtime data; remember its shape
    // so only later projection movements trigger a refresh.
    if (runtimeSignatureRef.current === null) {
      runtimeSignatureRef.current = runtimeSignature
      return
    }
    if (runtimeSignature === runtimeSignatureRef.current) return
    runtimeSignatureRef.current = runtimeSignature
    refreshRuntime()
  }, [loadRuntime, runtimeSignature, state.open, state.phase, state.sessionId, state.generation])

  // Pure configuration changes do not move the projection, so requery on a
  // bounded interval while the overlay is open and ready.
  useEffect(() => {
    if (!state.open || state.phase !== 'ready' || state.sessionId === null) return
    const timer = setInterval(() => { refreshRuntime() }, PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS)
    return () => { clearInterval(timer) }
  }, [loadRuntime, state.open, state.phase, state.sessionId, state.generation])

  const [storedNeed, setStoredNeed] = useState<string | null>(null)
  const [tab, setTab] = useState<'progress' | 'runs' | 'delivery'>('progress')
  const [auxiliary, setAuxiliary] = useState<'autopilot' | 'handover' | 'retention' | 'diagnostics' | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const needs = Object.values(snapshot?.needs.byId ?? {})
  const interactions = Object.values(snapshot?.delivery.workerInteractions ?? {})
  const actionable = interactions.filter(record => record.state === 'pending' || record.state === 'answered')
  const selectedNeed = needs.find(need => need.id === storedNeed)
    ?? needs.find(need => actionable.some(record => record.needId === need.id)) ?? needs[0]
  const hasNeeds = needs.length > 0
  const currentInteractions = Object.fromEntries(actionable.filter(record => record.needId === selectedNeed?.id).map(record => [record.id, record]))
  const history = Object.fromEntries(interactions.filter(record => record.needId === selectedNeed?.id && !['pending', 'answered'].includes(record.state)).map(record => [record.id, record]))
  const elsewhere = actionable.filter(record => record.needId !== selectedNeed?.id && record.state === 'pending')

  const closePanel = (): void => {
    abortOutstanding()
    const current = overlay.getSnapshot()
    overlay.set({ ...current, open: false, generation: current.generation + 1 })
  }
  const openProject = (): void => { closePanel(); requestProjectPanel({ workspaceId: state.workspaceProject?.workspaceId, cwd: sessionCwd }) }

  useEffect(() => {
    setStoredNeed(null); setTab('progress'); setAuxiliary(null); setActionError(null); setBusy(null)
  }, [state.sessionId, state.generation])

  useLayoutEffect(() => {
    if (!state.open) return
    const dialog = frameRef.current?.closest<HTMLElement>('[role="dialog"]')
    if (!dialog) return
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const portalRoot = [...document.body.children].find(element => element.contains(dialog))
    const backgrounds = [...document.body.children].filter((element): element is HTMLElement => element instanceof HTMLElement && element !== portalRoot)
      .map(element => ({ element, inert: element.inert }))
    for (const item of backgrounds) item.element.inert = true
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],summary,[tabindex="0"]')]
      .filter(element => element.tabIndex >= 0 && element.getClientRects().length > 0 && !element.closest('[inert]'))
    const first = () => focusable()[0] ?? dialog
    first().focus()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); closePanel(); return }
      if (event.key !== 'Tab') return
      const targets = focusable(); const current = document.activeElement
      if (!targets.length) { event.preventDefault(); return }
      if (event.shiftKey && (current === targets[0] || !dialog.contains(current))) { event.preventDefault(); targets.at(-1)!.focus() }
      else if (!event.shiftKey && (current === targets.at(-1) || !dialog.contains(current))) { event.preventDefault(); targets[0]!.focus() }
    }
    const onFocus = (event: FocusEvent) => { if (event.target instanceof Node && !dialog.contains(event.target)) first().focus() }
    document.addEventListener('keydown', onKey, true); document.addEventListener('focusin', onFocus)
    return () => {
      document.removeEventListener('keydown', onKey, true); document.removeEventListener('focusin', onFocus)
      for (const item of backgrounds) item.element.inert = item.inert
      if (previous?.isConnected) previous.focus()
    }
  }, [state.open])

  const runAction = (id: string, operation: (signal: AbortSignal) => Promise<unknown>, accepted?: (value: unknown) => void): void => {
    if (!state.sessionId || busy) return
    const { sessionId, generation } = state
    setBusy(id); setActionError(null)
    void startRequest(operation).then(value => {
      if (isCurrent(sessionId, generation)) { accepted?.(value); refreshRuntime() }
    }, error => {
      if (isCurrent(sessionId, generation) && !(error instanceof DOMException && error.name === 'AbortError')) setActionError(error instanceof Error ? error.message : String(error))
    }).finally(() => { if (isCurrent(sessionId, generation)) setBusy(null) })
  }
  const chooseNeed = (id: string): void => { setStoredNeed(id); setAuxiliary(null); setActionError(null) }
  const currentPool = state.workerPools.find(pool => pool.id === state.workspaceProject?.worker?.workerPoolId)
  const repoBinding = JSON.stringify(snapshot?.project.project?.git ?? null)
  const repoBindingRef = useRef(repoBinding)
  repoBindingRef.current = repoBinding
  const [checkedRepoBinding, setCheckedRepoBinding] = useState<string | null>(null)
  useEffect(() => {
    if (selectedNeed && !needs.some(need => need.id === storedNeed)) setStoredNeed(selectedNeed.id)
  }, [selectedNeed?.id, storedNeed])
  useEffect(() => { frameRef.current?.querySelector('main')?.scrollTo(0, 0) }, [tab, auxiliary, selectedNeed?.id])
  const phaseReady = state.phase === 'ready'
  const auxiliaryTitle = { autopilot: '挂机设置', handover: '会话移交', retention: '保留现场', diagnostics: '运行诊断' }

  return <Modal open={state.open} onClose={closePanel} title={t('title')} headless
    className={`pf-workbench-panel${!hasNeeds ? ' pf-workbench-empty' : ''}`}>
    <style>{WORKBENCH_CSS}</style>
    <div className="pf-workbench-frame" ref={frameRef}>
      <header className="pf-workbench-header">
        <div><h2 className="pf-workbench-title">{t('title')}</h2>
          <div className="pf-workbench-caption">
            <span>{snapshot?.project.project?.name ?? '当前会话'}</span>
            {state.workspaceProject && <span>{state.workspaceProject.workspaceTitle}</span>}
          </div>
        </div>
        <Button size="sm" variant="toolbar" aria-label={t('close')} icon={<IconCloseOutline16 />} onClick={closePanel} />
      </header>
      {phaseReady && hasNeeds && <div className="pf-workbench-scope">
        <label className="pf-workbench-select">选择需求
          <select aria-label="选择需求" value={selectedNeed?.id ?? ''} onChange={event => chooseNeed(event.currentTarget.value)}>
            {needs.map(need => <option key={need.id} value={need.id}>{need.title} · {phaseLabel(need.phase)}</option>)}
          </select>
        </label>
        <nav className="pf-workbench-tabs" role="tablist" aria-label="需求视图">
          {([['progress', '进展'], ['runs', '执行记录'], ['delivery', '验收交付']] as const).map(([id, label]) =>
            <Button key={id} id={`pf-workbench-tab-${id}`} aria-controls={`pf-workbench-tabpanel-${id}`} role="tab" aria-selected={tab === id && auxiliary === null} tabIndex={tab === id ? 0 : -1} size="sm"
              onKeyDown={event => {
                const tabs = ['progress', 'runs', 'delivery'] as const
                const current = tabs.indexOf(id)
                const next = event.key === 'ArrowRight' ? (current + 1) % 3 : event.key === 'ArrowLeft' ? (current + 2) % 3 : event.key === 'Home' ? 0 : event.key === 'End' ? 2 : -1
                if (next < 0) return
                event.preventDefault(); setTab(tabs[next]!); setAuxiliary(null)
                event.currentTarget.parentElement?.querySelectorAll<HTMLElement>('[role=tab]')[next]?.focus()
              }}
              onClick={() => { setTab(id); setAuxiliary(null); setActionError(null) }}>{label}</Button>)}
        </nav>
      </div>}
      <main className="pf-workbench-main">
        {state.phase === 'loading' && <p role="status" className="pf-workbench-muted">正在读取当前会话…</p>}
        {state.phase === 'failed' && <div className="pf-workbench-section"><p role="alert" className="pf-workbench-error">{state.error}</p>
          <Button variant="outline" onClick={() => overlay.set({ ...overlay.getSnapshot(), phase: 'idle', error: null })}>重试加载</Button></div>}
        {actionError && <p role="alert" className="pf-workbench-error">{actionError}</p>}
        {phaseReady && freshnessState.stale && <p role="status" className="pf-workbench-muted">工作区信息可能已过期，请重新读取后再判断资源状态。</p>}
        {phaseReady && elsewhere.length > 0 && <div className="pf-workbench-status pf-workbench-actions">
          <span>其他需求有 {elsewhere.length} 项待处理</span><Button size="sm" onClick={() => chooseNeed(elsewhere[0]!.needId)}>前往处理</Button>
        </div>}
        {phaseReady && state.sessionId && <WorkerInteractions records={currentInteractions} sessionId={state.sessionId} showEmpty={false}
          answer={request => answerWorkerInteraction(String(state.sessionId), request)} />}
        {phaseReady && !hasNeeds && auxiliary === null && <section className="pf-workbench-blank">
          <h3>尚未开始执行需求</h3>
          <p>本次会话仍在对话或调研阶段。确认要实施的需求后，这里会展示任务进展、人工确认和交付证据。</p>
          {state.workspaceProject && <p>工作区配置已关联；这不代表当前会话已经立项。</p>}
          <div className="pf-workbench-actions"><Button variant="primary" onClick={closePanel}>返回对话</Button><Button variant="outline" onClick={openProject}>项目配置</Button></div>
        </section>}
        {phaseReady && auxiliary && <div className="pf-workbench-actions"><Button size="sm" onClick={() => setAuxiliary(null)}>返回{hasNeeds ? '需求' : '会话'}</Button><strong>{auxiliaryTitle[auxiliary]}</strong></div>}
        {phaseReady && auxiliary === 'autopilot' && selectedNeed && state.sessionId && <PactFlowAutopilotControls
          key={`${state.sessionId}:${selectedNeed.id}`} sessionId={state.sessionId} hideNeedSelector needs={[selectedNeed]}
          records={snapshot?.delivery.autopilots ?? {}} preview={needId => autopilotPreview(String(state.sessionId), needId)}
          start={request => startAutopilot(String(state.sessionId), request)}
          control={(needId, revision, action) => controlAutopilot(String(state.sessionId), needId, revision, action)} />}
        {phaseReady && auxiliary === null && selectedNeed && snapshot && <section role="tabpanel" id={`pf-workbench-tabpanel-${tab}`} aria-labelledby={`pf-workbench-tab-${tab}`} className="pf-workbench-section">
          {tab === 'progress' && <div className="pf-workbench-actions"><Button variant="outline" size="sm" onClick={() => setAuxiliary('autopilot')}>挂机设置</Button>
            <span className="pf-workbench-muted">{snapshot.delivery.autopilots?.[selectedNeed.id] ? `挂机：${({ running: '运行中', paused: '已暂停', blocked: '已阻塞', stopped: '已停止', completed: '已完成' })[snapshot.delivery.autopilots[selectedNeed.id]!.state]}` : '尚未开启挂机'}</span></div>}
          <WorkbenchEvidenceView snapshot={snapshot} needId={selectedNeed.id} tab={tab}
            onLoadArtifactLog={(runId, signal) => artifactLog(String(state.sessionId), runId, signal)}
            onAddComment={async body => { await addComment(String(state.sessionId), { needId: selectedNeed.id, body }) }}
            onVoidComment={async commentId => { await voidComment(String(state.sessionId), { commentId }) }}
            onLoadComments={signal => listComments(String(state.sessionId), { needId: selectedNeed.id, limit: 200 }, signal)}
            resumingNodeId={busy?.startsWith('resume:') ? busy.slice(7) : null}
            onResume={(nodeId, revision) => runAction(`resume:${nodeId}`, signal => resumeNode(String(state.sessionId), nodeId, revision, signal))} />
          {tab === 'progress' && currentPool && <p className="pf-workbench-muted">当前项目使用执行池 {currentPool.displayName}：运行 {currentPool.running} / 池并发上限 {currentPool.maxConcurrency}，排队 {currentPool.waiting}。项目限制仍独立生效。</p>}
          {tab === 'runs' && state.sessionId && <WorkerInteractions records={history} sessionId={state.sessionId} title="交互记录" showEmpty={false}
            answer={request => answerWorkerInteraction(String(state.sessionId), request)} />}
          {tab === 'delivery' && snapshot.project.project?.git?.gitea && <section className="pf-workbench-section">
            <h3>当前仓库的合并条件</h3><p className="pf-workbench-muted">{snapshot.project.project.git.gitea.owner}/{snapshot.project.project.git.gitea.repo}</p>
            <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { const binding = repoBinding; runAction('repository', signal => verifyGitea(String(state.sessionId), signal), value => { if (repoBindingRef.current !== binding) return; setCheckedRepoBinding(binding); overlay.set({ ...overlay.getSnapshot(), giteaStatus: value as PactFlowGiteaStatus }) }) }}>{t('verifyGitea')}</Button>
            {state.giteaStatus && checkedRepoBinding === repoBinding && <p>{state.giteaStatus.branchProtected ? t('giteaProtected') : t('giteaUnprotected')}（最近一次检查，不代表交付已完成）</p>}
          </section>}
        </section>}
        {phaseReady && auxiliary === 'handover' && <HandoverSection value={state.handover} busy={busy === 'handover'}
          onExport={() => runAction('handover', signal => exportHandover(String(state.sessionId), signal), value => overlay.set({ ...overlay.getSnapshot(), handover: value as PactFlowHandoverSummary }))} />}
        {phaseReady && auxiliary === 'retention' && <section className="pf-workbench-section" aria-label="保留现场">
          <h3>{t('retentionTitle')}</h3><p>{state.retention === null ? '现场信息暂不可用' : state.retention.total === 0 ? '没有需要保留的现场' : `${state.retention.total} 处现场`}</p>
          {state.retention && <><p className="pf-workbench-muted">已保留 {formatBytes(state.retention.retainedBytes)} / 上限 {formatBytes(state.retention.maxBytes)} · {state.retention.measured ? '已完成容量统计' : '部分容量尚未统计'} · {state.retention.overBudget ? '已超限' : '未超限'}</p>
            {state.retention.overdue.map(record => <p key={record.id}>{record.id} · {record.target}</p>)}</>}
        </section>}
        {phaseReady && auxiliary === 'diagnostics' && <section className="pf-workbench-section">
          <h3>工作区信息</h3><p>{state.workspaceProject ? `${state.workspaceProject.workspaceTitle} · 修订 ${state.workspaceProject.revision}` : '当前会话尚未关联工作区配置'}</p>
          <p className="pf-workbench-muted">最近读取：{freshnessState.lastSuccessAt === null ? '尚未读取' : new Date(freshnessState.lastSuccessAt).toLocaleTimeString()}。这不是模型或镜像可用性测试。</p>
          <p className="pf-workbench-muted">模型、镜像和全局资源池在 DSH「设置 → 插件」中管理。</p>
          <details><summary>插件技术信息</summary><pre className="pf-workbench-raw">{JSON.stringify(state.health, null, 2)}</pre></details>
        </section>}
      </main>
      {phaseReady && <footer className="pf-workbench-footer">
        <div className="pf-workbench-actions">
          {hasNeeds && <Button size="sm" variant="ghost" onClick={openProject}>项目配置</Button>}
          {hasNeeds && <Button size="sm" variant="ghost" onClick={() => setAuxiliary('handover')}>移交摘要</Button>}
          {(state.retention?.total ?? 0) > 0 && <Button size="sm" variant="ghost" onClick={() => setAuxiliary('retention')}>保留现场 · {state.retention!.total}</Button>}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAuxiliary('diagnostics')}>运行诊断</Button>
      </footer>}
    </div>
  </Modal>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} 字节`
  const units = ['KiB', 'MiB', 'GiB']; let amount = value / 1024; let index = 0
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++ }
  return `${Number(amount.toFixed(1))} ${units[index]}`
}

function HandoverSection({ value, busy, onExport }: { value: PactFlowHandoverSummary | null; busy: boolean; onExport(): void }) {
  const [feedback, setFeedback] = useState('')
  const readable = value === null ? '' : [value.project?.name ?? '未初始化的会话', `仓库：${value.gitRemote ?? '未绑定'}`, `分支：${value.defaultBranch ?? '未绑定'}`,
    ...value.needs.map(need => `${need.title}：${phaseLabel(need.phase)}`),
    ...value.artifacts.map(item => `${item.branch} · ${item.commit} · ${item.validationsExecuted ? `${item.validationsExecuted} 项验证` : '没有自动验证证据'}`),
    `待处理清理责任：${value.pendingCleanups.length}`].join('\n')
  const copy = async (text: string) => { try { if (!navigator.clipboard) throw new Error('当前环境不支持复制'); await navigator.clipboard.writeText(text); setFeedback('已复制') } catch { setFeedback('复制失败，请选择下面的文本手动复制') } }
  return <section className="pf-workbench-section">
    <div className="pf-workbench-actions"><Button variant="outline" disabled={busy} onClick={onExport}>{busy ? '正在生成…' : '生成移交摘要'}</Button>
      {value && <Button onClick={() => { void copy(readable) }}>复制摘要</Button>}</div>
    {!value && <p className="pf-workbench-muted">生成可读摘要，查看本会话的需求、提交与未完成责任。</p>}
    {value && <><div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{readable}</div>
      <details><summary>结构化数据</summary><Button size="sm" onClick={() => { void copy(JSON.stringify(value, null, 2)) }}>复制原始数据</Button>
        <pre className="pf-workbench-raw" data-handover="summary">{JSON.stringify(value, null, 2)}</pre></details></>}
    {feedback && <p role="status">{feedback}</p>}
  </section>
}
