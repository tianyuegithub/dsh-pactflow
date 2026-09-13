import { describe, expect, it } from 'vitest'
import { randomUUID } from 'node:crypto'
import { PactFlowArtifactStoreClient, PactFlowArtifactStoreError } from '../src/artifact-store.ts'

/**
 * Real-path acceptance against the live cluster RustFS (task 2.3). Skipped
 * unless every PACTFLOW_REAL_ARTIFACT_* variable is present; credentials come
 * from the environment only (never argv literals, never persisted).
 */
const endpoint = process.env.PACTFLOW_REAL_ARTIFACT_ENDPOINT
const bucket = process.env.PACTFLOW_REAL_ARTIFACT_BUCKET
const accessKeyId = process.env.PACTFLOW_REAL_ARTIFACT_ACCESS_KEY
const secretAccessKey = process.env.PACTFLOW_REAL_ARTIFACT_SECRET_KEY
const ready = endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined

describe.skipIf(!ready)('PactFlow artifact store real-path acceptance', () => {
  const client = () => new PactFlowArtifactStoreClient({
    endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
    accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
  })
  const key = `pactflow-acceptance/${randomUUID()}/0-log-acceptance-${randomUUID().slice(0, 8)}.txt`
  const content = `real-path acceptance ${new Date().toISOString()}\n`.repeat(40)

  it('provisions the bucket if absent, then puts, heads, lists, gets, and resolves', async () => {
    const store = client()
    await store.createBucket()
    const ref = await store.putArtifact({ key, content, kind: 'acceptance-log', summary: 'real RustFS round-trip' })
    expect(ref.bytes).toBe(Buffer.byteLength(content, 'utf8'))

    const head = await store.headObject(key)
    expect(head.bytes).toBe(ref.bytes)
    expect(head.etag).toBe(ref.etag)
    // Record the observed backend capability honestly: does it return version ids?
    process.stdout.write(`observation: backend versionId present = ${String(head.versionId !== undefined)}\n`)

    const listed = await store.listObjects('pactflow-acceptance/')
    expect(listed.some(entry => entry.key === key)).toBe(true)
    expect(listed.find(entry => entry.key === key)?.bytes).toBe(ref.bytes)
    process.stdout.write(`observation: ListObjectsV2 prefix listing works, entries=${String(listed.length)}\n`)

    const resolved = await store.resolveArtifact(ref)
    expect(Buffer.from(resolved).toString('utf8')).toBe(content)

    // Immutability gate: a second write to the same key is a conflict.
    await expect(store.putObject(key, 'overwrite attempt')).rejects.toMatchObject({ code: 'conflict' })
  }, 60_000)

  it('fails closed on a missing object with the typed error', async () => {
    const store = client()
    await expect(store.getObject(`pactflow-acceptance/${randomUUID()}/absent.txt`))
      .rejects.toMatchObject({ code: 'missing' })
    await expect(store.headObject(`pactflow-acceptance/${randomUUID()}/absent.txt`))
      .rejects.toBeInstanceOf(PactFlowArtifactStoreError)
  }, 60_000)
})
