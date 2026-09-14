import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withWorkspaceFileLock } from './workspace-lock.ts'
import type { PactFlowRunCleanupEvent } from './k3s-worker.ts'

export interface PactFlowRunCleanupChild {
  readonly kind: 'configmap' | 'secret'
  readonly name: string
  readonly uid: string
}

export interface PactFlowRunCleanupRecord {
  readonly jobName: string
  /** Non-secret connection identity of the provider that created the resources. */
  readonly fingerprint: string
  readonly createdAt: string
  readonly jobUid?: string
  readonly children?: readonly PactFlowRunCleanupChild[]
  /**
   * Child names this run intended to create, recorded before any of them exists.
   *
   * Purely diagnostic: a name is not an identity, and nothing may ever be deleted
   * from this list. It exists for the crash window between "create sent" and
   * "receipt received", where no UID was ever observed — an operator recovering
   * by hand otherwise has no record of what this run was about to create.
   */
  readonly plannedChildNames?: readonly string[]
}

function sanitizeChildren(value: unknown): readonly PactFlowRunCleanupChild[] | undefined {
  if (!Array.isArray(value)) return undefined
  const children: PactFlowRunCleanupChild[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) return undefined
    const child = item as Partial<PactFlowRunCleanupChild>
    if ((child.kind !== 'configmap' && child.kind !== 'secret')
      || typeof child.name !== 'string' || child.name.trim() === ''
      || typeof child.uid !== 'string' || child.uid.trim() === '') return undefined
    children.push({ kind: child.kind, name: child.name, uid: child.uid })
  }
  return children
}

/**
 * Plugin-owned durable creation intent for K3s Runs. Written before any external
 * resource exists so a crash between create and response leaves a discoverable
 * responsibility; never stores credentials.
 */
export class PactFlowRunCleanupLedger {
  private records = new Map<string, PactFlowRunCleanupRecord>()
  private loaded: Promise<void> | undefined
  private writes = Promise.resolve()

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'run-cleanups.json')) {}

  /**
   * Read-modify-write under the cross-process lock.
   *
   * Two Host processes can share one DSH_HOME — an upgrade overlap, `verify:profile`
   * beside a live instance, e2e beside a real one. Without this, each holds its own
   * view and the later writer erases the earlier one's responsibilities, with no
   * reconciliation able to notice, because reconciliation reads the same view.
   */
  private async mutate(operation: () => boolean): Promise<void> {
    await withWorkspaceFileLock(this.path, async () => {
      await this.load()
      if (!operation()) return
      await this.persist()
    })
  }

  async apply(fingerprint: string, event: PactFlowRunCleanupEvent): Promise<void> {
    await this.mutate(() => {
      const existing = this.records.get(event.jobName)
      if (event.phase === 'intent') {
        this.records.set(event.jobName, {
          jobName: event.jobName, fingerprint, createdAt: new Date().toISOString(),
          ...(event.childNames.length === 0 ? {} : { plannedChildNames: [...event.childNames] }),
        })
      } else if (event.phase === 'confirmed') {
        if (existing === undefined) {
          throw new Error(`PactFlow Run cleanup responsibility for "${event.jobName}" was not persisted before creation`)
        }
        this.records.set(event.jobName, { ...existing, jobUid: event.jobUid, children: event.children })
      } else {
        this.records.delete(event.jobName)
      }
      return true
    })
  }

  async list(): Promise<readonly PactFlowRunCleanupRecord[]> {
    await this.load()
    return [...this.records.values()]
  }

  async remove(jobName: string): Promise<void> {
    await this.mutate(() => this.records.delete(jobName))
  }

  private async persist(): Promise<void> {
    // `.then(onFulfilled)` on a rejected promise never runs its callback, so a
    // single failed write used to poison the chain for the rest of the process:
    // every later apply() rejected with the same stale error and nothing was ever
    // recorded again. Recover the chain either way, and surface this write's own
    // outcome to this caller.
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid.toString(36)}.${randomBytes(6).toString('hex')}.tmp`
      // `wx` refuses to follow a pre-placed symlink and refuses a concurrent
      // writer's temporary file rather than interleaving with it.
      await writeFile(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    })
    this.writes = write.catch(() => undefined)
    await write
  }

  private async load(): Promise<void> {
    // Read from disk every time. A permanently cached view plus a whole-file
    // rewrite meant a second Host process on the same DSH_HOME silently erased
    // the first one's responsibilities.
    this.loaded = (async () => {
      this.records = new Map()
      let text: string
      try {
        text = await readFile(this.path, 'utf8')
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      let parsed: unknown
      try {
        parsed = JSON.parse(text) as unknown
      } catch {
        throw new Error('PactFlow run cleanup ledger is corrupted; recorded responsibilities are not discarded')
      }
      if (!Array.isArray(parsed)) throw new Error('PactFlow run cleanup ledger is corrupted; recorded responsibilities are not discarded')
      // A record this version cannot read is not a record to drop: `persist()`
      // rewrites the whole file, so skipping one deletes it, silently, and the
      // cluster resources it named lose their owner. Adding a required field is
      // enough to trigger it — that is exactly how `fingerprint` was introduced.
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
          throw new Error('PactFlow run cleanup ledger holds an unreadable record; recorded responsibilities are not discarded')
        }
        const record = item as Partial<PactFlowRunCleanupRecord>
        if (typeof record.jobName !== 'string' || record.jobName.trim() === ''
          || typeof record.fingerprint !== 'string' || record.fingerprint.trim() === ''
          || typeof record.createdAt !== 'string') {
          throw new Error('PactFlow run cleanup ledger holds an unreadable record; recorded responsibilities are not discarded')
        }
        const plannedChildNames = Array.isArray(record.plannedChildNames)
          && record.plannedChildNames.every(name => typeof name === 'string' && name.trim() !== '')
          ? [...record.plannedChildNames] : undefined
        this.records.set(record.jobName, {
          jobName: record.jobName,
          fingerprint: record.fingerprint,
          createdAt: record.createdAt,
          ...(plannedChildNames === undefined ? {} : { plannedChildNames }),
          ...(typeof record.jobUid === 'string' && record.jobUid.trim() !== '' ? { jobUid: record.jobUid } : {}),
          ...(() => {
            const children = sanitizeChildren(record.children)
            return children === undefined ? {} : { children }
          })(),
        })
      }
    })()
    await this.loaded
  }
}
