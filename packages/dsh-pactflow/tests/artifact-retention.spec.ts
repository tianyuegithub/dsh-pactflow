import { describe, expect, it } from 'vitest'
import {
  artifactObjectRecord, reconcileArtifactObjects, summarizeArtifactLedger,
} from '../src/retention-policy.ts'
import { makePactFlowArtifactRef } from '../src/artifact-store.ts'

const ref = (key: string, bytes: number): ReturnType<typeof makePactFlowArtifactRef> => makePactFlowArtifactRef({
  bucket: 'pactflow-artifacts', key, etag: '"0102030405060708090a0b0c0d0e0f10"',
  bytes, hash: 'a'.repeat(64), kind: 'log', summary: 's',
})

const DAY = 24 * 60 * 60 * 1_000
const NOW = Date.UTC(2026, 8, 14, 12, 0, 0)

describe('PactFlow artifact object retention ledger', () => {
  it('ages objects and flags the overdue ones without deleting anything', () => {
    const records = [
      artifactObjectRecord(ref('need-1/run-1/0-log-worker-a.txt', 10), NOW - 20 * DAY),
      artifactObjectRecord(ref('need-1/run-2/0-log-worker-b.txt', 20), NOW - 1 * DAY),
    ]
    const ledger = summarizeArtifactLedger(records, NOW)
    expect(ledger.total).toBe(2)
    expect(ledger.overdue.map(record => record.uri)).toEqual(['s3://pactflow-artifacts/need-1/run-1/0-log-worker-a.txt'])
    expect(ledger.totalBytes).toBe(30)
    expect(ledger.overBudget).toBe(false)
  })

  it('flags the byte budget honestly', () => {
    const records = [artifactObjectRecord(ref('need-1/run-1/0-log-worker-a.txt', 600), NOW)]
    const ledger = summarizeArtifactLedger(records, NOW, { maxBytes: 1024, windowMs: 14 * DAY })
    expect(ledger.overBudget).toBe(false)
    const bigger = summarizeArtifactLedger([
      artifactObjectRecord(ref('need-1/run-1/0-log-worker-a.txt', 700), NOW),
      artifactObjectRecord(ref('need-1/run-2/0-log-worker-b.txt', 700), NOW),
    ], NOW, { maxBytes: 1024 })
    expect(bigger.overBudget).toBe(true)
  })

  it('marks listed-but-unrecorded objects as orphans and counts their occupancy', () => {
    const recorded = [artifactObjectRecord(ref('need-1/run-1/0-log-worker-a.txt', 100), NOW - 1 * DAY)]
    const listed = [
      { key: 'need-1/run-1/0-log-worker-a.txt', bytes: 100, lastModifiedMs: NOW - 1 * DAY },
      { key: 'need-1/run-9/0-log-worker-lost.txt', bytes: 55, lastModifiedMs: NOW - 2 * DAY },
    ]
    const merged = reconcileArtifactObjects(recorded, listed, 'pactflow-artifacts', NOW)
    expect(merged).toHaveLength(2)
    const orphan = merged.find(record => record.uri.endsWith('lost.txt'))
    expect(orphan?.orphan).toBe(true)
    expect(orphan?.bytes).toBe(55)
    const ledger = summarizeArtifactLedger(merged, NOW)
    expect(ledger.orphans.map(record => record.uri)).toEqual(['s3://pactflow-artifacts/need-1/run-9/0-log-worker-lost.txt'])
    expect(ledger.totalBytes).toBe(155)
  })

  it('keeps recorded objects absent from the listing visible (drift stays in the ledger)', () => {
    const recorded = [artifactObjectRecord(ref('need-1/run-1/0-log-worker-a.txt', 100), NOW - 1 * DAY)]
    const merged = reconcileArtifactObjects(recorded, [], 'pactflow-artifacts', NOW)
    expect(merged).toHaveLength(1)
    expect(merged[0]?.orphan).toBeUndefined()
  })

  it('rejects non-positive budgets and windows', () => {
    expect(() => summarizeArtifactLedger([], NOW, { maxBytes: 0 })).toThrow(/budget/)
    expect(() => summarizeArtifactLedger([], NOW, { windowMs: 0 })).toThrow(/window/)
  })
})
