import type { PactFlowK3sWorker, PactFlowProbeCleanupRecorder } from '../k3s-worker.ts'
import type { PactFlowProbeCleanupLedger } from '../probe-ledger.ts'
import type { PactFlowRunCleanupLedger } from '../run-ledger.ts'

/**
 * Host surface required by the probe cleanup responsibility seam. The service
 * builds this object per call so instance-level overrides stay authoritative.
 */
export interface ProbeRecoveryHost {
  readonly probeLedger: PactFlowProbeCleanupLedger
  readonly runLedger: PactFlowRunCleanupLedger
  readonly k3s: PactFlowK3sWorker | undefined
  readonly k3sByPool: Map<string, PactFlowK3sWorker>
  /** Narrow log port instead of the whole Cordis Context (R12). */
  readonly logger: { warn(message: string, ...args: unknown[]): void }
  boundedOutcome(value: unknown): string
}

/** Persist one probe's cleanup responsibility under its provider connection identity. */
export function probeCleanupRecorderImpl(
  host: ProbeRecoveryHost,
  worker: PactFlowK3sWorker,
  kind: 'harness' | 'api' | 'image',
): PactFlowProbeCleanupRecorder {
  const fingerprint = worker.connectionFingerprint()
  return event => host.probeLedger.apply(kind, fingerprint, event)
}

/** Reconcile persisted probe cleanup responsibilities with the configured providers. */
export async function reconcileProbeCleanupsImpl(host: ProbeRecoveryHost): Promise<boolean> {
  const entries = await host.probeLedger.list()
  const runEntries = await host.runLedger.list()
  if (entries.length === 0 && runEntries.length === 0) return true
  const workers = [
    ...(host.k3s === undefined ? [] : [host.k3s]),
    ...host.k3sByPool.values(),
  ]
  if (workers.length === 0) return true
  let failed = 0
  for (const entry of entries) {
    const worker = workers.find(candidate => candidate.connectionFingerprint() === entry.fingerprint)
    if (worker === undefined) {
      host.logger.warn('PactFlow probe cleanup "%s" has no matching configured provider; responsibility retained', entry.jobName)
      continue
    }
    try {
      await worker.cleanupProbeIdentity(entry)
      await host.probeLedger.remove(entry.jobName)
    } catch (error) {
      failed += 1
      host.logger.warn('PactFlow probe cleanup "%s" failed: %s', entry.jobName, host.boundedOutcome(error))
    }
  }
  // Run creation intents: only a confirmed UID is auto-reconciled; an intent that
  // never got a UID keeps an explicit unknown responsibility (no name-based delete).
  for (const entry of runEntries) {
    const worker = workers.find(candidate => candidate.connectionFingerprint() === entry.fingerprint)
    if (worker === undefined) {
      host.logger.warn('PactFlow run cleanup "%s" has no matching configured provider; responsibility retained', entry.jobName)
      continue
    }
    if (entry.jobUid === undefined) {
      host.logger.warn('PactFlow run cleanup "%s" has no confirmed UID; explicit recovery required', entry.jobName)
      continue
    }
    try {
      await worker.cleanupRunIdentity(entry)
      await host.runLedger.remove(entry.jobName)
    } catch (error) {
      failed += 1
      host.logger.warn('PactFlow run cleanup "%s" failed: %s', entry.jobName, host.boundedOutcome(error))
    }
  }
  return failed === 0
}
