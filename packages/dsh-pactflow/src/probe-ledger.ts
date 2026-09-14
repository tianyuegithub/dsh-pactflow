import { randomBytes } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { withWorkspaceFileLock } from './workspace-lock.ts'
import type { PactFlowProbeCleanupEvent } from './k3s-worker.ts'

export interface PactFlowProbeCleanupRecord {
  readonly jobName: string
  readonly kind: 'harness' | 'api' | 'image'
  /** Non-secret connection identity of the provider that created the resources. */
  readonly fingerprint: string
  readonly createdAt: string
  readonly jobUid?: string
  readonly secretName?: string
  readonly secretUid?: string
}

const KINDS: ReadonlySet<string> = new Set(['harness', 'api', 'image'])

/** Plugin-owned durable probe cleanup responsibility; never stores credentials. */
export class PactFlowProbeCleanupLedger {
  private records = new Map<string, PactFlowProbeCleanupRecord>()
  private loaded: Promise<void> | undefined
  private writes = Promise.resolve()

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'probe-cleanups.json')) {}

  async apply(
    kind: PactFlowProbeCleanupRecord['kind'],
    fingerprint: string,
    event: PactFlowProbeCleanupEvent,
  ): Promise<void> {
    await this.mutate(() => {
      const existing = this.records.get(event.jobName)
      if (event.phase === 'intent') {
        this.records.set(event.jobName, {
          jobName: event.jobName, kind, fingerprint, createdAt: new Date().toISOString(),
          ...(event.secretName === undefined ? {} : { secretName: event.secretName }),
        })
      } else if (event.phase === 'confirmed') {
        if (existing === undefined) {
          throw new Error(`PactFlow probe cleanup responsibility for "${event.jobName}" was not persisted before creation`)
        }
        this.records.set(event.jobName, {
          ...existing,
          jobUid: event.jobUid,
          ...(event.secretName === undefined ? {} : { secretName: event.secretName, secretUid: event.secretUid }),
        })
      } else {
        this.records.delete(event.jobName)
      }
      return true
    })
  }

  /** Read-modify-write under the cross-process lock. See PactFlowRunCleanupLedger.mutate. */
  private async mutate(operation: () => boolean): Promise<void> {
    await withWorkspaceFileLock(this.path, async () => {
      await this.load()
      if (!operation()) return
      await this.persist()
    })
  }

  async list(): Promise<readonly PactFlowProbeCleanupRecord[]> {
    await this.load()
    return [...this.records.values()]
  }

  async remove(jobName: string): Promise<void> {
    await this.mutate(() => this.records.delete(jobName))
  }

  private async persist(): Promise<void> {
    // See PactFlowRunCleanupLedger.persist: a rejected chain must not poison every
    // later write, and the temporary name must not be guessable or shared.
    const write = this.writes.catch(() => undefined).then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.${process.pid.toString(36)}.${randomBytes(6).toString('hex')}.tmp`
      await writeFile(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, { mode: 0o600, flag: 'wx' })
      await rename(temporary, this.path)
    })
    this.writes = write.catch(() => undefined)
    await write
  }

  private async load(): Promise<void> {
    // Always from disk; see PactFlowRunCleanupLedger.load.
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
        throw new Error('PactFlow probe cleanup ledger is corrupted; recorded responsibilities are not discarded')
      }
      if (!Array.isArray(parsed)) {
        throw new Error('PactFlow probe cleanup ledger is corrupted; recorded responsibilities are not discarded')
      }
      // Dropping an unreadable record deletes it on the next write; see
      // PactFlowRunCleanupLedger.load for why that is the worse failure.
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) {
          throw new Error('PactFlow probe cleanup ledger holds an unreadable record; recorded responsibilities are not discarded')
        }
        const record = item as Partial<PactFlowProbeCleanupRecord>
        if (typeof record.jobName !== 'string' || record.jobName.trim() === ''
          || typeof record.fingerprint !== 'string' || record.fingerprint.trim() === ''
          || typeof record.kind !== 'string' || !KINDS.has(record.kind)
          || typeof record.createdAt !== 'string') {
          throw new Error('PactFlow probe cleanup ledger holds an unreadable record; recorded responsibilities are not discarded')
        }
        this.records.set(record.jobName, {
          jobName: record.jobName,
          kind: record.kind as PactFlowProbeCleanupRecord['kind'],
          fingerprint: record.fingerprint,
          createdAt: record.createdAt,
          ...(typeof record.jobUid === 'string' && record.jobUid.trim() !== '' ? { jobUid: record.jobUid } : {}),
          ...(typeof record.secretName === 'string' && record.secretName.trim() !== '' ? { secretName: record.secretName } : {}),
          ...(typeof record.secretUid === 'string' && record.secretUid.trim() !== '' ? { secretUid: record.secretUid } : {}),
        })
      }
    })()
    await this.loaded
  }
}
