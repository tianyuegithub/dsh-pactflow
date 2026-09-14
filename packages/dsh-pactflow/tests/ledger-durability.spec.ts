import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { PactFlowRunCleanupLedger } from '../src/run-ledger.ts'
import { PactFlowProbeCleanupLedger } from '../src/probe-ledger.ts'

/**
 * The ledgers exist so that a crash between "create a cluster resource" and
 * "record that we own it" still leaves a discoverable responsibility. Three ways
 * that promise used to be broken:
 *
 *  - a record whose shape did not validate was skipped with `continue`, and the
 *    next write overwrote the file from memory — so the entry was deleted, with
 *    nothing logged. Adding a required field (that is how `fingerprint` arrived)
 *    was enough to evaporate every record written by the previous version;
 *  - `load()` cached forever, and `persist()` rewrote the whole file from that
 *    cache, so a second Host process erased the first one's records;
 *  - one rejected write poisoned the chain: `.then(onFulfilled)` on a rejected
 *    promise never calls back, so after a single ENOSPC every later `apply()`
 *    failed with the same stale error and nothing was ever recorded again.
 */

const dirs: string[] = []
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pactflow-ledger-durability-'))
  dirs.push(dir)
  return dir
}
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('PactFlow cleanup ledger durability', () => {
  it('refuses to load a ledger holding an unreadable record instead of dropping it', async () => {
    const path = join(root(), 'run-cleanups.json')
    writeFileSync(path, JSON.stringify([
      { jobName: 'dsh-pf-good', fingerprint: 'fp', createdAt: new Date().toISOString(), jobUid: 'uid-a' },
      { jobName: 'dsh-pf-future', createdAt: new Date().toISOString() },  // a field this version requires
    ]))
    const ledger = new PactFlowRunCleanupLedger(path)
    await expect(ledger.list()).rejects.toThrow(/not discarded|corrupted/)
    // The file is untouched: refusing must not be the thing that destroys it.
    expect(JSON.parse(await readFile(path, 'utf8')) as unknown[]).toHaveLength(2)
  })

  it('applies the same refusal to the probe ledger', async () => {
    const path = join(root(), 'probe-cleanups.json')
    writeFileSync(path, JSON.stringify([{ jobName: 'dsh-pf-probe', createdAt: new Date().toISOString() }]))
    await expect(new PactFlowProbeCleanupLedger(path).list()).rejects.toThrow(/not discarded|corrupted/)
  })

  it('sees records another process wrote after it first read the file', async () => {
    const path = join(root(), 'run-cleanups.json')
    const mine = new PactFlowRunCleanupLedger(path)
    await mine.apply('fp', { phase: 'intent', jobName: 'dsh-pf-mine', childNames: [] })

    // A second Host process — upgrade overlap, `verify:profile` beside a live
    // instance — records its own responsibility against the same file.
    const other = new PactFlowRunCleanupLedger(path)
    await other.apply('fp', { phase: 'intent', jobName: 'dsh-pf-other', childNames: [] })

    // Writing again from the first process must not erase the second one's record.
    await mine.apply('fp', { phase: 'confirmed', jobName: 'dsh-pf-mine', jobUid: 'uid-a', children: [] })
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { jobName: string }[]
    expect(onDisk.map(entry => entry.jobName).sort()).toEqual(['dsh-pf-mine', 'dsh-pf-other'])
  })

  it('records the child names a run intended to create, without making them deletable', async () => {
    // The intent carried four planned names (ConfigMap, input/model/artifact
    // Secrets) and the ledger dropped every one. A crash between "create sent" and
    // "receipt received" then left an entry naming nothing: no UID was ever seen,
    // so nothing can be deleted — and with the names gone, an operator recovering
    // by hand had no record of what the run was about to create either.
    const path = join(root(), 'run-cleanups.json')
    const ledger = new PactFlowRunCleanupLedger(path)
    await ledger.apply('fp', {
      phase: 'intent', jobName: 'dsh-pf-planned',
      childNames: ['dsh-pf-planned', 'dsh-pf-planned-input', 'dsh-pf-planned-artifact'],
    })

    const [entry] = await new PactFlowRunCleanupLedger(path).list()
    expect(entry?.plannedChildNames).toEqual(['dsh-pf-planned', 'dsh-pf-planned-input', 'dsh-pf-planned-artifact'])
    // A name is not an identity: nothing here may be presented as owned.
    expect(entry).not.toHaveProperty('jobUid')
    expect(entry).not.toHaveProperty('children')
  })

  it('keeps recording after one write fails', async () => {
    const path = join(root(), 'run-cleanups.json')
    const ledger = new PactFlowRunCleanupLedger(path)
    await ledger.apply('fp', { phase: 'intent', jobName: 'dsh-pf-first', childNames: [] })

    // One transient write failure (a full disk, an IO error).
    const persist = Reflect.get(ledger, 'persist') as () => Promise<void>
    let failed = false
    Reflect.set(ledger, 'persist', async function (this: PactFlowRunCleanupLedger) {
      if (!failed) { failed = true; throw new Error('ENOSPC: no space left on device') }
      return persist.call(this)
    })
    await expect(ledger.apply('fp', { phase: 'intent', jobName: 'dsh-pf-second', childNames: [] })).rejects.toThrow(/ENOSPC/)

    // The next attempt must actually be attempted, not rejected with the old error.
    await ledger.apply('fp', { phase: 'intent', jobName: 'dsh-pf-third', childNames: [] })
    const onDisk = JSON.parse(await readFile(path, 'utf8')) as { jobName: string }[]
    expect(onDisk.map(entry => entry.jobName)).toContain('dsh-pf-third')
  })
})
