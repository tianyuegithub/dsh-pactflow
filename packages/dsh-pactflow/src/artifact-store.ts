/**
 * Minimal S3-compatible artifact store client: hand-written SigV4, path-style
 * addressing, exactly four operations (PutObject/GetObject/HeadObject/
 * ListObjectsV2). The endpoint comes only from the admin-configured binding;
 * artifact refs are opaque identifiers and never drive request targets, so a
 * ref cannot turn this client into an arbitrary-address fetch.
 */

import { createHash, createHmac, randomBytes } from 'node:crypto'

export interface PactFlowArtifactStoreConfig {
  /** Admin-configured base URL (http/https). Never derived from a ref. */
  readonly endpoint: string
  readonly bucket: string
  readonly region: string
  /** Resolved at call time from the credential service; never persisted. */
  readonly accessKeyId: string
  readonly secretAccessKey: string
}

/** Summary limits are part of the address contract: bounded on both lines and bytes. */
export const PACTFLOW_ARTIFACT_SUMMARY_MAX_LINES = 10
export const PACTFLOW_ARTIFACT_SUMMARY_MAX_BYTES = 1024

/** Structured, credential-free address for one immutable stored object. */
export interface PactFlowArtifactRef {
  /** Opaque identifier `s3://<bucket>/<key>`; resolution stays inside the binding. */
  readonly uri: string
  readonly etag: string
  readonly bytes: number
  /** sha256 hex of the object content. */
  readonly hash: string
  readonly kind: string
  readonly summary: string
  /** Present whenever the backend returned one; never silently dropped. */
  readonly versionId?: string
}

export type PactFlowArtifactStoreErrorCode =
  | 'out-of-binding' | 'unreachable' | 'missing' | 'conflict' | 'corrupt'
  | 'invalid-response' | 'request-failed'

/** Oversize gate: every bounded channel rejects oversized inline payloads with this code. */
export const PACTFLOW_ARTIFACT_OVERSIZE_CODE = 'pactflow.artifact.oversize'

/**
 * Per-channel inline thresholds. Each default MUST NOT exceed the channel's own
 * hard limit: the result document shares the kubelet termination-message 4 KiB
 * cap (so its budget stays well below it), bridge frames die at 64 KiB, the
 * interaction schema caps fields at 16 000 characters, and event outcome text
 * is governed by the run budget's single authority (`maxOutputBytes`).
 */
export type PactFlowBoundedChannel =
  | 'result-document' | 'bridge-frame' | 'interaction-request' | 'event-payload' | 'attachment'

export const PACTFLOW_CHANNEL_LIMITS: Readonly<Record<PactFlowBoundedChannel, number>> = {
  'result-document': 3 * 1024,
  'bridge-frame': 32 * 1024,
  'interaction-request': 8_000,
  'event-payload': 4_096,
  /**
   * Attachment bytes travel as a Remote parameter, the same lane DSH itself uses
   * for encoded image attachments. The transport was measured rather than assumed
   * (`scripts/measure-remote-payload-ceiling.mjs`): 256 MiB went through in 3.1s
   * with no refusal, and the next rung fails inside V8 string construction, not in
   * the channel. So the transport is not the binding constraint and this number is
   * a policy choice.
   *
   * 32 MiB, for three reasons. Latency: 432ms round-trip, still interactive, while
   * the next rung up already feels stalled. Memory: the whole payload is resident
   * on both client and host at once, so the real cost is several times this.
   * And failure shape — the one that decides it: 32 MiB sits an order of magnitude
   * below every measured or structural limit, so exceeding it is always OUR refusal
   * with our own message, never V8's `Invalid string length` or an opaque transport
   * error. The contract promises a local pre-send refusal carrying an oversize code
   * and guidance; that promise only holds while the threshold stays far from the
   * hard limits.
   */
  attachment: 32 * 1024 * 1024,
}

export function pactFlowArtifactOversizeError(channel: PactFlowBoundedChannel, bytes: number, limit?: number): Error {
  const cap = limit ?? PACTFLOW_CHANNEL_LIMITS[channel]
  return new Error(
    `${PACTFLOW_ARTIFACT_OVERSIZE_CODE}: ${channel} payload is ${String(bytes)} bytes, over its ${String(cap)} byte limit; externalize the content via the artifact store and pass its artifactRef instead`,
  )
}

/** Reject oversized inline payloads on a bounded channel (fail-closed gate). */
export function assertWithinChannelLimit(channel: PactFlowBoundedChannel, bytes: number, limit?: number): void {
  const cap = limit ?? PACTFLOW_CHANNEL_LIMITS[channel]
  if (!Number.isSafeInteger(bytes) || bytes < 0) throw new Error(`PactFlow ${channel} payload byte count is invalid`)
  if (bytes > cap) throw pactFlowArtifactOversizeError(channel, bytes, cap)
}

const REF_URI = /^s3:\/\/[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]\/\S+$/

/**
 * Validate an untrusted structured artifactRef (channel payloads, result
 * documents). Invalid refs never enter a channel: the address contract is
 * enforceable only if every ref a consumer can see is well-formed.
 */
export function parsePactFlowArtifactRef(value: unknown): PactFlowArtifactRef {
  if (typeof value !== 'object' || value === null) throw new Error('PactFlow artifact ref payload is not an object')
  const raw = value as Record<string, unknown>
  if (typeof raw.uri !== 'string' || !REF_URI.test(raw.uri)) throw new Error('PactFlow artifact ref uri is invalid')
  if (typeof raw.etag !== 'string' || !ETag.test(raw.etag)) throw new Error('PactFlow artifact ref etag is invalid')
  if (typeof raw.bytes !== 'number' || !Number.isSafeInteger(raw.bytes) || raw.bytes < 1) throw new Error('PactFlow artifact ref bytes is invalid')
  if (typeof raw.hash !== 'string' || !SHA256_HEX.test(raw.hash)) throw new Error('PactFlow artifact ref hash is invalid')
  if (typeof raw.kind !== 'string' || raw.kind.trim() === '' || raw.kind.length > 64) throw new Error('PactFlow artifact ref kind is invalid')
  if (typeof raw.summary !== 'string') throw new Error('PactFlow artifact ref summary is invalid')
  if (raw.versionId !== undefined && typeof raw.versionId !== 'string') throw new Error('PactFlow artifact ref versionId is invalid')
  const withoutScheme = raw.uri.slice('s3://'.length)
  const slash = withoutScheme.indexOf('/')
  return makePactFlowArtifactRef({
    bucket: withoutScheme.slice(0, slash),
    key: withoutScheme.slice(slash + 1),
    etag: raw.etag, bytes: raw.bytes, hash: raw.hash, kind: raw.kind, summary: raw.summary,
    ...(raw.versionId === undefined ? {} : { versionId: raw.versionId }),
  })
}

export class PactFlowArtifactStoreError extends Error {
  constructor(readonly code: PactFlowArtifactStoreErrorCode, readonly status: number, detail: string) {
    super(`PactFlow artifact store ${code} (HTTP ${String(status)})${detail.length === 0 ? '' : `: ${detail}`}`)
  }
}

const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/
const OBJECT_KEY_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/

/** Shared bucket-name rule for settings validation and ref construction. */
export function validArtifactBucket(bucket: string): boolean {
  return BUCKET_NAME.test(bucket)
}
const SHA256_HEX = /^[0-9a-f]{64}$/
const ETag = /^"(?:[0-9a-f]{32}|[0-9a-f]{64})"$/

function sha256Hex(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

function toBytes(content: Uint8Array | string): Uint8Array {
  return typeof content === 'string' ? new TextEncoder().encode(content) : content
}

/** SigV4 URI encoding: unreserved characters stay literal, everything else is percent-encoded. */
function uriEncodePath(value: string): string {
  return value.split('/').map(segment => encodeURIComponent(segment).replace(/[!'()*]/g, ch => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)).join('/')
}

function canonicalQueryString(query: Readonly<Record<string, string>>): string {
  return Object.keys(query).sort().map(key => `${encodeURIComponent(key)}=${encodeURIComponent(query[key]!)}`).join('&')
}

/** Build the address-contract object; an invalid combination must not be constructible. */
export function makePactFlowArtifactRef(input: {
  readonly bucket: string
  readonly key: string
  readonly etag: string
  readonly bytes: number
  readonly hash: string
  readonly kind: string
  readonly summary: string
  readonly versionId?: string
}): PactFlowArtifactRef {
  if (!BUCKET_NAME.test(input.bucket)) throw new Error('PactFlow artifact ref bucket is invalid')
  if (!validObjectKey(input.key)) throw new Error('PactFlow artifact ref key is invalid')
  if (!ETag.test(input.etag)) throw new Error('PactFlow artifact ref etag is invalid')
  if (!Number.isSafeInteger(input.bytes) || input.bytes < 1) throw new Error('PactFlow artifact ref bytes is invalid')
  if (!SHA256_HEX.test(input.hash)) throw new Error('PactFlow artifact ref hash is invalid')
  if (input.kind.trim() === '' || input.kind.length > 64) throw new Error('PactFlow artifact ref kind is invalid')
  const lines = input.summary.split('\n')
  if (input.summary.includes('\r') || lines.length > PACTFLOW_ARTIFACT_SUMMARY_MAX_LINES
    || Buffer.byteLength(input.summary, 'utf8') > PACTFLOW_ARTIFACT_SUMMARY_MAX_BYTES || input.summary.trim() === '') {
    throw new Error(`PactFlow artifact ref summary must be at most ${String(PACTFLOW_ARTIFACT_SUMMARY_MAX_LINES)} lines and ${String(PACTFLOW_ARTIFACT_SUMMARY_MAX_BYTES)} bytes`)
  }
  if (input.versionId !== undefined && input.versionId.trim() === '') throw new Error('PactFlow artifact ref versionId cannot be empty when present')
  return {
    uri: `s3://${input.bucket}/${input.key}`,
    etag: input.etag, bytes: input.bytes, hash: input.hash, kind: input.kind, summary: input.summary,
    ...(input.versionId === undefined ? {} : { versionId: input.versionId }),
  }
}

/** Keys are slash-separated restricted segments; no `..`, no absolute tricks. */
export function validObjectKey(key: string): boolean {
  if (!key.includes('/')) return false
  return key.split('/').every(segment => OBJECT_KEY_SEGMENT.test(segment))
}

/**
 * Object key with an unpredictable random segment so a concurrent or later run
 * can never target a predictable name; the immutability check still rejects
 * the (practically impossible) collision instead of overwriting.
 */
export function pactFlowArtifactObjectKey(input: {
  readonly needId: string
  readonly runId: string
  readonly seq: number
  readonly kind: string
  readonly sender: string
}): string {
  const parts = [input.needId, input.runId, `${String(input.seq)}-${input.kind}-${input.sender}-${randomBytes(9).toString('hex')}`]
  if (!validObjectKey(parts.join('/'))) throw new Error('PactFlow artifact key inputs are invalid')
  return parts.join('/')
}

interface PutOutcome {
  readonly etag: string
  readonly versionId?: string
}

interface HeadOutcome {
  readonly etag: string
  readonly bytes: number
  readonly versionId?: string
}

export class PactFlowArtifactStoreClient {
  private readonly origin: string
  private readonly hostHeader: string

  constructor(private readonly config: PactFlowArtifactStoreConfig, private readonly now: () => number = Date.now) {
    const endpoint = new URL(config.endpoint)
    if (endpoint.protocol !== 'http:' && endpoint.protocol !== 'https:') {
      throw new Error('PactFlow artifact store endpoint must be http(s)')
    }
    this.origin = endpoint.origin
    this.hostHeader = endpoint.host
  }

  /**
   * Provisioning/acceptance helper: create the bound bucket if absent. NOT part
   * of the handoff protocol operation set (put/get/head/list) — the protocol
   * assumes an existing bucket; this exists for ops setup and real-path tests.
   */
  async createBucket(): Promise<void> {
    const response = await this.request('PUT', '', {})
    if (response.ok || response.status === 409) return
    throw await this.requestError(response)
  }

  /** Put one immutable object; an existing key is a conflict, never an overwrite. */
  async putObject(key: string, content: Uint8Array | string): Promise<PutOutcome> {
    if (!validObjectKey(key)) throw new Error('PactFlow artifact store object key is invalid')
    const existing = await this.headOrUndefined(key)
    if (existing !== undefined) throw new PactFlowArtifactStoreError('conflict', 409, `object ${key} already exists`)
    const body = toBytes(content)
    const response = await this.request('PUT', key, {}, body)
    if (!response.ok) throw await this.requestError(response)
    const etag = response.headers.get('etag') ?? ''
    if (!ETag.test(etag)) throw new PactFlowArtifactStoreError('invalid-response', response.status, 'PUT returned no valid ETag')
    const versionId = response.headers.get('x-amz-version-id') ?? undefined
    return { etag, ...(versionId === undefined ? {} : { versionId }) }
  }

  async getObject(key: string, versionId?: string): Promise<Uint8Array> {
    const query: Record<string, string> = versionId === undefined ? {} : { versionId }
    const response = await this.request('GET', key, query)
    if (response.status === 404) throw await this.requestError(response, 'missing')
    if (!response.ok) throw await this.requestError(response)
    return new Uint8Array(await response.arrayBuffer())
  }

  async headObject(key: string): Promise<HeadOutcome> {
    const outcome = await this.headOrUndefined(key)
    if (outcome === undefined) throw new PactFlowArtifactStoreError('missing', 404, `object ${key} does not exist`)
    return outcome
  }

  /** List object keys under a prefix, following continuation tokens. */
  async listObjectKeys(prefix: string, maxTotal = 10_000): Promise<string[]> {
    const entries = await this.listObjects(prefix, maxTotal)
    return entries.map(entry => entry.key)
  }

  /** List objects with size and last-modified (retention ledger needs real occupancy). */
  async listObjects(prefix: string, maxTotal = 10_000): Promise<Array<{ readonly key: string; readonly bytes: number; readonly lastModifiedMs: number }>> {
    const entries: Array<{ readonly key: string; readonly bytes: number; readonly lastModifiedMs: number }> = []
    let continuation: string | undefined
    do {
      const query: Record<string, string> = { 'list-type': '2', 'max-keys': '1000', prefix }
      if (continuation !== undefined) query['continuation-token'] = continuation
      const response = await this.request('GET', '', query)
      if (!response.ok) throw await this.requestError(response)
      const xml = await response.text()
      const contents = xml.match(/<Contents>[\s\S]*?<\/Contents>/g) ?? []
      for (const block of contents) {
        const key = block.match(/<Key>([^<]+)<\/Key>/)?.[1]
        if (key === undefined) continue
        const bytes = Number(block.match(/<Size>(\d+)<\/Size>/)?.[1] ?? '0')
        const lastModifiedRaw = block.match(/<LastModified>([^<]+)<\/LastModified>/)?.[1]
        const lastModifiedMs = lastModifiedRaw === undefined ? Number.NaN : Date.parse(lastModifiedRaw)
        entries.push({ key, bytes: Number.isSafeInteger(bytes) ? bytes : 0, lastModifiedMs })
      }
      if (entries.length > maxTotal) throw new PactFlowArtifactStoreError('invalid-response', 200, 'object listing exceeded the maximum count')
      continuation = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1]
    } while (continuation !== undefined)
    return entries
  }

  /** The bucket this client is bound to; needed to turn listed keys into refs. */
  get bucket(): string { return this.config.bucket }

  /** Resolve a ref inside this binding and verify integrity; never a generic URL fetch. */
  async resolveArtifact(ref: PactFlowArtifactRef): Promise<Uint8Array> {
    const key = this.boundKey(ref)
    const content = await this.getObject(key, ref.versionId)
    if (content.byteLength !== ref.bytes
      || sha256Hex(content) !== ref.hash) {
      throw new PactFlowArtifactStoreError('corrupt', 200, `object ${key} does not match its ref bytes/hash`)
    }
    return content
  }

  /**
   * Upload content and return the address-contract ref in one step. The
   * optional gate runs before any network traffic; a gate failure means no
   * object is created (fail-closed redaction boundary).
   */
  async putArtifact(input: {
    readonly key: string
    readonly content: Uint8Array | string
    readonly kind: string
    readonly summary: string
    readonly uploadGate?: (content: string) => void
  }): Promise<PactFlowArtifactRef> {
    const body = toBytes(input.content)
    if (input.uploadGate !== undefined) input.uploadGate(new TextDecoder('utf-8', { fatal: false }).decode(body))
    const outcome = await this.putObject(input.key, body)
    return makePactFlowArtifactRef({
      bucket: this.config.bucket, key: input.key, etag: outcome.etag, bytes: body.byteLength,
      hash: sha256Hex(body), kind: input.kind, summary: input.summary,
      ...(outcome.versionId === undefined ? {} : { versionId: outcome.versionId }),
    })
  }

  /** Parse `s3://<bucket>/<key>` and fail closed unless it names this binding's bucket. */
  private boundKey(ref: PactFlowArtifactRef): string {
    const match = ref.uri.match(/^s3:\/\/([^/]+)\/(.+)$/)
    if (match === null || match[1] !== this.config.bucket || !validObjectKey(match[2]!)) {
      throw new PactFlowArtifactStoreError('out-of-binding', 0, `artifact ref ${ref.uri} does not name the bound bucket`)
    }
    return match[2]!
  }

  private async headOrUndefined(key: string): Promise<HeadOutcome | undefined> {
    const response = await this.request('HEAD', key, {})
    if (response.status === 404) return undefined
    if (!response.ok) throw await this.requestError(response)
    const etag = response.headers.get('etag') ?? ''
    const bytes = Number(response.headers.get('content-length') ?? Number.NaN)
    if (!ETag.test(etag) || !Number.isSafeInteger(bytes) || bytes < 0) {
      throw new PactFlowArtifactStoreError('invalid-response', response.status, 'HEAD returned no valid identity')
    }
    const versionId = response.headers.get('x-amz-version-id') ?? undefined
    return { etag, bytes, ...(versionId === undefined ? {} : { versionId }) }
  }

  private async request(
    method: 'GET' | 'HEAD' | 'PUT',
    key: string,
    query: Readonly<Record<string, string>>,
    body?: Uint8Array,
  ): Promise<Response> {
    const payload = body ?? new Uint8Array(0)
    const payloadHash = sha256Hex(payload)
    const iso = new Date(this.now()).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
    const dateShort = iso.slice(0, 8)
    const path = uriEncodePath(`/${this.config.bucket}/${key}`)
    const signedQuery = canonicalQueryString(query)
    const canonicalHeaders = `host:${this.hostHeader}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${iso}\n`
    const signedHeaders = 'host;x-amz-content-sha256;x-amz-date'
    const canonicalRequest = [method, path, signedQuery, canonicalHeaders, signedHeaders, payloadHash].join('\n')
    const scope = `${dateShort}/${this.config.region}/s3/aws4_request`
    const stringToSign = ['AWS4-HMAC-SHA256', iso, scope, sha256Hex(new TextEncoder().encode(canonicalRequest))].join('\n')
    const dateKey = createHmac('sha256', `AWS4${this.config.secretAccessKey}`).update(dateShort).digest()
    const regionKey = createHmac('sha256', dateKey).update(this.config.region).digest()
    const serviceKey = createHmac('sha256', regionKey).update('s3').digest()
    const signingKey = createHmac('sha256', serviceKey).update('aws4_request').digest()
    const signature = createHmac('sha256', signingKey).update(stringToSign).digest('hex')
    const authorization = `AWS4-HMAC-SHA256 Credential=${this.config.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
    const target = new URL(this.origin)
    target.pathname = path
    if (signedQuery.length > 0) target.search = signedQuery
    let response: Response
    try {
      response = await fetch(target, {
        method,
        headers: { authorization, 'x-amz-content-sha256': payloadHash, 'x-amz-date': iso },
        ...(method === 'PUT' ? { body: payload as BodyInit } : {}),
        redirect: 'manual',
        signal: AbortSignal.timeout(20_000),
      })
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new PactFlowArtifactStoreError('unreachable', 0, 'request timed out')
      }
      throw new PactFlowArtifactStoreError('unreachable', 0, 'could not connect to the configured artifact store')
    }
    if (response.status >= 300 && response.status < 400) {
      throw new PactFlowArtifactStoreError('request-failed', response.status, 'redirect refused; the credential stays bound to the configured endpoint')
    }
    return response
  }

  private async requestError(response: Response, code?: PactFlowArtifactStoreErrorCode): Promise<PactFlowArtifactStoreError> {
    const detail = response.headers.get('content-type')?.includes('xml') === true
      ? (await response.text()).match(/<Code>([^<]+)<\/Code>/)?.[1] ?? ''
      : ''
    const mapped: PactFlowArtifactStoreErrorCode = code
      ?? (response.status === 404 ? 'missing' : response.status === 403 ? 'request-failed' : response.status === 409 ? 'conflict' : 'request-failed')
    return new PactFlowArtifactStoreError(mapped, response.status, detail)
  }
}
