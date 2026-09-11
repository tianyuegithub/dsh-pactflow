import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { hostname, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Cross-host lock semantics (item 11 remainder): the lock file may live on a
// shared filesystem mounted by several machines. A lock abandoned by a FOREIGN
// host must never be recovered, renamed, or deleted by this host — liveness of
// a foreign process cannot be probed, so stealing could break mutual exclusion.
// The contender must instead fail closed, naming the holder. Same-host dead
// owners keep their existing recovery path.
const driver = resolve(import.meta.dirname, '..', '..', '..', 'scripts', 'workspace-lock-foreign-driver.mjs')

const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }) })

interface DriverOutcome { readonly acquired: boolean; readonly message?: string }

function runDriver(lockPath: string): Promise<DriverOutcome> {
  return new Promise((resolveChild, rejectChild) => {
    const child = spawn(process.execPath, [driver], {
      env: { ...process.env, PACTFLOW_LOCK_PATH: lockPath },
      stdio: ['ignore', 'pipe', 'inherit'],
    })
    let stdout = ''
    child.stdout.on('data', chunk => { stdout += String(chunk) })
    child.on('error', rejectChild)
    child.on('exit', code => {
      if (code !== 0) { rejectChild(new Error(`foreign-lock driver exited with ${String(code)}`)); return }
      try { resolveChild(JSON.parse(stdout) as DriverOutcome) } catch (error) { rejectChild(error as Error) }
    })
  })
}

/** Seed the lock directory exactly the way a foreign host's owner would have left it. */
async function seedLock(root: string, host: string, pid: number): Promise<{ root: string; lockPath: string; lockDir: string; ownerFile: string }> {
  const lockPath = join(root, 'shared.locktarget')
  const lockDir = `${lockPath}.lock`
  const ownerFile = `owner-${String(pid)}-${randomUUID()}.json`
  await mkdir(lockDir)
  await writeFile(join(lockDir, ownerFile), JSON.stringify({ host }), { mode: 0o600 })
  return { root, lockPath, lockDir, ownerFile }
}

async function snapshotDirectory(directory: string): Promise<Map<string, string>> {
  const snapshot = new Map<string, string>()
  for (const entry of await readdir(directory)) {
    snapshot.set(entry, await readFile(join(directory, entry), 'utf8'))
  }
  return snapshot
}

const FOREIGN_HOST = 'pactflow-foreign-host-e2e'

describe('PactFlow workspace file lock across hosts', () => {
  it('fails closed on a foreign-host lock: names the holder and never touches it', async () => {
    // Guard against a machine actually named like the fake foreign host: that
    // would silently flip this test into the same-host recovery semantics.
    expect(FOREIGN_HOST).not.toBe(hostname())
    const root = await mkdtemp(join(tmpdir(), 'pactflow-lock-xhost-'))
    roots.push(root)
    const seeded = await seedLock(root, FOREIGN_HOST, 4242)
    const before = await snapshotDirectory(seeded.lockDir)

    const outcome = await runDriver(seeded.lockPath)

    expect(outcome.acquired).toBe(false)
    expect(outcome.message ?? '').toContain('timed out')
    expect(outcome.message ?? '').toContain(FOREIGN_HOST)
    expect(outcome.message ?? '').toContain('4242')
    // Nothing stolen, renamed, or deleted: the abandoned lock is byte-identical.
    expect(await snapshotDirectory(seeded.lockDir)).toEqual(before)
  }, 30_000)

  it('leaves foreign-host pending artifacts untouched while sweeping', async () => {
    expect(FOREIGN_HOST).not.toBe(hostname())
    const root = await mkdtemp(join(tmpdir(), 'pactflow-lock-xhost-'))
    roots.push(root)
    const lockPath = join(root, 'shared.locktarget')
    // A foreign host crashed between mkdtemp(pending) and rename: its pending
    // directory with an owner file is still on the shared disk.
    const pending = `${lockPath}.lock.pending-abc123`
    await mkdir(pending)
    const ownerFile = `owner-7777-${randomUUID()}.json`
    await writeFile(join(pending, ownerFile), JSON.stringify({ host: FOREIGN_HOST }), { mode: 0o600 })

    const outcome = await runDriver(lockPath)

    // The local contender acquires (no live lock exists) and must NOT have
    // deleted or renamed the foreign host's staging artifacts.
    expect(outcome.acquired).toBe(true)
    const names = await readdir(join(root))
    expect(names).toContain('shared.locktarget.lock.pending-abc123')
    expect(await readFile(join(pending, ownerFile), 'utf8')).toBe(JSON.stringify({ host: FOREIGN_HOST }))
  }, 30_000)

  it('keeps same-host dead-owner recovery intact (regression guard)', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-lock-xhost-'))
    roots.push(root)
    // A lock left by THIS host with a pid that cannot exist anywhere: 4194304 is
    // above macOS's pid range and equal to Linux's maximum pid_max (pids stop at
    // pid_max - 1), so `process.kill(pid, 0)` reports ESRCH on every platform.
    const seeded = await seedLock(root, hostname(), 2 ** 22)

    const outcome = await runDriver(seeded.lockPath)

    // Acquiring proves recoverDeadOwner took over the dead same-host owner. The
    // driver releases after its operation, so the lock directory must be gone
    // with no detached released-* artifacts left behind.
    expect(outcome.acquired).toBe(true)
    const names = await readdir(root)
    expect(names).not.toContain('shared.locktarget.lock')
    expect(names.filter(name => name.includes('released-'))).toEqual([])
  }, 30_000)

  // The shared-filesystem semantics and the real-NFS runbook must stay in the
  // operator manual: the boundary ("real NFS verification has NOT run") may not
  // be silently deleted or drifted into a "verified" claim.
  it('binds the operator manual to the cross-host semantics and the unrun NFS runbook', () => {
    const opsDoc = readFileSync(
      resolve(import.meta.dirname, '..', '..', '..', 'docs', 'installation-operations-安装运维.md'), 'utf8',
    )
    expect(opsDoc).toMatch(/跨主机\/共享盘上的工作区配置锁/)
    expect(opsDoc).toContain('绝不偷活主')
    expect(opsDoc).toContain('mount_nfs 127.0.0.1:/Users/ty/pf-nfs')
    expect(opsDoc).toMatch(/真实 NFS 双客户端互斥验证：未运行/)
  })
})
