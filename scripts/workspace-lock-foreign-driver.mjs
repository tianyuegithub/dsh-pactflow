// One lock attempt from a single real OS process. Used by the cross-host lock
// semantics test: the parent seeds the shared lock directory with an owner file
// naming a FOREIGN host (or a dead same-host owner) and then runs this driver,
// which must acquire only when the lock rules allow it. The outcome is printed
// as one JSON line so the parent can assert without parsing stderr prose.
import { withWorkspaceFileLock } from '../packages/dsh-pactflow/lib/types/workspace-lock.js'

const lockPath = process.env.PACTFLOW_LOCK_PATH
if (typeof lockPath !== 'string' || lockPath.length === 0) {
  process.stderr.write('workspace-lock-foreign-driver: set PACTFLOW_LOCK_PATH\n')
  process.exit(2)
}

try {
  await withWorkspaceFileLock(lockPath, async () => 'acquired')
  process.stdout.write(`${JSON.stringify({ acquired: true })}\n`)
} catch (error) {
  process.stdout.write(`${JSON.stringify({ acquired: false, message: error instanceof Error ? error.message : String(error) })}\n`)
}
