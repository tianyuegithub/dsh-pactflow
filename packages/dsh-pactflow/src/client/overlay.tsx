import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime, PropsLocale, InjectFace } from '@deepseek-ai/dsh-client-ui-slots'
import type { PactFlowHealth, PactFlowSnapshot, PactFlowHarnessTemplateView, PactFlowHarnessProfileSettings, PactFlowModelConnectionSettings, PactFlowWorkerPoolStatus, PactFlowHarnessProbeResult, PactFlowApiProbeResult, PactFlowInfrastructureProbeResult, PactFlowGiteaStatus, PactFlowWorkspaceProjectConfig } from '../types.ts'
import { harnessProbeAvailability } from '../harness-discovery.ts'
import { NS, type PactFlowLocaleKey } from './locale.ts'
import { isHarnessProfile } from './resource-model.ts'
import { createRequestGate } from './request-gate.ts'
import { createFreshnessTracker, PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS, type PactFlowFreshnessState } from './runtime-freshness.ts'
import { PactFlowDagGraph } from './dag-graph.tsx'
import { buttonStyle, backdropStyle, panelStyle, headerStyle, titleStyle, subtitleStyle, bodyStyle, preStyle, diagnosticStyle, errorStyle, probeStyle, hintStyle, probeActionsStyle, disabledProbeButtonStyle, probeReasonStyle, gridStyle, cardStyle, sectionTitleStyle, tableStyle, cellStyle } from './styles.ts'

interface OverlayState {
  readonly open: boolean
  readonly sessionId: SessionId | null
  /** Monotonically increases whenever this root-scoped overlay changes owner. */
  readonly generation: number
  readonly phase: 'idle' | 'loading' | 'ready' | 'failed'
  readonly health: PactFlowHealth | null
  readonly snapshot: PactFlowSnapshot | null
  readonly error: string | null
  readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
  readonly modelConnections: readonly PactFlowModelConnectionSettings[]
  readonly workerPools: readonly PactFlowWorkerPoolStatus[]
  readonly probingTemplateId: string | null
  readonly probe: PactFlowHarnessProbeResult | PactFlowApiProbeResult | PactFlowInfrastructureProbeResult | null
  readonly giteaStatus: PactFlowGiteaStatus | null
  readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
}

export const overlay = createSnapshotStore<OverlayState>({
  open: false,
  sessionId: null,
  generation: 0,
  phase: 'idle',
  health: null,
  snapshot: null,
  error: null,
  templates: [],
  modelConnections: [],
  workerPools: [],
  probingTemplateId: null,
  probe: null,
  giteaStatus: null,
  workspaceProject: null,
})

type HeaderActionProps =
  PropsRuntime<'conversation.session.header.actions'>
  & PropsLocale<typeof NS>

export interface OverlayInjected {
  load(sessionId: string, signal: AbortSignal): Promise<{
    readonly health: PactFlowHealth
    readonly snapshot: PactFlowSnapshot
    readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
    readonly modelConnections: readonly PactFlowModelConnectionSettings[]
    readonly workerPools: readonly PactFlowWorkerPoolStatus[]
    readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
  }>
  /** Refreshes only the runtime-bound fields that change outside the Session event log. */
  loadRuntime(sessionId: string, signal: AbortSignal): Promise<{
    readonly workerPools: readonly PactFlowWorkerPoolStatus[]
    readonly workspaceProject: PactFlowWorkspaceProjectConfig | null
  }>
  probeHarnessImage(templateId: string, signal: AbortSignal): Promise<PactFlowInfrastructureProbeResult>
  probeApi(
    templateId: string, modelConnectionId: string, prompt: string, timeoutMs: number, signal: AbortSignal,
  ): Promise<PactFlowApiProbeResult>
  verifyGitea(sessionId: string, signal: AbortSignal): Promise<PactFlowGiteaStatus>
}

type OverlayProps =
  PropsRuntime<'shell.overlay'>
  & PropsLocale<typeof NS>
  & InjectFace<OverlayInjected>

export function PactFlowHeaderAction({ sessionId, useSessions, t }: HeaderActionProps) {
  const preset = useSessions(state => state.byId[sessionId]?.projectionValues?.agentPreset)
  if (preset !== 'pactflow') return null
  return (
    <button
      type="button"
      onClick={() => {
        overlay.set({
          open: true, sessionId, generation: overlay.getSnapshot().generation + 1,
          phase: 'idle', health: null, snapshot: null, error: null,
          templates: [], modelConnections: [], workerPools: [], probingTemplateId: null, probe: null,
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
export function PactFlowOverlay({ load, loadRuntime, probeApi, probeHarnessImage, verifyGitea, useSessions, t }: OverlayProps) {
  const state = useSyncExternalStore(overlay.subscribe, overlay.getSnapshot)
  const projections = useSessions(sessions => state.open && state.sessionId !== null
    ? sessions.byId[state.sessionId]?.projectionValues : undefined)
  const snapshot: PactFlowSnapshot | null = projections?.pactflowProject !== undefined
    && projections.pactflowNeeds !== undefined && projections.pactflowDag !== undefined
    && projections.pactflowRuns !== undefined && projections.pactflowDelivery !== undefined
    ? { project: projections.pactflowProject, needs: projections.pactflowNeeds, dag: projections.pactflowDag,
      runs: projections.pactflowRuns, delivery: projections.pactflowDelivery }
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
            onClick={() => {
              abortOutstanding()
              const current = overlay.getSnapshot()
              overlay.set({ ...current, open: false, generation: current.generation + 1 })
            }}
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
            {/* Capacity and workspace config live outside the Session log; make their
                freshness explicit instead of showing possibly-stale values as fresh. */}
            <p style={hintStyle}>
              {freshnessState.lastSuccessAt === null
                ? '运行时数据尚未确认'
                : freshnessState.stale
                  ? `运行时数据可能已过期 · 最近确认 ${new Date(freshnessState.lastSuccessAt).toLocaleTimeString()}`
                  : `运行时数据已于 ${new Date(freshnessState.lastSuccessAt).toLocaleTimeString()} 确认`}
            </p>
          </section>
          {snapshot !== null && (
            <PactFlowProjectionTables
              snapshot={snapshot}
              templates={state.templates}
              modelConnections={state.modelConnections}
              workerPools={state.workerPools}
              probingTemplateId={state.probingTemplateId}
              onProbe={(templateId) => {
                if (state.sessionId === null) return
                const { sessionId, generation } = state
                overlay.set({ ...overlay.getSnapshot(), probingTemplateId: templateId, probe: null, error: null })
                void startRequest(signal => probeHarnessImage(templateId, signal)).then(
                  probe => {
                    if (isCurrent(sessionId, generation)) overlay.set({ ...overlay.getSnapshot(), probingTemplateId: null, probe, error: null })
                  },
                  error => {
                    if (!isCurrent(sessionId, generation) || (error instanceof DOMException && error.name === 'AbortError')) return
                    overlay.set({
                      ...overlay.getSnapshot(), probingTemplateId: null,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  },
                )
              }}
              onApiProbe={(templateId, modelConnectionId) => {
                if (state.sessionId === null) return
                const { sessionId, generation } = state
                overlay.set({ ...overlay.getSnapshot(), probingTemplateId: templateId, probe: null, error: null })
                void startRequest(signal => probeApi(templateId, modelConnectionId, 'say hi to me', 180_000, signal)).then(
                  probe => {
                    if (isCurrent(sessionId, generation)) overlay.set({ ...overlay.getSnapshot(), probingTemplateId: null, probe, error: null })
                  },
                  error => {
                    if (!isCurrent(sessionId, generation) || (error instanceof DOMException && error.name === 'AbortError')) return
                    overlay.set({
                      ...overlay.getSnapshot(), probingTemplateId: null,
                      error: error instanceof Error ? error.message : String(error),
                    })
                  },
                )
              }}
              giteaStatus={state.giteaStatus}
              onVerifyGitea={() => {
                if (state.sessionId === null) return
                const { sessionId, generation } = state
                void startRequest(signal => verifyGitea(sessionId, signal)).then(
                  giteaStatus => {
                    if (isCurrent(sessionId, generation)) overlay.set({ ...overlay.getSnapshot(), giteaStatus })
                  },
                  error => {
                    if (!isCurrent(sessionId, generation) || (error instanceof DOMException && error.name === 'AbortError')) return
                    overlay.set({
                      ...overlay.getSnapshot(), error: error instanceof Error ? error.message : String(error),
                    })
                  },
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

function PactFlowProjectionTables({
  snapshot, templates, modelConnections, workerPools, probingTemplateId,
  giteaStatus, onApiProbe, onProbe, onVerifyGitea, t,
}: {
  readonly snapshot: PactFlowSnapshot
  readonly templates: readonly (PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings)[]
  readonly modelConnections: readonly PactFlowModelConnectionSettings[]
  readonly workerPools: readonly PactFlowWorkerPoolStatus[]
  readonly probingTemplateId: string | null
  readonly onProbe: (templateId: string) => void
  readonly onApiProbe: (templateId: string, modelConnectionId: string) => void
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
      <PactFlowDagGraph nodes={nodes} empty={t('empty')} />
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
            <tbody>{templates.map(template => {
              const availability = harnessProbeAvailability(template, workerPools, modelConnections)
              return <tr key={template.id}>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.displayName : template.id}</td>
                <td style={cellStyle}>{template.harness}</td>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.registryId : template.apiMode}</td>
                <td style={cellStyle}>{isHarnessProfile(template) ? template.repository : template.model}</td>
                <td style={cellStyle}>
                  <div style={probeActionsStyle}>
                    <button
                      type="button"
                      disabled={probingTemplateId !== null || !availability.apiReady}
                      title={availability.reason}
                      onClick={() => {
                        if (availability.modelConnectionId !== undefined) {
                          onApiProbe(template.id, availability.modelConnectionId)
                        }
                      }}
                      style={availability.apiReady ? buttonStyle : disabledProbeButtonStyle}
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
                    {availability.reason === undefined ? null : (
                      <span style={probeReasonStyle}>{availability.reason}</span>
                    )}
                  </div>
                </td>
              </tr>
            })}</tbody>
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
