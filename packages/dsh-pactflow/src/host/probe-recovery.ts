import type { Context } from '@deepseek-ai/cordis'
import type { PactFlowK3sWorker, PactFlowProbeCleanupRecorder } from '../k3s-worker.ts'
import type { PactFlowProbeCleanupLedger } from '../probe-ledger.ts'

/**
 * Host surface required by the probe cleanup responsibility seam. The service
 * builds this object per call so instance-level overrides stay authoritative.
 */
export interface ProbeRecoveryHost {
  readonly probeLedger: PactFlowProbeCleanupLedger
  readonly k3s: PactFlowK3sWorker | undefined
  readonly k3sByPool: Map<string, PactFlowK3sWorker>
  readonly ctx: Context
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
  if (entries.length === 0) return true
  const workers = [
    ...(host.k3s === undefined ? [] : [host.k3s]),
    ...host.k3sByPool.values(),
  ]
  if (workers.length === 0) return true
  let failed = 0
  for (const entry of entries) {
    const worker = workers.find(candidate => candidate.connectionFingerprint() === entry.fingerprint)
    if (worker === undefined) {
      host.ctx.logger.warn('PactFlow probe cleanup "%s" has no matching configured provider; responsibility retained', entry.jobName)
      continue
    }
    try {
      await worker.cleanupProbeIdentity(entry)
      await host.probeLedger.remove(entry.jobName)
    } catch (error) {
      failed += 1
      host.ctx.logger.warn('PactFlow probe cleanup "%s" failed: %s', entry.jobName, host.boundedOutcome(error))
    }
  }
  return failed === 0
}
