import { randomUUID } from 'node:crypto'
import { lstat, mkdir, mkdtemp, readFile, readdir, rename, rmdir, unlink, writeFile } from 'node:fs/promises'
import { hostname } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

function code(error: unknown): string | undefined { return (error as NodeJS.ErrnoException).code }

async function exists(path: string): Promise<boolean> {
  try { await lstat(path); return true } catch (error) {
    if (code(error) === 'ENOENT') return false
    throw error
  }
}

/** Detach the complete owned directory before deleting contents; a crash never leaves an empty published lock. */
async function releaseOwner(directory: string, ownerFile: string): Promise<void> {
  if (!await exists(join(directory, ownerFile))) return
  const detached = `${directory}.released-${randomUUID()}`
  await rename(directory, detached)
  await unlink(join(detached, ownerFile))
  try { await rmdir(detached) } catch (error) {
    if (code(error) !== 'ENOENT') throw error
  }
}

async function recoverDeadOwner(directory: string): Promise<void> {
  let files: string[]
  try { files = await readdir(directory) } catch (error) {
    if (code(error) === 'ENOENT') return
    throw error
  }
  if (files.length !== 1) return
  const file = files[0]!
  const match = /^owner-([1-9][0-9]*)-([0-9a-f-]{36})\.json$/.exec(file)
  if (match === null) return // Old/unknown lock formats require explicit inspection.
  let owner: { host?: unknown }
  try { owner = JSON.parse(await readFile(join(directory, file), 'utf8')) } catch (error) {
    if (code(error) === 'ENOENT' || error instanceof SyntaxError) return
    throw error
  }
  const pid = Number(match[1])
  if (owner === null || owner.host !== hostname() || !Number.isSafeInteger(pid)) return
  try { process.kill(pid, 0); return } catch (error) {
    if (code(error) !== 'ESRCH') return
  }
  // Exactly one recoverer can rename the old unique file. Keep the directory non-empty
  // and publish the recoverer's PID atomically, so its own crash is recoverable too.
  const claimed = `owner-${process.pid}-${randomUUID()}.json`
  try { await rename(join(directory, file), join(directory, claimed)) } catch (error) {
    if (code(error) === 'ENOENT') return
    throw error
  }
  await releaseOwner(directory, claimed)
}

/** Sweep only exact staging/detached names belonging to this configuration file. */
async function recoverLockArtifacts(path: string): Promise<void> {
  const parent = dirname(path)
  const prefix = `${basename(path)}.lock.`
  for (const entry of await readdir(parent, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
    const suffix = entry.name.slice(prefix.length)
    if (!/^(?:pending-[A-Za-z0-9]{6}|released-[0-9a-f-]{36})(?:\.released-[0-9a-f-]{36})*$/.test(suffix)) continue
    const artifact = join(parent, entry.name)
    // A detached empty directory has no remaining writes; never remove empty staging directories.
    if (suffix.includes('released-')) {
      try { await rmdir(artifact); continue } catch (error) {
        if (code(error) === 'ENOENT') continue
        if (!['ENOTEMPTY', 'EEXIST'].includes(code(error) ?? '')) throw error
      }
    }
    await recoverDeadOwner(artifact)
  }
}

/** Best-effort holder identification for the timeout error; never masks the original failure. */
async function describeHolder(lockPath: string): Promise<string> {
  try {
    const [file] = await readdir(lockPath)
    if (file === undefined) return ''
    const match = file.match(/^owner-([1-9][0-9]*)-([0-9a-f-]{36})\.json$/)
    if (match === null) return ''
    const owner = JSON.parse(await readFile(join(lockPath, file), 'utf8')) as { host?: unknown }
    if (owner === null || typeof owner.host !== 'string' || owner.host === '') return ''
    return ` (held by host "${owner.host}", pid ${match[1]})`
  } catch {
    return ''
  }
}

/** Local filesystem lock: publish a complete non-empty directory, never age-steal a live owner. */
export async function withWorkspaceFileLock<T>(path: string, operation: () => Promise<T>): Promise<T> {
  const lockPath = `${path}.lock`
  await mkdir(dirname(path), { recursive: true })
  await recoverLockArtifacts(path)
  const pending = await mkdtemp(`${lockPath}.pending-`)
  const ownerFile = `owner-${process.pid}-${randomUUID()}.json`
  let acquired = false
  try {
    await writeFile(join(pending, ownerFile), JSON.stringify({ host: hostname() }), { mode: 0o600 })
    const deadline = performance.now() + 5_000
    while (!acquired) {
      if (!await exists(lockPath)) {
        try { await rename(pending, lockPath); acquired = true } catch (error) {
          if (!['EEXIST', 'ENOTEMPTY'].includes(code(error) ?? '')) throw error
        }
      }
      if (!acquired) {
        await recoverDeadOwner(lockPath)
        if (performance.now() >= deadline) {
          // Name the holder so a cross-host abandoned lock (which this host must
          // never steal) has an actionable manual-recovery starting point.
          throw new Error(`PactFlow Workspace configuration lock timed out${await describeHolder(lockPath)}; inspect the active or interrupted writer before retrying`)
        }
        await delay(20)
      }
    }
    return await operation()
  } finally {
    await releaseOwner(acquired ? lockPath : pending, ownerFile)
  }
}
