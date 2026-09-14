import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowProbeCleanupLedger } from '../src/probe-ledger.ts'

const roots: string[] = []

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

async function ledgerPath(): Promise<{ ledger: PactFlowProbeCleanupLedger; path: string }> {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-ledger-'))
  roots.push(root)
  const path = join(root, 'probe-cleanups.json')
  return { ledger: new PactFlowProbeCleanupLedger(path), path }
}

describe('PactFlow probe cleanup ledger', () => {
  it('persists intent, confirmation, and removal across instances', async () => {
    const { ledger, path } = await ledgerPath()
    const fingerprint = 'f'.repeat(64)
    await ledger.apply('harness', fingerprint, { phase: 'intent', jobName: 'dsh-pf-probe-a', secretName: 'dsh-pf-probe-a-model' })
    await ledger.apply('harness', fingerprint, {
      phase: 'confirmed', jobName: 'dsh-pf-probe-a', jobUid: 'job-uid', secretName: 'dsh-pf-probe-a-model', secretUid: 'secret-uid',
    })
    expect(await ledger.list()).toEqual([{
      jobName: 'dsh-pf-probe-a', kind: 'harness', fingerprint, createdAt: expect.any(String),
      jobUid: 'job-uid', secretName: 'dsh-pf-probe-a-model', secretUid: 'secret-uid',
    }])
    const reopened = new PactFlowProbeCleanupLedger(path)
    expect(await reopened.list()).toEqual(await ledger.list())
    await reopened.remove('dsh-pf-probe-a')
    expect(await reopened.list()).toEqual([])
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual([])
  })

  it('keeps an intent record without confirmed identities for fail-closed recovery', async () => {
    const { ledger } = await ledgerPath()
    await ledger.apply('image', 'f'.repeat(64), { phase: 'intent', jobName: 'dsh-pf-image-b' })
    const records = await ledger.list()
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ jobName: 'dsh-pf-image-b', kind: 'image' })
    expect(records[0]).not.toHaveProperty('jobUid')
    expect(records[0]).not.toHaveProperty('secretUid')
  })

  it('refuses to confirm a responsibility that was never persisted as intent', async () => {
    const { ledger } = await ledgerPath()
    await expect(ledger.apply('harness', 'f'.repeat(64), {
      phase: 'confirmed', jobName: 'dsh-pf-probe-c', jobUid: 'job-uid',
    })).rejects.toThrow('was not persisted before creation')
    expect(await ledger.list()).toEqual([])
  })

  it('fails closed on a corrupted ledger instead of discarding responsibilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-ledger-'))
    roots.push(root)
    const path = join(root, 'probe-cleanups.json')
    await writeFile(path, '{not json', 'utf8')
    const ledger = new PactFlowProbeCleanupLedger(path)
    await expect(ledger.list()).rejects.toThrow('corrupted')
    await expect(ledger.apply('harness', 'f'.repeat(64), { phase: 'intent', jobName: 'dsh-pf-probe-d' }))
      .rejects.toThrow('corrupted')
  })

  it('retains incomplete but readable records exactly as written', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-ledger-'))
    roots.push(root)
    const path = join(root, 'probe-cleanups.json')
    await writeFile(path, JSON.stringify([
      { jobName: 'dsh-pf-image-e', fingerprint: 'f'.repeat(64), kind: 'image', createdAt: 'x' },
      { jobName: 'dsh-pf-probe-f', fingerprint: 'f'.repeat(64), kind: 'harness', createdAt: 'x',
        jobUid: 'job-uid', secretName: 'secret-name' },
    ]), 'utf8')
    const ledger = new PactFlowProbeCleanupLedger(path)
    const records = await ledger.list()
    expect(records).toHaveLength(2)
    expect(records[0]).toMatchObject({ jobName: 'dsh-pf-image-e', kind: 'image' })
    // A record awaiting its UID keeps exactly the fields it has: no invented
    // secretUid, because a fabricated UID is a licence to delete.
    expect(records[1]).toMatchObject({ jobName: 'dsh-pf-probe-f', jobUid: 'job-uid', secretName: 'secret-name' })
    expect(records[1]).not.toHaveProperty('secretUid')
  })

  it.each([
    ['an empty jobName', { jobName: '', fingerprint: 'f'.repeat(64), kind: 'harness', createdAt: 'x' }],
    ['an unknown kind', { jobName: 'no-kind', fingerprint: 'f'.repeat(64), kind: 'other', createdAt: 'x' }],
    ['a non-object row', 42],
  ] as const)('refuses to load a ledger containing %s rather than dropping the row', async (_label, row) => {
    // This case used to assert the opposite — that such a row is skipped. Skipping
    // is not inert: `persist()` rewrites the whole file from memory, so the next
    // write deletes the skipped row for good, with nothing logged, and the cluster
    // resources it named lose their only recorded owner. Adding a required field is
    // enough to turn every record written by the previous version into such a row.
    const root = await mkdtemp(join(tmpdir(), 'pactflow-probe-ledger-'))
    roots.push(root)
    const path = join(root, 'probe-cleanups.json')
    await writeFile(path, JSON.stringify([
      { jobName: 'dsh-pf-image-e', fingerprint: 'f'.repeat(64), kind: 'image', createdAt: 'x' },
      row,
    ]), 'utf8')
    await expect(new PactFlowProbeCleanupLedger(path).list()).rejects.toThrow(/not discarded/)
  })
})
