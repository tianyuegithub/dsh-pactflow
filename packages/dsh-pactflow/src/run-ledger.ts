import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
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

  async apply(fingerprint: string, event: PactFlowRunCleanupEvent): Promise<void> {
    await this.load()
    const existing = this.records.get(event.jobName)
    if (event.phase === 'intent') {
      this.records.set(event.jobName, {
        jobName: event.jobName, fingerprint, createdAt: new Date().toISOString(),
      })
    } else if (event.phase === 'confirmed') {
      if (existing === undefined) {
        throw new Error(`PactFlow Run cleanup responsibility for "${event.jobName}" was not persisted before creation`)
      }
      this.records.set(event.jobName, { ...existing, jobUid: event.jobUid, children: event.children })
    } else {
      this.records.delete(event.jobName)
    }
    await this.persist()
  }

  async list(): Promise<readonly PactFlowRunCleanupRecord[]> {
    await this.load()
    return [...this.records.values()]
  }

  async remove(jobName: string): Promise<void> {
    await this.load()
    if (!this.records.delete(jobName)) return
    await this.persist()
  }

  private async persist(): Promise<void> {
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    await this.writes
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
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
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as Partial<PactFlowRunCleanupRecord>
        if (typeof record.jobName !== 'string' || record.jobName.trim() === ''
          || typeof record.fingerprint !== 'string' || record.fingerprint.trim() === ''
          || typeof record.createdAt !== 'string') continue
        this.records.set(record.jobName, {
          jobName: record.jobName,
          fingerprint: record.fingerprint,
          createdAt: record.createdAt,
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
