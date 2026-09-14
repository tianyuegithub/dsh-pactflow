import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import {
  PACTFLOW_ARTIFACT_OVERSIZE_CODE,
  PACTFLOW_CHANNEL_LIMITS,
  PactFlowArtifactStoreClient,
  assertWithinChannelLimit,
  pactFlowArtifactObjectKey,
  parsePactFlowArtifactRef,
} from '../src/artifact-store.ts'
import { artifactObjectRecord, reconcileArtifactObjects, summarizeArtifactLedger } from '../src/retention-policy.ts'

/**
 * Real-path acceptance for the STORAGE lane of `artifact-ref-handoff` tasks 5.1
 * and 7.1 — the part provable without a cluster: put → ref → resolve with hash
 * and byte verification, the per-channel oversize gate, list reconciliation of
 * orphans, and the retention ledger that marks but never deletes.
 *
 * Deliberately NOT under `e2e/`: the release web gate discovers every e2e suite
 * and requires zero skips, so an env-gated suite there could never pass. Suites
 * needing a live cluster belong in `e2e/` once they can actually run.
 *
 * STILL MISSING for 5.1/7.1 (needs a live K3s cluster and a human, so nothing
 * here claims it): worker put inside a dispatched run, the ref handed back
 * through the result document, per-run artifact Secret recycling via the
 * children cleanup ledger, and a UI store binding driving a long task on real
 * model quota.
 *
 * Objects created here are intentionally left in place: the contract is "mark,
 * never auto-delete" (deletion is a user adjudication), and the store client
 * exposes no delete operation by design.
 *
 * Credentials come from the environment only: never argv, never persisted.
 */
const endpoint = process.env.PACTFLOW_REAL_ARTIFACT_ENDPOINT
const bucket = process.env.PACTFLOW_REAL_ARTIFACT_BUCKET
const accessKeyId = process.env.PACTFLOW_REAL_ARTIFACT_ACCESS_KEY
const secretAccessKey = process.env.PACTFLOW_REAL_ARTIFACT_SECRET_KEY
const ready = endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined

describe.skipIf(!ready)('PactFlow artifact ref handoff real-path storage chain', { timeout: 120_000 }, () => {
  const client = () => new PactFlowArtifactStoreClient({
    endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
    accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
  })
  // A fresh needId/runId pair per run: the prefix is unique, so reconciliation
  // below sees only this run's objects and never a previous run's leftovers.
  const needId = `handoff-${randomUUID()}`
  const runId = randomUUID()
  const prefix = `${needId}/${runId}/`
  const objectKey = (seq: number, kind: string, sender: string) =>
    pactFlowArtifactObjectKey({ needId, runId, seq, kind, sender })
  const keyOf = (uri: string) => uri.slice(`s3://${bucket!}/`.length)

  it('carries a long execution log as tail plus ref within the result-document budget', async () => {
    const store = client()
    // A log far past the 3 KiB result-document budget: inline delivery is exactly
    // what the externalization contract has to make impossible.
    const log = `execution line ${randomUUID()}\n`.repeat(4_000)
    expect(Buffer.byteLength(log, 'utf8')).toBeGreaterThan(PACTFLOW_CHANNEL_LIMITS['result-document'])

    const ref = await store.putArtifact({
      key: objectKey(0, 'execution-log', 'runner'),
      content: log, kind: 'execution-log', summary: log.split('\n')[0] ?? '(empty)',
    })

    // The result document carries only a bounded tail plus the structured ref.
    const document = JSON.stringify({ logTail: log.slice(-1_536), logArtifact: ref })
    assertWithinChannelLimit('result-document', Buffer.byteLength(document, 'utf8'))

    // A consumer MUST resolve and verify before using the content; resolveArtifact
    // re-checks bytes and sha256 against the ref and fails closed on a mismatch.
    const parsed = parsePactFlowArtifactRef((JSON.parse(document) as { logArtifact: unknown }).logArtifact)
    const resolved = await store.resolveArtifact(parsed)
    expect(Buffer.from(resolved).toString('utf8')).toBe(log)
    expect(parsed.bytes).toBe(Buffer.byteLength(log, 'utf8'))
  })

  it('rejects oversized inline payloads on the result-document and interaction channels', () => {
    for (const channel of ['result-document', 'interaction-request'] as const) {
      const limit = PACTFLOW_CHANNEL_LIMITS[channel]
      expect(() => assertWithinChannelLimit(channel, limit + 1))
        .toThrow(PACTFLOW_ARTIFACT_OVERSIZE_CODE)
      // The rejection must point at the way out, not merely refuse.
      expect(() => assertWithinChannelLimit(channel, limit + 1)).toThrow(/artifactRef/)
      expect(() => assertWithinChannelLimit(channel, limit)).not.toThrow()
    }
  })

  it('finds uploaded-but-unreferenced objects as orphans through live list reconciliation', async () => {
    const store = client()
    const recordedRef = await store.putArtifact({
      key: objectKey(1, 'report', 'host'), content: 'recorded by the host\n',
      kind: 'report', summary: 'recorded',
    })
    // An object the host never recorded: exactly the orphan the ledger must surface.
    const orphanRef = await store.putArtifact({
      key: objectKey(2, 'execution-log', 'worker'), content: 'uploaded but never handed back\n',
      kind: 'execution-log', summary: 'orphan',
    })

    const listed = await store.listObjects(prefix)
    expect(listed.map(entry => entry.key)).toEqual(expect.arrayContaining([keyOf(recordedRef.uri), keyOf(orphanRef.uri)]))

    const now = Date.now()
    const reconciled = reconcileArtifactObjects([artifactObjectRecord(recordedRef, now)], listed, bucket!, now)
    const orphans = reconciled.filter(record => record.orphan === true).map(record => record.uri)
    expect(orphans).toContain(orphanRef.uri)
    expect(orphans).not.toContain(recordedRef.uri)
  })

  it('marks overdue and over-budget objects without deleting any of them', async () => {
    const store = client()
    const ref = await store.putArtifact({
      key: objectKey(3, 'report', 'host'), content: 'retention subject\n', kind: 'report', summary: 'retained',
    })
    const now = Date.now()
    const aged = artifactObjectRecord(ref, now - 20 * 24 * 60 * 60 * 1_000)

    expect(summarizeArtifactLedger([aged], now).overdue.map(record => record.uri)).toContain(ref.uri)
    expect(summarizeArtifactLedger([aged], now, { maxBytes: 1 }).overBudget).toBe(true)

    // Marking is not deleting: the object must still be readable afterwards.
    expect((await store.headObject(keyOf(ref.uri))).bytes).toBe(ref.bytes)
  })
})
