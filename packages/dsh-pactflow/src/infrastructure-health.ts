import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {
  PactFlowInfrastructureHealthRecord,
  PactFlowInfrastructureProbeResult,
  PactFlowInfrastructureResourceKind,
  PactFlowInfrastructureSettings,
} from './types.ts'

function payload(
  settings: PactFlowInfrastructureSettings,
  kind: PactFlowInfrastructureResourceKind,
  id: string,
): unknown {
  if (kind === 'cluster') return settings.clusters.find(item => item.id === id)
  if (kind === 'registry') return settings.registries.find(item => item.id === id)
  if (kind === 'git-provider') return settings.gitProviders.find(item => item.id === id)
  if (kind === 'model-connection') return settings.modelConnections?.find(item => item.id === id)
  if (kind === 'harness') {
    const template = settings.templates.find(item => item.id === id)
    if (template === undefined) return undefined
    return { template, registries: settings.registries, clusters: settings.clusters, pools: settings.workerPools, models: settings.modelConnections ?? [] }
  }
  const pool = settings.workerPools.find(item => item.id === id)
  if (pool === undefined) return undefined
  return { pool, clusters: settings.clusters, registries: settings.registries, templates: settings.templates }
}

export function infrastructureFingerprint(
  settings: PactFlowInfrastructureSettings,
  kind: PactFlowInfrastructureResourceKind,
  id: string,
): string | undefined {
  const value = payload(settings, kind, id)
  return value === undefined ? undefined : createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

/** Plugin-owned durable operational state; never stores credentials or response bodies. */
export class PactFlowInfrastructureHealthStore {
  private records = new Map<string, PactFlowInfrastructureHealthRecord>()
  private loaded: Promise<void> | undefined
  private writes = Promise.resolve()

  constructor(private readonly path = join(resolveDshHome(), 'pactflow', 'infrastructure-health.json')) {}

  async list(settings: PactFlowInfrastructureSettings): Promise<readonly PactFlowInfrastructureHealthRecord[]> {
    await this.load()
    return [...this.records.values()].filter(record => (
      record.probeContractVersion === 2
      &&
      infrastructureFingerprint(settings, record.kind, record.id) === record.fingerprint
    ))
  }

  async record(
    settings: PactFlowInfrastructureSettings,
    result: PactFlowInfrastructureProbeResult,
  ): Promise<PactFlowInfrastructureHealthRecord | undefined> {
    await this.load()
    const fingerprint = infrastructureFingerprint(settings, result.kind, result.id)
    if (fingerprint === undefined) return undefined
    const record: PactFlowInfrastructureHealthRecord = {
      probeContractVersion: 2,
      kind: result.kind, id: result.id, fingerprint,
      state: result.success ? 'succeeded' : 'failed', testedAt: new Date().toISOString(),
      durationMs: result.durationMs, stages: result.stages,
    }
    this.records.set(`${record.kind}:${record.id}`, record)
    this.writes = this.writes.then(async () => {
      await mkdir(dirname(this.path), { recursive: true })
      const temporary = `${this.path}.tmp`
      await writeFile(temporary, `${JSON.stringify([...this.records.values()], null, 2)}\n`, { mode: 0o600 })
      await rename(temporary, this.path)
    })
    await this.writes
    return record
  }

  private async load(): Promise<void> {
    this.loaded ??= (async () => {
      try {
        const parsed = JSON.parse(await readFile(this.path, 'utf8')) as unknown
        // A parse error is already fail-closed below; valid JSON of the wrong
        // shape used to be treated as an empty ledger and overwritten by the next
        // write. Same outcome, silently: the recorded health of every resource
        // gone with nothing said.
        if (!Array.isArray(parsed)) {
          throw new Error('PactFlow infrastructure health ledger is corrupted; recorded results are not discarded')
        }
        for (const item of parsed) {
          if (typeof item !== 'object' || item === null) continue
          const record = item as Partial<PactFlowInfrastructureHealthRecord>
          if (typeof record.kind !== 'string' || typeof record.id !== 'string' || typeof record.fingerprint !== 'string') continue
          if (record.state !== 'succeeded' && record.state !== 'failed') continue
          if (typeof record.testedAt !== 'string' || typeof record.durationMs !== 'number' || !Array.isArray(record.stages)) continue
          this.records.set(`${record.kind}:${record.id}`, record as PactFlowInfrastructureHealthRecord)
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
      }
    })()
    await this.loaded
  }
}
