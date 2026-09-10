/**
 * Retention policy for kept failure scenes.
 *
 * A retained scene is deliberately never auto-deleted (it may hold uncommitted
 * work). But it must not become an unbounded silent residue either: this module
 * ages retained scenes, flags the overdue ones, and accounts for their disk size so
 * a human can act. It never deletes anything.
 */

import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

/** Default window after which a retained scene is considered overdue for review. */
export const PACTFLOW_DEFAULT_RETENTION_MS = 14 * 24 * 60 * 60 * 1_000

/** Default total disk budget for retained scenes before the total is flagged. */
export const PACTFLOW_DEFAULT_RETENTION_BYTES = 512 * 1024 * 1024

export interface PactFlowRetainedScene {
  readonly id: string
  readonly retain?: boolean
  /** Epoch ms when the retention window ends; absent means never auto-expires. */
  readonly retainUntil?: number
  /** Recorded on-disk size of the retained scene; absent means unmeasured (not zero). */
  readonly sizeBytes?: number
}

/**
 * Whether a retained scene has passed its retention window. Non-retained records
 * are never overdue; a retained record without a window never expires.
 */
export function isRetentionOverdue(record: PactFlowRetainedScene, now: number): boolean {
  if (record.retain !== true) return false
  if (record.retainUntil === undefined) return false
  return now > record.retainUntil
}

export interface PactFlowRetainedSummary {
  readonly total: number
  readonly overdue: readonly PactFlowRetainedScene[]
}

/** Summarize retained scenes, listing overdue ones separately (deterministic order). */
export function summarizeRetainedScenes(
  records: readonly PactFlowRetainedScene[],
  now: number,
): PactFlowRetainedSummary {
  const retained = records.filter(record => record.retain === true)
  const overdue = retained.filter(record => isRetentionOverdue(record, now))
    .sort((left, right) => left.id.localeCompare(right.id))
  return { total: retained.length, overdue }
}

/**
 * Bounded on-disk size of a retained scene. The walk stops once it has visited
 * `maxEntries` files or counted `maxBytes` bytes, so measuring a large/odd tree
 * can never block a failure path indefinitely. A capped result is a lower bound,
 * which is still enough to prove "over budget": `capped` marks that honestly.
 */
export function measureRetainedSceneBytes(
  root: string,
  maxBytes = PACTFLOW_DEFAULT_RETENTION_BYTES,
  maxEntries = 20_000,
): { readonly bytes: number; readonly capped: boolean } {
  let bytes = 0
  let entries = 0
  let capped = false
  const walk = (dir: string): void => {
    if (capped) return
    let names: readonly string[]
    try { names = readdirSync(dir) } catch { return }
    for (const name of names) {
      if (capped) return
      if (entries >= maxEntries) { capped = true; return }
      entries += 1
      const child = join(dir, name)
      let info
      try { info = statSync(child) } catch { continue }
      if (info.isDirectory()) { walk(child); continue }
      bytes += info.size
      if (bytes >= maxBytes) { capped = true; return }
    }
  }
  walk(root)
  return { bytes, capped }
}

export interface PactFlowRetentionCapacity {
  readonly total: number
  readonly overdue: readonly PactFlowRetainedScene[]
  /** Sum of recorded scene sizes; unmeasured scenes contribute nothing. */
  readonly retainedBytes: number
  /** True only when every retained scene carries a recorded size (so the sum is a true total). */
  readonly measured: boolean
  /** True when the retained total meets or exceeds the disk budget. */
  readonly overBudget: boolean
  readonly maxBytes: number
}

/**
 * Combine the time window with a disk budget. A scene without a recorded size is
 * treated as *unmeasured*, not as zero: the total is only reported as a true total
 * (`measured`) when every retained scene was measured. This never deletes anything
 * and never presents a partial sum as complete.
 */
export function summarizeRetentionCapacity(
  records: readonly PactFlowRetainedScene[],
  maxBytes: number,
  now: number,
): PactFlowRetentionCapacity {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error('PactFlow retention byte budget must be a positive integer')
  const summary = summarizeRetainedScenes(records, now)
  const retained = records.filter(record => record.retain === true)
  const measured = retained.every(record => record.sizeBytes !== undefined)
  const retainedBytes = retained.reduce((sum, record) => sum + (record.sizeBytes ?? 0), 0)
  return {
    total: summary.total,
    overdue: summary.overdue,
    retainedBytes,
    measured,
    overBudget: measured && retainedBytes >= maxBytes,
    maxBytes,
  }
}
