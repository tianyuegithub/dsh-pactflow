import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
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
    await this.load()
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
    await this.persist()
  }

  async list(): Promise<readonly PactFlowProbeCleanupRecord[]> {
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
        throw new Error('PactFlow probe cleanup ledger is corrupted; recorded responsibilities are not discarded')
      }
      if (!Array.isArray(parsed)) {
        throw new Error('PactFlow probe cleanup ledger is corrupted; recorded responsibilities are not discarded')
      }
      for (const item of parsed) {
        if (typeof item !== 'object' || item === null) continue
        const record = item as Partial<PactFlowProbeCleanupRecord>
        if (typeof record.jobName !== 'string' || record.jobName.trim() === ''
          || typeof record.fingerprint !== 'string' || record.fingerprint.trim() === ''
          || typeof record.kind !== 'string' || !KINDS.has(record.kind)
          || typeof record.createdAt !== 'string') {
          continue
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
