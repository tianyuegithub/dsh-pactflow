import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'

// Real cross-process mutual exclusion: N separate Node processes perform a
// read-modify-write on one shared counter, guarded by the actual file lock. If the
// lock did not truly exclude across processes, updates would interleave and be lost.
//
// This is the multi-host claim the code makes in words; here it is exercised with
// real OS processes rather than an in-process double, which cannot observe it.
const driver = resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'multi-process-lock-driver.mjs')
const PROCESSES = 4
const ITERATIONS = 15

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

// Start one child and resolve on a clean exit. Calling this for every process
// before awaiting is what makes them genuinely concurrent.
function startChild(environment: NodeJS.ProcessEnv): Promise<void> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [driver], { env: environment, stdio: 'ignore' })
    child.on('error', rejectChild)
    child.on('exit', code => code === 0
      ? resolveChild()
      : rejectChild(new Error(`lock driver exited with ${String(code)}`)))
  })
}

async function runWorkload(unlocked: boolean): Promise<number> {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-lock-mp-'))
  roots.push(root)
  const counterPath = join(root, 'counter.txt')
  await writeFile(counterPath, '0')
  const environment = {
    ...process.env,
    PACTFLOW_LOCK_PATH: join(root, 'shared.locktarget'),
    PACTFLOW_COUNTER_PATH: counterPath,
    PACTFLOW_LOCK_ITERATIONS: String(ITERATIONS),
    ...unlocked ? { PACTFLOW_LOCK_UNLOCKED: '1' } : {},
  }
  // Spawn all children before awaiting any, so they actually overlap.
  await Promise.all(Array.from({ length: PROCESSES }, () => startChild(environment)))
  return Number(await readFile(counterPath, 'utf8'))
}

describe('PactFlow workspace file lock across real processes', () => {
  it('serializes read-modify-write across processes so no update is lost', async () => {
    expect(await runWorkload(false)).toBe(PROCESSES * ITERATIONS)
  }, 60_000)

  it('demonstrates the same workload loses updates without the lock (control)', async () => {
    // The control proves the assertion above is not vacuous: with the identical
    // workload and no lock, interleaving loses updates, so the exact-total check
    // is a real signal rather than sub-millisecond luck.
    expect(await runWorkload(true)).toBeLessThan(PROCESSES * ITERATIONS)
  }, 60_000)
})
