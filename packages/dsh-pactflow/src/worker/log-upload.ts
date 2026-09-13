/**
 * Worker-side execution log externalization (artifact-ref-handoff).
 *
 * Runs inside the worker container: uploads the full execution log to the
 * bound artifact store and returns the ref JSON for the result document.
 * Unbound runs (no PACTFLOW_ARTIFACT_* env) return undefined — the caller
 * keeps today's behavior. The redaction gate runs before any network
 * traffic; a gate rejection means NO object is created and the caller must
 * treat the log as degraded (never upload after redacting silently).
 */

import { PactFlowArtifactStoreClient } from '../artifact-store.ts'
import { assertArtifactUploadSafe } from './redact.ts'

export interface PactFlowWorkerArtifactEnv {
  readonly endpoint: string
  readonly bucket: string
  readonly region?: string
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

/** Collect the injected artifact store env; undefined = this run is unbound. */
export function artifactStoreEnv(env: NodeJS.ProcessEnv = process.env): PactFlowWorkerArtifactEnv | undefined {
  const endpoint = env.PACTFLOW_ARTIFACT_ENDPOINT
  const bucket = env.PACTFLOW_ARTIFACT_BUCKET
  const accessKeyId = env.PACTFLOW_ARTIFACT_ACCESS_KEY_ID
  const secretAccessKey = env.PACTFLOW_ARTIFACT_SECRET_ACCESS_KEY
  if (endpoint === undefined || bucket === undefined || accessKeyId === undefined || secretAccessKey === undefined) return undefined
  return { endpoint, bucket, ...(env.PACTFLOW_ARTIFACT_REGION === undefined ? {} : { region: env.PACTFLOW_ARTIFACT_REGION }), accessKeyId, secretAccessKey }
}

/** One-line, byte-bounded summary for the log ref. */
export function logSummary(content: string): string {
  const firstLine = content.split('\n').find(line => line.trim() !== '') ?? '(empty log)'
  const bytes = Buffer.from(firstLine, 'utf8')
  return bytes.byteLength > 1024 ? bytes.subarray(0, 1024).toString('utf8') : firstLine
}

/**
 * Upload the full execution log and return the artifactRef as JSON (to be
 * embedded into the result document), or undefined when the run is unbound.
 * Upload failures propagate: the caller keeps the degraded path and must not
 * claim a full log.
 */
export async function uploadWorkerLog(input: {
  readonly key: string
  readonly content: string
  readonly env?: NodeJS.ProcessEnv
  readonly knownSecrets?: readonly string[]
  readonly client?: PactFlowArtifactStoreClient
}): Promise<string | undefined> {
  const store = artifactStoreEnv(input.env)
  if (store === undefined) return undefined
  const client = input.client ?? new PactFlowArtifactStoreClient({
    endpoint: store.endpoint, bucket: store.bucket, region: store.region ?? 'us-east-1',
    accessKeyId: store.accessKeyId, secretAccessKey: store.secretAccessKey,
  })
  // Known host-issued secrets were already redacted from the log upstream;
  // the gate still refuses anything carrying unknown credential patterns.
  assertArtifactUploadSafe(input.content, input.knownSecrets ?? [])
  const ref = await client.putArtifact({
    key: input.key, content: input.content, kind: 'execution-log', summary: logSummary(input.content),
  })
  return JSON.stringify(ref)
}
