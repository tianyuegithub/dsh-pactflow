import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  assertWithinChannelLimit, makePactFlowArtifactRef, parsePactFlowArtifactRef,
  PACTFLOW_ARTIFACT_OVERSIZE_CODE, PACTFLOW_CHANNEL_LIMITS,
} from '../src/artifact-store.ts'
import { pactFlowVersionedPayloadSchema } from '../src/schema.ts'
import type { PactFlowInfrastructureResourceKind } from '../src/types.ts'

const validRef = {
  bucket: 'pactflow-artifacts', key: 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt',
  etag: '"0102030405060708090a0b0c0d0e0f10"', bytes: 3,
  hash: 'a'.repeat(64), kind: 'log', summary: 'tail',
}

describe('PactFlow artifact channel gates', () => {
  it('keeps every channel threshold at or under its hard limit', () => {
    expect(PACTFLOW_CHANNEL_LIMITS['result-document']).toBeLessThan(4 * 1024)
    expect(PACTFLOW_CHANNEL_LIMITS['bridge-frame']).toBeLessThanOrEqual(64 * 1024)
    expect(PACTFLOW_CHANNEL_LIMITS['interaction-request']).toBeLessThanOrEqual(16000)
  })

  it('rejects oversized inline payloads with the explicit oversize code and guidance', () => {
    try {
      assertWithinChannelLimit('result-document', 4 * 1024)
      expect.unreachable()
    } catch (error) {
      expect((error as Error).message).toContain(PACTFLOW_ARTIFACT_OVERSIZE_CODE)
      expect((error as Error).message).toContain('artifactRef')
    }
    expect(() => assertWithinChannelLimit('result-document', 1024)).not.toThrow()
  })

  it('honors an explicit budget as the single authority (event payload uses the run budget)', () => {
    expect(() => assertWithinChannelLimit('event-payload', 5_000, 4_096)).toThrow(/oversize/)
    expect(() => assertWithinChannelLimit('event-payload', 4_096, 4_096)).not.toThrow()
  })
})

describe('PactFlow artifactRef wire validation', () => {
  it('accepts a well-formed structured ref and preserves the version id', () => {
    const parsed = parsePactFlowArtifactRef({
      uri: 's3://pactflow-artifacts/need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt',
      etag: validRef.etag, bytes: 3, hash: validRef.hash, kind: 'log', summary: 'tail', versionId: 'v-0001',
    })
    expect(parsed.versionId).toBe('v-0001')
    expect(parsed.uri).toBe('s3://pactflow-artifacts/need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt')
  })

  it('rejects malformed or signed refs before they enter a channel', () => {
    expect(() => parsePactFlowArtifactRef('not-an-object')).toThrow()
    expect(() => parsePactFlowArtifactRef({ ...validRef, uri: 's3://pactflow-artifacts/no-nested-key' })).toThrow()
    expect(() => parsePactFlowArtifactRef({
      ...validRef, uri: `s3://pactflow-artifacts/need-1/run-1/x.txt?sig=${'a'.repeat(32)}`,
    })).toThrow()
    expect(() => parsePactFlowArtifactRef({ ...validRef, etag: 'bare-etag' })).toThrow()
    expect(() => parsePactFlowArtifactRef({ ...validRef, hash: 'short' })).toThrow()
    expect(() => parsePactFlowArtifactRef({ ...validRef, bytes: 0 })).toThrow()
    expect(() => parsePactFlowArtifactRef(undefined)).toThrow()
  })

  it('constructs the canonical ref for producers', () => {
    const ref = makePactFlowArtifactRef(validRef)
    expect(ref.versionId).toBeUndefined()
    expect(ref.uri.startsWith('s3://pactflow-artifacts/')).toBe(true)
  })
})

describe('event payload backward compatibility for artifact refs', () => {
  it('old readers drop unknown payload keys and keep reading new logs', () => {
    // The settlement payload schema is non-strict z.object: an old reader that
    // only knows {v, run, node} must still accept a payload carrying new fields.
    const envelope = pactFlowVersionedPayloadSchema.parse({
      v: 1, run: { id: 'run-1', outcome: 'ok', logArtifact: { uri: 's3://pactflow-artifacts/x/y' } }, node: { id: 'node-1' },
    })
    expect(envelope.v).toBe(1)
    const legacyReader = z.object({ v: z.literal(1) }).parse({
      v: 1, run: { id: 'run-1', logArtifact: { uri: 's3://pactflow-artifacts/x/y' } },
    })
    expect(legacyReader.v).toBe(1)
  })
})

describe('seventh resource kind', () => {
  it('includes the artifact store in the infrastructure resource kinds', () => {
    const kinds: readonly PactFlowInfrastructureResourceKind[] = [
      'cluster', 'registry', 'git-provider', 'harness', 'model-connection', 'worker-pool', 'artifact-store',
    ]
    expect(kinds).toHaveLength(7)
  })
})
