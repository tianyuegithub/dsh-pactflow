// One process in the multi-process workspace-lock test. It performs a
// read-modify-write on a shared counter, optionally guarded by the real
// cross-process file lock. Inputs arrive via the environment so the parent can
// spawn this with a fully literal argv.
//
// Correct mutual exclusion makes the final counter exactly processes × iterations.
// Without the lock the interleaved read-modify-write loses updates.
import { readFile, writeFile } from 'node:fs/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { withWorkspaceFileLock } from '../packages/dsh-pactflow/lib/types/workspace-lock.js'

const lockPath = process.env.PACTFLOW_LOCK_PATH
const counterPath = process.env.PACTFLOW_COUNTER_PATH
const iterations = Number(process.env.PACTFLOW_LOCK_ITERATIONS ?? '15')
const unlocked = process.env.PACTFLOW_LOCK_UNLOCKED === '1'

if (typeof lockPath !== 'string' || lockPath.length === 0
  || typeof counterPath !== 'string' || counterPath.length === 0
  || !Number.isSafeInteger(iterations) || iterations < 1) {
  process.stderr.write('multi-process-lock-driver: set PACTFLOW_LOCK_PATH, PACTFLOW_COUNTER_PATH, PACTFLOW_LOCK_ITERATIONS\n')
  process.exit(2)
}

// A deliberate gap between read and write widens the interleaving window, so the
// test is genuinely adversarial rather than passing on sub-millisecond luck.
async function bump() {
  const current = Number(await readFile(counterPath, 'utf8'))
  await delay(5)
  await writeFile(counterPath, String(current + 1))
}

for (let index = 0; index < iterations; index += 1) {
  if (unlocked) await bump()
  else await withWorkspaceFileLock(lockPath, bump)
}
