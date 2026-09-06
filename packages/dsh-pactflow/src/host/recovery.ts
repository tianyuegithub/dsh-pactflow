import type { Context } from '@deepseek-ai/cordis'
import type { Session } from '@deepseek-ai/dsh-session'
import type { ExternalSessionEventProducerHandle } from '@deepseek-ai/dsh-session'
import type { PACTFLOW_EVENT_TYPES } from '../domain.ts'
import type { PactFlowExecutionCapacity } from '../execution-capacity.ts'
import type { PactFlowGitWorkspace, PactFlowGitAuthSecret } from '../git-workspace.ts'
import type { PactFlowInfrastructure } from '../infrastructure.ts'
import { pactFlowK3sResultIdentityError, type PactFlowK3sWorker } from '../k3s-worker.ts'
import type {
  PactFlowClaimResult,
  PactFlowGitResult,
  PactFlowGitRunSpec,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowNode,
  PactFlowRun,
  PactFlowValidationProfile,
  PactFlowWorkspaceProjectConfig,
  RenewPactFlowRunRequest,
  SettlePactFlowRunRequest,
} from '../types.ts'

/**
 * Host surface required by the recovery supervision seam. Members stay on the
 * service class; the host object routes calls back through instance methods so
 * instance-level overrides (tests) remain authoritative. `recoveryStopped` is
 * exposed through a live getter rather than a snapshot.
 */
export interface RecoveryHost {
  readonly ctx: Context
  readonly events: ExternalSessionEventProducerHandle<typeof PACTFLOW_EVENT_TYPES>
  readonly git: PactFlowGitWorkspace
  readonly executionCapacity: PactFlowExecutionCapacity
  readonly infrastructure: PactFlowInfrastructure | undefined
  readonly k3s: PactFlowK3sWorker | undefined
  readonly reconcilingK3s: Set<string>
  readonly deferredK3s: Map<string, { timer: ReturnType<typeof setTimeout>; release: () => void; attempt: number }>
  readonly recoveryControllers: Map<string, AbortController>
  readonly inventoriedK3s: Map<string, () => void>
  readonly localExpiryTimers: Map<string, ReturnType<typeof setTimeout>>
  readonly recoveryStopped: boolean
  boundedOutcome(value: unknown): string
  currentPreset(session: Session): string | undefined
  reconcileLocalSession(session: Session): void
  reconcileLocalRun(session: Session, initial: PactFlowRun): void
  reconcileK3sSession(session: Session): Promise<void>
  inventoryK3sSession(session: Session): Promise<Promise<void>[]>
  reconcileK3sRun(session: Session, initial: PactFlowRun): Promise<void>
  reconcileCleanups(session: Session): Promise<void>
  runState(session: Session): Readonly<Record<string, PactFlowRun>>
  isTerminalRun(run: PactFlowRun): boolean
  clearLocalExpiryTimer(key: string): void
  expireRunInSession(
    session: Session,
    currentRun: PactFlowRun,
    outcome: string,
    nextNodeState?: 'failed' | 'ready',
  ): PactFlowClaimResult
  workspaceProjectForSession(session: Session): Promise<PactFlowWorkspaceProjectConfig | undefined>
  workerForRun(spec: PactFlowK3sRunSpec): PactFlowK3sWorker
  node(session: Session, rawId: string): PactFlowNode
  settleRunInSession(
    session: Session,
    request: SettlePactFlowRunRequest,
    gitResult?: PactFlowGitResult,
    k3sResult?: PactFlowK3sResult,
    resultAt?: number,
  ): PactFlowClaimResult
  ensureK3sCleanup(session: Session, run: PactFlowRun): Promise<void>
  retryK3sOperation<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T>
  renewRun(sessionId: string, request: RenewPactFlowRunRequest): PactFlowClaimResult
  deferK3sRecovery(session: Session, run: PactFlowRun, release: () => void, attempt: number): void
  backoff(delayMs: number, signal?: AbortSignal): Promise<void>
  isPermanentK3sError(error: unknown): boolean
  resolveGitAuth(spec: PactFlowGitRunSpec): Promise<PactFlowGitAuthSecret | undefined>
  assertValidationProfilesCurrent(
    session: Session,
    binding: Pick<PactFlowGitRunSpec, 'validationCommands' | 'validationProfileIds' | 'validationProfileRevisions' | 'legacyUntrusted'>,
  ): Promise<readonly PactFlowValidationProfile[]>
}

export async function reconcileSessionRunsImpl(host: RecoveryHost, session: Session): Promise<void> {
  if (host.currentPreset(session) !== 'pactflow') return
  host.reconcileLocalSession(session)
  await host.reconcileK3sSession(session)
  await host.reconcileCleanups(session)
}

/** Schedule or settle nonterminal local Runs whose in-memory Worker cannot survive a cold restart. */
export function reconcileLocalSessionImpl(host: RecoveryHost, session: Session): void {
  if (host.currentPreset(session) !== 'pactflow') return
  for (const run of Object.values(host.runState(session))) {
    if (host.isTerminalRun(run) || run.k3s !== undefined) continue
    host.reconcileLocalRun(session, run)
  }
}

export function reconcileLocalRunImpl(host: RecoveryHost, session: Session, initial: PactFlowRun): void {
  const key = `${session.id}:${initial.id}`
  const current = host.runState(session)[initial.id]
  if (current === undefined || host.isTerminalRun(current) || current.k3s !== undefined) {
    host.clearLocalExpiryTimer(key)
    return
  }
  const remainingMs = current.leaseDeadline - Date.now()
  if (remainingMs <= 0) {
    host.clearLocalExpiryTimer(key)
    host.expireRunInSession(
      session,
      current,
      'Local Worker lease expired after Host restart; prior outcome is unknown',
      'ready',
    )
    return
  }
  if (host.localExpiryTimers.has(key)) return
  const timer = setTimeout(() => {
    host.localExpiryTimers.delete(key)
    try {
      const live = host.ctx.sessions.get(session.id)
      if (live !== undefined) host.reconcileLocalRun(live, initial)
    } catch (error: unknown) {
      host.ctx.logger.warn('PactFlow local Run recovery failed for "%s": %s', initial.id, host.boundedOutcome(error))
    }
  }, remainingMs)
  host.localExpiryTimers.set(key, timer)
}

export function clearLocalExpiryTimerImpl(host: RecoveryHost, key: string): void {
  const timer = host.localExpiryTimers.get(key)
  if (timer !== undefined) clearTimeout(timer)
  host.localExpiryTimers.delete(key)
}

/** Reattach every nonterminal K3s Run when its PactFlow Agent becomes live. */
export async function reconcileK3sSessionImpl(host: RecoveryHost, session: Session): Promise<void> {
  await Promise.all(await host.inventoryK3sSession(session))
}

export async function inventoryK3sSessionImpl(host: RecoveryHost, session: Session): Promise<Promise<void>[]> {
  if (host.currentPreset(session) !== 'pactflow') return []
  const runs = Object.values(host.runState(session))
    .filter(run => !host.isTerminalRun(run) && run.k3s !== undefined && run.git !== undefined)
  if (runs.length === 0) {
    host.executionCapacity.setInventoryFailure(session.id, undefined)
    return []
  }
  const resumeAdmission = host.executionCapacity.pauseAdmission()
  const reserved: string[] = []
  let pending: Promise<void>[] = []
  try {
    if (host.k3s === undefined && host.infrastructure === undefined) throw new Error('PactFlow recovery Worker infrastructure is unavailable')
    const workspace = await host.workspaceProjectForSession(session)
    if (host.recoveryStopped) return []
    for (const run of runs) {
      const key = `${session.id}:${run.id}`
      if (host.reconcilingK3s.has(key) || host.deferredK3s.has(key) || host.inventoriedK3s.has(key)
        || host.isTerminalRun(host.runState(session)[run.id] ?? run)) continue
      const release = host.executionCapacity.reserveExisting({
        workspaceId: workspace?.worker === undefined ? undefined : workspace.workspaceId,
        policy: workspace?.worker, profileId: run.k3s?.agentProfileId, poolId: run.k3s?.workerPoolId,
        resolveInfrastructure: () => host.infrastructure,
      })
      host.inventoriedK3s.set(key, release)
      reserved.push(key)
    }
    pending = runs.map(run => host.reconcileK3sRun(session, run))
    host.executionCapacity.setInventoryFailure(session.id, undefined)
  } catch (error) {
    host.executionCapacity.setInventoryFailure(session.id, `PactFlow recovery inventory failed: ${host.boundedOutcome(error)}`)
    throw error
  } finally {
    // Transferred slots are owned by their Run; release only unconsumed entries.
    for (const key of reserved) {
      host.inventoriedK3s.get(key)?.()
      host.inventoriedK3s.delete(key)
    }
    resumeAdmission()
  }
  return pending
}

export async function reconcileK3sRunImpl(host: RecoveryHost, session: Session, initial: PactFlowRun): Promise<void> {
  if (host.recoveryStopped || host.isTerminalRun(initial) || initial.k3s === undefined || initial.git === undefined) return
  let worker: PactFlowK3sWorker
  try {
    worker = host.workerForRun(initial.k3s)
  } catch (error) {
    const currentNode = host.node(session, initial.nodeId)
    if (!host.isTerminalRun(initial)) {
      host.settleRunInSession(session, {
        runId: initial.id, claimId: initial.claimId, expectedNodeRevision: currentNode.revision,
        state: 'failed', outcome: host.boundedOutcome(error),
      })
    }
    return
  }
  const key = `${session.id}:${initial.id}`
  if (host.reconcilingK3s.has(key)) return
  host.reconcilingK3s.add(key)
  const deferred = host.deferredK3s.get(key)
  if (deferred !== undefined) { clearTimeout(deferred.timer); host.deferredK3s.delete(key) }
  let releaseCapacity: (() => void) | undefined = deferred?.release ?? host.inventoriedK3s.get(key)
  host.inventoriedK3s.delete(key)
  try {
    const workspaceProject = await host.workspaceProjectForSession(session)
    if (host.recoveryStopped) {
      releaseCapacity?.()
      host.reconcilingK3s.delete(key)
      return
    }
    releaseCapacity ??= host.executionCapacity.reserveExisting({
      workspaceId: workspaceProject?.worker === undefined ? undefined : workspaceProject.workspaceId,
      policy: workspaceProject?.worker,
      profileId: initial.k3s.agentProfileId,
      poolId: initial.k3s.workerPoolId,
      resolveInfrastructure: () => host.infrastructure,
    })
  } catch (error) {
    releaseCapacity?.()
    const current = host.runState(session)[initial.id]
    if (current !== undefined && !host.isTerminalRun(current)) {
      try {
        const currentNode = host.node(session, current.nodeId)
        const settled = host.settleRunInSession(session, {
          runId: current.id, claimId: current.claimId, expectedNodeRevision: currentNode.revision,
          state: 'failed', outcome: host.boundedOutcome(error),
        })
        await host.ensureK3sCleanup(session, settled.run)
      } catch (settleError) {
        host.ctx.logger.warn('PactFlow K3s capacity failure left Run unsettled "%s": %s', initial.id, host.boundedOutcome(settleError))
      }
    }
    host.reconcilingK3s.delete(key)
    host.ctx.logger.warn('PactFlow K3s capacity recovery failed for "%s": %s', initial.id, host.boundedOutcome(error))
    return
  }
  const controller = new AbortController()
  host.recoveryControllers.set(key, controller)
  let rescheduled = false
  let timer: ReturnType<typeof setInterval> | undefined
  let owned: PactFlowClaimResult | undefined
  try {
    owned = { run: initial, node: host.node(session, initial.nodeId) }
    const identityError = pactFlowK3sResultIdentityError(initial.k3s)
    if (identityError !== undefined) {
      const settled = host.settleRunInSession(session, {
        runId: initial.id, claimId: initial.claimId, expectedNodeRevision: owned.node.revision,
        state: 'failed', outcome: identityError,
      })
      await host.ensureK3sCleanup(session, settled.run)
      return
    }
    let observation = await host.retryK3sOperation(() => worker.observe(initial.k3s!), controller.signal)
    if (observation.state === 'missing') {
      const settled = Date.now() >= owned.run.leaseDeadline
        ? host.expireRunInSession(session, owned.run, 'K3s Job is missing after lease expiry')
        : host.settleRunInSession(session, {
          runId: owned.run.id,
          claimId: owned.run.claimId,
          expectedNodeRevision: owned.node.revision,
          state: 'failed',
          outcome: 'K3s Job is missing during recovery',
        })
      await host.ensureK3sCleanup(session, settled.run)
      return
    }
    if (observation.state === 'pending') {
      if (Date.now() >= owned.run.leaseDeadline) {
        await host.retryK3sOperation(() => worker.cancelRun(initial.k3s!), controller.signal)
        host.expireRunInSession(session, owned.run, 'K3s Job exceeded its persisted lease')
        return
      }
      const leaseDurationMs = owned.run.leaseDurationMs
        ?? Math.max(1_000, owned.run.leaseDeadline - Date.now())
      owned = host.renewRun(session.id, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        leaseDurationMs,
      })
      timer = setInterval(() => {
        try {
          const liveOwned = owned
          if (liveOwned === undefined) return
          owned = host.renewRun(session.id, {
            runId: liveOwned.run.id,
            claimId: liveOwned.run.claimId,
            leaseDurationMs,
          })
        } catch {
          controller.abort('PactFlow recovered K3s lease renewal failed')
        }
      }, Math.max(1_000, Math.floor(leaseDurationMs / 2)))
      try {
        const result = await host.retryK3sOperation(
          () => worker.waitExisting(initial.k3s!, controller.signal), controller.signal,
        )
        observation = { state: 'succeeded', result }
      } catch (error) {
        if (Date.now() >= owned.run.leaseDeadline) {
          host.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
        } else {
          const settled = host.settleRunInSession(session, {
            runId: owned.run.id,
            claimId: owned.run.claimId,
            expectedNodeRevision: owned.node.revision,
            state: controller.signal.aborted ? 'cancelled' : 'failed',
            outcome: host.boundedOutcome(error),
          })
          await host.ensureK3sCleanup(session, settled.run)
        }
        return
      }
    }
    if (observation.state === 'failed') {
      if (observation.finishedAt >= owned.run.leaseDeadline) {
        host.expireRunInSession(session, owned.run, 'K3s Job failed after lease expiry')
        return
      }
      const settled = host.settleRunInSession(session, {
        runId: owned.run.id,
        claimId: owned.run.claimId,
        expectedNodeRevision: owned.node.revision,
        state: 'failed',
        outcome: observation.outcome,
      }, undefined, undefined, observation.finishedAt)
      await host.ensureK3sCleanup(session, settled.run)
      return
    }
    if (observation.state !== 'succeeded') {
      throw new Error(`PactFlow K3s recovery remained ${observation.state}`)
    }
    const remoteResult = observation.result
    if (remoteResult.finishedAt >= owned.run.leaseDeadline) {
      host.expireRunInSession(session, owned.run, 'K3s Worker completed after lease expiry')
      return
    }
    if (remoteResult.branch !== initial.git.branch) throw new Error('recovered K3s Worker returned another branch')
    const gitResult = await host.retryK3sOperation(async () => host.git.acceptRemoteResult(
      session.header.cwd,
      initial.git!,
      remoteResult.commit,
      await host.resolveGitAuth(initial.git!),
      await host.assertValidationProfilesCurrent(session, initial.git!),
    ), controller.signal)
    host.settleRunInSession(session, {
      runId: owned.run.id,
      claimId: owned.run.claimId,
      expectedNodeRevision: owned.node.revision,
      state: 'succeeded',
      outcome: `Recovered K3s Worker ${remoteResult.podName} committed ${remoteResult.commit}`,
    }, gitResult, remoteResult, remoteResult.finishedAt)
  } catch (error) {
    if (host.recoveryStopped) return
    const current = host.runState(session)[initial.id]
    if (current !== undefined && !host.isTerminalRun(current)) {
      if (!controller.signal.aborted && !host.isPermanentK3sError(error)) {
        host.deferK3sRecovery(session, current, releaseCapacity!, (deferred?.attempt ?? 0) + 1)
        rescheduled = true
        host.ctx.logger.warn('PactFlow K3s Run "%s" recovery deferred after transient failure: %s', current.id, host.boundedOutcome(error))
        return
      }
      try {
        const currentNode = host.node(session, current.nodeId)
        if (Date.now() >= current.leaseDeadline) {
          const settled = host.expireRunInSession(session, current, host.boundedOutcome(error))
          await host.ensureK3sCleanup(session, settled.run)
        } else {
          const settled = host.settleRunInSession(session, {
            runId: current.id, claimId: current.claimId, expectedNodeRevision: currentNode.revision,
            state: controller.signal.aborted ? 'cancelled' : 'failed', outcome: host.boundedOutcome(error),
          })
          await host.ensureK3sCleanup(session, settled.run)
        }
      } catch (settleError) {
        host.ctx.logger.warn('PactFlow K3s Run "%s" could not be settled after recovery failure: %s', initial.id, host.boundedOutcome(settleError))
      }
    }
  } finally {
    if (timer !== undefined) clearInterval(timer)
    if (!rescheduled) releaseCapacity?.()
    host.recoveryControllers.delete(key)
    host.reconcilingK3s.delete(key)
  }
}

export function deferK3sRecoveryImpl(host: RecoveryHost, session: Session, run: PactFlowRun, release: () => void, attempt: number): void {
  const key = `${session.id}:${run.id}`
  const timer = setTimeout(() => {
    void Promise.resolve().then(async () => {
      if (host.deferredK3s.get(key)?.timer !== timer) return
      const current = host.runState(session)[run.id]
      if (host.recoveryStopped || current === undefined || host.isTerminalRun(current)) {
        host.deferredK3s.delete(key)
        release()
        return
      }
      await host.reconcileK3sRun(session, current)
      if (host.deferredK3s.get(key)?.timer === timer && host.isTerminalRun(host.runState(session)[run.id] ?? current)) {
        host.deferredK3s.delete(key)
        release()
      }
    }).catch(error => {
      host.ctx.logger.warn('PactFlow deferred recovery failed for "%s": %s', run.id, host.boundedOutcome(error))
    })
  }, Math.min(60_000, 1_000 * (2 ** Math.min(attempt - 1, 6))))
  timer.unref()
  host.deferredK3s.set(key, { timer, release, attempt })
}

export async function retryK3sOperationImpl<T>(
  host: RecoveryHost,
  operation: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (signal?.aborted) throw new Error('PactFlow K3s recovery was cancelled')
    try { return await operation() } catch (error) {
      lastError = error
      if (host.isPermanentK3sError(error) || attempt === 4) break
      await host.backoff(Math.min(15_000, 250 * (2 ** attempt)), signal)
    }
  }
  throw lastError instanceof Error ? lastError : new Error('PactFlow K3s operation failed')
}

export async function backoffImpl(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw new Error('PactFlow K3s recovery was cancelled')
  await new Promise<void>((resolveDelay, rejectDelay) => {
    let timer: ReturnType<typeof setTimeout>
    const abort = (): void => { clearTimeout(timer); rejectDelay(new Error('PactFlow K3s recovery was cancelled')) }
    timer = setTimeout(() => {
      signal?.removeEventListener('abort', abort)
      resolveDelay()
    }, delayMs)
    signal?.addEventListener('abort', abort, { once: true })
  })
}

export function isPermanentK3sErrorImpl(host: RecoveryHost, error: unknown): boolean {
  const message = host.boundedOutcome(error).toLowerCase()
  const details = typeof error === 'object' && error !== null
    ? error as { statusCode?: unknown; code?: unknown; response?: { statusCode?: unknown; status?: unknown } }
    : undefined
  const candidates = [details?.statusCode, details?.response?.statusCode, details?.response?.status, details?.code]
  const structured = candidates.find(value => (typeof value === 'number' || typeof value === 'string')
    && /^[1-5]\d\d$/.test(String(value)))
  const matched = message.match(/\b(?:status|http)\s+([1-5]\d\d)\b/)
  const status = structured === undefined ? Number(matched?.[1]) : Number(structured)
  if ([408, 409, 425, 429].includes(status) || (status >= 500 && status <= 599)) return false
  if (status >= 400 && status <= 499) return true
  return /\buid\b|identity|label|invalid|foreign|does not match|not descended|another branch|claim|authorization|validation|rebind|uncommitted|not clean|no commit/.test(message)
}

/** Record scheduler-owned expiry; this is not a late Worker result. */
export function expireRunInSessionImpl(
  host: RecoveryHost,
  session: Session,
  currentRun: PactFlowRun,
  outcome: string,
  nextNodeState: 'failed' | 'ready' = 'failed',
): PactFlowClaimResult {
  if (host.isTerminalRun(currentRun)) throw new Error(`PactFlow Run "${currentRun.id}" is already terminal`)
  const now = Date.now()
  if (now < currentRun.leaseDeadline) throw new Error(`PactFlow Run "${currentRun.id}" lease is still active`)
  const currentNode = host.node(session, currentRun.nodeId)
  if (currentNode.revision !== currentRun.nodeRevision) {
    throw new Error(`PactFlow Run "${currentRun.id}" expiry targets a stale node revision`)
  }
  const node: PactFlowNode = {
    ...currentNode, state: nextNodeState, revision: currentNode.revision + 1, updatedAt: now,
  }
  const run: PactFlowRun = { ...currentRun, state: 'failed', outcome, updatedAt: now }
  host.events.append(session, 'pactflow/run-settled', { v: 1, run, node })
  return { run, node }
}
