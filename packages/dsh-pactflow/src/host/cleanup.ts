import type { Session } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle } from '@deepseek-ai/dsh-session'
import type { PACTFLOW_EVENT_TYPES } from '../domain.ts'
import type { PactFlowGitWorkspace, PactFlowGitAuthSecret } from '../git-workspace.ts'
import type { PactFlowK3sWorker, PactFlowRunCleanupRecorder } from '../k3s-worker.ts'
import type { PactFlowDeliveryProjection } from '../types.ts'
import type {
  PactFlowCleanupRecord,
  PactFlowGitBinding,
  PactFlowGitRunSpec,
  PactFlowK3sRunSpec,
  PactFlowNeed,
  PactFlowNode,
  PactFlowProject,
  PactFlowRun,
  PactFlowWorkspaceProjectConfig,
  RetryPactFlowCleanupRequest,
} from '../types.ts'

/**
 * Host surface required by the durable cleanup ledger seam. Members stay on the
 * service class; the host object routes calls back through instance methods so
 * instance-level overrides (tests) remain authoritative. Mutable host state is
 * exposed through a live getter rather than a snapshot.
 */
export interface CleanupHost {
  readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>
  /** Narrow ports instead of the whole Cordis Context (R12). */
  readonly logger: { warn(message: string, ...args: unknown[]): void }
  delivery(session: Session): PactFlowDeliveryProjection | undefined
  readonly git: PactFlowGitWorkspace
  readonly cleanupTimers: Map<string, ReturnType<typeof setTimeout>>
  readonly activeCleanups: Map<string, Promise<boolean>>
  readonly cleanupStopped: boolean
  boundedOutcome(value: unknown): string
  appendCleanupRecord(session: Session, record: PactFlowCleanupRecord): void
  scheduleCleanupRetry(session: Session, record: PactFlowCleanupRecord): void
  runCleanupRecord(session: Session, record: PactFlowCleanupRecord, action: () => Promise<void>): Promise<boolean>
  performCleanupRecord(session: Session, record: PactFlowCleanupRecord, action: () => Promise<void>): Promise<boolean>
  retryCleanup(sessionId: string, request: RetryPactFlowCleanupRequest): Promise<PactFlowCleanupRecord>
  cleanupAction(session: Session, record: PactFlowCleanupRecord): Promise<void>
  livePactFlowSession(sessionId: string): Session
  requireProject(session: Session): PactFlowProject
  workspaceProjectForSession(session: Session): Promise<PactFlowWorkspaceProjectConfig | undefined>
  workspaceGitBinding(config: PactFlowWorkspaceProjectConfig | undefined): PactFlowGitBinding | undefined
  need(session: Session, rawId: string): PactFlowNeed
  node(session: Session, rawId: string): PactFlowNode
  runState(session: Session): Readonly<Record<string, PactFlowRun>>
  workerForRun(spec: PactFlowK3sRunSpec): PactFlowK3sWorker
  /** Discharge the persisted Run cleanup responsibility once the resources are gone. */
  runCleanupRecorder(k3s: PactFlowK3sWorker): PactFlowRunCleanupRecorder
  resolveGitAuth(spec: PactFlowGitRunSpec): Promise<PactFlowGitAuthSecret | undefined>
}

export function appendCleanupRecord(host: CleanupHost, session: Session, record: PactFlowCleanupRecord): void {
  host.events.append(session, 'pactflow/cleanup-recorded', { v: 1, record })
  host.scheduleCleanupRetry(session, record)
}

export function scheduleCleanupRetry(host: CleanupHost, session: Session, record: PactFlowCleanupRecord): void {
  const key = JSON.stringify([session.id, record.id])
  const previous = host.cleanupTimers.get(key)
  if (previous !== undefined) clearTimeout(previous)
  host.cleanupTimers.delete(key)
  if (host.cleanupStopped || record.state !== 'failed' || record.nextRetryAt === undefined) return
  const timer = setTimeout(() => {
    host.cleanupTimers.delete(key)
    if (host.cleanupStopped) return
    void Promise.resolve().then(async () => {
      if (host.cleanupStopped) return
      const current = host.delivery(session)?.cleanups[record.id]
      if (current === undefined || current.state !== 'failed') return
      if (current.nextRetryAt !== undefined && current.nextRetryAt > Date.now()) {
        host.scheduleCleanupRetry(session, current)
        return
      }
      await host.retryCleanup(session.id, { cleanupId: record.id })
    }).catch(error => {
      host.logger.warn('PactFlow scheduled cleanup "%s" failed: %s', record.id, host.boundedOutcome(error))
    })
  }, Math.max(0, Math.min(2_147_483_647, record.nextRetryAt - Date.now())))
  timer.unref()
  host.cleanupTimers.set(key, timer)
}

export async function runCleanupRecord(
  host: CleanupHost,
  session: Session,
  record: PactFlowCleanupRecord,
  action: () => Promise<void>,
): Promise<boolean> {
  const key = JSON.stringify([session.id, record.id])
  const active = host.activeCleanups.get(key)
  if (active !== undefined) return await active
  // Install ownership before invoking the action, including reentrant callbacks.
  const operation = Promise.resolve().then(() => host.performCleanupRecord(session, record, action))
  host.activeCleanups.set(key, operation)
  try { return await operation } finally { host.activeCleanups.delete(key) }
}

export async function performCleanupRecord(
  host: CleanupHost,
  session: Session,
  record: PactFlowCleanupRecord,
  action: () => Promise<void>,
): Promise<boolean> {
  try {
    if (record.requiresRelease === true && !Object.values(host.delivery(session)?.releases ?? {})
      .some(release => release.needId === record.needId)) {
      throw new Error('PactFlow cleanup is waiting for a verified release record')
    }
    await action()
    const { error: previousError, nextRetryAt: previousRetryAt, ...identity } = record
    void previousError
    void previousRetryAt
    host.appendCleanupRecord(session, {
      ...identity, state: 'succeeded', attempt: record.attempt,
    })
    return true
  } catch (error) {
    const nextRetryAt = Date.now() + Math.min(3_600_000, 1_000 * (2 ** Math.min(record.attempt - 1, 10)))
    host.appendCleanupRecord(session, {
      ...record, state: 'failed', error: host.boundedOutcome(error), nextRetryAt,
    })
    host.logger.warn('PactFlow cleanup target "%s" failed: %s', record.target, host.boundedOutcome(error))
    return false
  }
}

export async function continueCleanupRecord(
  host: CleanupHost,
  session: Session,
  record: PactFlowCleanupRecord,
  action: () => Promise<void>,
): Promise<boolean> {
  if (record.state === 'succeeded') return true
  if (record.state === 'failed') {
    const retried = await host.retryCleanup(session.id, { cleanupId: record.id })
    return retried.state === 'succeeded'
  }
  return await host.runCleanupRecord(session, record, action)
}

export async function ensureK3sCleanup(
  host: CleanupHost,
  session: Session,
  run: PactFlowRun,
): Promise<void> {
  if (run.k3s === undefined) return
  const id = `cleanup-${run.id}-k3s`
  const current = host.delivery(session)?.cleanups[id]
  const pending = current ?? {
    id, runId: run.id, needId: host.node(session, run.nodeId).needId,
    target: `k3s:${run.k3s.jobName}`, state: 'pending' as const, attempt: 1,
  }
  if (current === undefined) host.appendCleanupRecord(session, pending)
  if (pending.state === 'failed') {
    await host.retryCleanup(session.id, { cleanupId: pending.id })
  } else if (pending.state !== 'succeeded') await host.runCleanupRecord(session, pending, async () => {
    const worker = host.workerForRun(run.k3s!)
    await worker.cleanupRun(run.k3s!, host.runCleanupRecorder(worker))
  })
}

/** Explicitly retry one persisted cleanup responsibility after a failed close. */
export async function retryCleanupImpl(
  host: CleanupHost,
  sessionId: string,
  request: RetryPactFlowCleanupRequest,
): Promise<PactFlowCleanupRecord> {
  const session = host.livePactFlowSession(sessionId)
  const current = host.delivery(session)?.cleanups[request.cleanupId]
  if (current === undefined) throw new Error(`PactFlow cleanup "${request.cleanupId}" does not exist`)
  if (current.state === 'succeeded') return current
  const active = host.activeCleanups.get(JSON.stringify([session.id, current.id]))
  if (active !== undefined) {
    await active
    return host.delivery(session)?.cleanups[current.id] ?? current
  }
  const attempt = current.attempt + 1
  const { error: previousError, nextRetryAt: previousRetryAt, ...identity } = current
  void previousError
  void previousRetryAt
  const pending: PactFlowCleanupRecord = {
    ...identity, state: 'pending', attempt,
  }
  host.appendCleanupRecord(session, pending)
  await host.runCleanupRecord(session, pending, () => host.cleanupAction(session, pending))
  return host.delivery(session)?.cleanups[pending.id] ?? pending
}

export async function cleanupAction(host: CleanupHost, session: Session, record: PactFlowCleanupRecord): Promise<void> {
  const project = host.requireProject(session)
  const workspaceProject = await host.workspaceProjectForSession(session)
  const binding = project.git ?? host.workspaceGitBinding(workspaceProject)
  if (record.target === 'k3s' || record.target.startsWith('k3s:')) {
    const run = record.runId === undefined ? undefined : host.runState(session)[record.runId]
    if (run?.k3s === undefined) return
    const worker = host.workerForRun(run.k3s)
    await worker.cleanupRun(run.k3s, host.runCleanupRecorder(worker))
    return
  }
  if (record.target === 'git' || record.target.startsWith('git:')) {
    if (binding === undefined) throw new Error('PactFlow cleanup cannot resolve the project Git binding')
    const run = record.runId === undefined ? undefined : host.runState(session)[record.runId]
    if (run?.git === undefined) return
    await host.git.cleanupTaskRun(session.header.cwd, binding, run.git, await host.resolveGitAuth(run.git), run.gitResult?.commit)
    return
  }
  if (record.target === 'closing' || record.target.startsWith('closing:')) {
    if (record.needId === undefined) throw new Error('PactFlow closing cleanup has no Need id')
    host.need(session, record.needId)
    if (record.closing === undefined || record.target !== `closing:${record.closing.branch}`) {
      throw new Error('PactFlow closing cleanup lacks an exact persisted target; explicit recovery is required')
    }
    await host.git.cleanupClosing(session.header.cwd, record.closing)
    return
  }
  throw new Error(`PactFlow cleanup target "${record.target}" is unknown`)
}

export async function reconcileCleanupsImpl(host: CleanupHost, session: Session): Promise<void> {
  const cleanups = Object.values(host.delivery(session)?.cleanups ?? {})
  for (const record of cleanups) {
    if (record.state === 'succeeded') continue
    // A retained failure scene is discoverable but must never be auto-deleted;
    // deleting it could destroy uncommitted work kept for diagnosis.
    if (record.retain === true) continue
    if (record.nextRetryAt !== undefined && record.nextRetryAt > Date.now()) {
      host.scheduleCleanupRetry(session, record)
      continue
    }
    const current = host.delivery(session)?.cleanups[record.id]
    if (current === undefined || current.state === 'succeeded') continue
    try { await host.retryCleanup(session.id, { cleanupId: current.id }) } catch (error) {
      host.logger.warn('PactFlow cleanup recovery failed for "%s": %s', current.id, host.boundedOutcome(error))
    }
  }
}
