import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { createHash, createHmac } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import {
  makePactFlowArtifactRef, pactFlowArtifactObjectKey,
  PactFlowArtifactStoreClient, PactFlowArtifactStoreError,
} from '../src/artifact-store.ts'

interface FakeObject { readonly content: Buffer; readonly versionId?: string }

/** Isolated fake S3: in-memory objects, optional versioning, page size 2 to force pagination. */
function fakeS3(options: { readonly versioned: boolean }) {
  const objects = new Map<string, FakeObject>()
  let hits = 0
  const server = createServer((request, response) => {
    hits += 1
    if (request.headers.authorization?.startsWith('AWS4-HMAC-SHA256 Credential=test-access-key/') !== true) {
      response.statusCode = 403
      response.setHeader('content-type', 'application/xml')
      response.end('<Error><Code>SignatureDoesNotMatch</Code></Error>')
      return
    }
    const url = new URL(request.url ?? '/', `http://${request.headers.host}`)
    const path = decodeURIComponent(url.pathname)
    const put = request.method === 'PUT'
    if (put || request.method === 'HEAD' || request.method === 'GET') {
      const key = path.replace(/^\/test-bucket\//, '')
      if (key.length > 0 && path.startsWith('/test-bucket/')) {
        if (put) {
          const chunks: Buffer[] = []
          request.on('data', chunk => chunks.push(chunk))
          request.on('end', () => {
            const content = Buffer.concat(chunks)
            const etag = `"${createHash('sha256').update(content).digest('hex')}"`
            const versionId = options.versioned ? `v-${String(objects.size + 1).padStart(4, '0')}` : undefined
            objects.set(key, { content, ...(versionId === undefined ? {} : { versionId }) })
            response.setHeader('etag', etag)
            if (versionId !== undefined) response.setHeader('x-amz-version-id', versionId)
            response.statusCode = 200
            response.end()
          })
          return
        }
        const stored = objects.get(key)
        const wanted = url.searchParams.get('versionId') ?? undefined
        const mismatch = stored === undefined
          || (wanted !== undefined && stored.versionId !== undefined && stored.versionId !== wanted)
        if (mismatch) {
          response.statusCode = 404
          response.setHeader('content-type', 'application/xml')
          response.end('<Error><Code>NoSuchKey</Code></Error>')
          return
        }
        response.setHeader('etag', `"${createHash('sha256').update(stored.content).digest('hex')}"`)
        response.setHeader('content-length', String(stored.content.byteLength))
        if (stored.versionId !== undefined) response.setHeader('x-amz-version-id', stored.versionId)
        response.statusCode = 200
        if (request.method === 'HEAD') response.end()
        else response.end(stored.content)
        return
      }
    }
    if (request.method === 'GET' && (path === '/test-bucket' || path === '/test-bucket/') && url.searchParams.get('list-type') === '2') {
      const prefix = url.searchParams.get('prefix') ?? ''
      const token = url.searchParams.get('continuation-token')
      const matched = [...objects.keys()].filter(key => key.startsWith(prefix)).sort()
      const start = token === null ? 0 : Number(Buffer.from(token, 'base64url').toString('utf8'))
      const page = matched.slice(start, start + 2)
      const next = start + 2 < matched.length ? Buffer.from(String(start + 2), 'utf8').toString('base64url') : null
      response.setHeader('content-type', 'application/xml')
      response.end(`<?xml version="1.0"?><ListBucketResult>${page.map(key => `<Contents><Key>${key}</Key></Contents>`).join('')}${next === null ? '' : `<NextContinuationToken>${next}</NextContinuationToken>`}</ListBucketResult>`)
      return
    }
    response.statusCode = 400
    response.end()
  })
  return {
    objects, hitCount: () => hits,
    async listen(): Promise<string> {
      await new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
      return `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`
    },
    async close(): Promise<void> {
      await new Promise<void>(resolve => server.close(() => resolve()))
    },
  }
}

const FIXED_NOW = () => Date.UTC(2026, 8, 14, 12, 0, 0)

describe('PactFlow artifact store client', () => {
  const closers: Array<() => Promise<void>> = []
  afterEach(async () => { await Promise.all(closers.splice(0).map(close => close())) })

  async function fixture(versioned: boolean, now: () => number = FIXED_NOW) {
    const fake = fakeS3({ versioned })
    const endpoint = await fake.listen()
    closers.push(() => fake.close())
    const client = new PactFlowArtifactStoreClient({
      endpoint, bucket: 'test-bucket', region: 'us-east-1',
      accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key',
    }, now)
    return { client, fake }
  }

  it('puts, gets, and resolves with backend-provided version ids recorded', async () => {
    const { client } = await fixture(true)
    const ref = await client.putArtifact({ key: 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt', content: 'hello artifact', kind: 'log', summary: 'one line' })
    expect(ref.versionId).toBe('v-0001')
    expect(ref.bytes).toBe(14)
    expect(ref.uri).toBe('s3://test-bucket/need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt')
    const content = await client.resolveArtifact(ref)
    expect(new TextDecoder().decode(content)).toBe('hello artifact')
  })

  it('refuses to overwrite an existing key', async () => {
    const { client, fake } = await fixture(false)
    const key = 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt'
    await client.putObject(key, 'first')
    await expect(client.putObject(key, 'second')).rejects.toMatchObject({ code: 'conflict' })
    expect(new TextDecoder().decode(fake.objects.get(key)!.content)).toBe('first')
  })

  it('fails closed on missing objects and versions', async () => {
    const { client } = await fixture(true)
    const ref = await client.putArtifact({ key: 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt', content: 'x', kind: 'log', summary: 's' })
    await expect(client.getObject('need-1/run-1/absent.txt')).rejects.toMatchObject({ code: 'missing' })
    await expect(client.getObject('need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt', 'v-9999')).rejects.toMatchObject({ code: 'missing' })
    await expect(client.headObject('need-1/run-1/absent.txt')).rejects.toMatchObject({ code: 'missing' })
    expect(ref.versionId).toBeDefined()
  })

  it('rejects refs naming another bucket before any network request', async () => {
    const { client, fake } = await fixture(false)
    const foreign = makePactFlowArtifactRef({
      bucket: 'other-bucket', key: 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt',
      etag: '"00000000000000000000000000000000"', bytes: 1,
      hash: 'a'.repeat(64), kind: 'log', summary: 's',
    })
    const before = fake.hitCount()
    await expect(client.resolveArtifact(foreign)).rejects.toMatchObject({ code: 'out-of-binding' })
    expect(fake.hitCount()).toBe(before)
  })

  it('treats byte or hash mismatch as corruption', async () => {
    const { client, fake } = await fixture(false)
    const key = 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt'
    const ref = await client.putArtifact({ key, content: 'original', kind: 'log', summary: 's' })
    fake.objects.set(key, { content: Buffer.from('tampered!!') })
    await expect(client.resolveArtifact(ref)).rejects.toMatchObject({ code: 'corrupt' })
  })

  it('lists all keys under a prefix across continuation pages', async () => {
    const { client } = await fixture(false)
    for (let index = 0; index < 5; index += 1) {
      await client.putObject(`need-1/run-${String(index)}/0-log-worker-a1b2c3d4e5f6.txt`, String(index))
    }
    await client.putObject('need-2/run-9/0-log-worker-a1b2c3d4e5f6.txt', 'other')
    const keys = await client.listObjectKeys('need-1/')
    expect(keys).toHaveLength(5)
    expect(keys.every(key => key.startsWith('need-1/'))).toBe(true)
  })

  it('signs requests with a verifiable SigV4 signature', async () => {
    let authorization = ''
    let amzDate = ''
    let seenPath = ''
    const witness = createServer((request, response) => {
      if (request.method === 'HEAD') {
        response.statusCode = 404
        response.end()
        return
      }
      authorization = request.headers.authorization ?? ''
      amzDate = String(request.headers['x-amz-date'] ?? '')
      seenPath = request.url ?? ''
      response.statusCode = 200
      response.setHeader('etag', '"00000000000000000000000000000000"')
      response.end()
    })
    await new Promise<void>((resolve, reject) => { witness.once('error', reject); witness.listen(0, '127.0.0.1', resolve) })
    closers.push(() => new Promise<void>(resolve => witness.close(() => resolve())))
    const port = (witness.address() as AddressInfo).port
    const client = new PactFlowArtifactStoreClient({
      endpoint: `http://127.0.0.1:${String(port)}`, bucket: 'test-bucket', region: 'us-east-1',
      accessKeyId: 'test-access-key', secretAccessKey: 'test-secret-key',
    }, FIXED_NOW)
    await client.putObject('need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt', 'payload')

    // Independent reference implementation of the SigV4 derivation for the same request.
    const payloadHash = createHash('sha256').update('payload').digest('hex')
    const host = `127.0.0.1:${String(port)}`
    const path = '/test-bucket/need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt'
    const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`
    const canonicalRequest = ['PUT', path, '', canonicalHeaders, 'host;x-amz-content-sha256;x-amz-date', payloadHash].join('\n')
    const scope = '20260914/us-east-1/s3/aws4_request'
    const stringToSign = ['AWS4-HMAC-SHA256', amzDate, scope,
      createHash('sha256').update(canonicalRequest).digest('hex')].join('\n')
    const hmac = (key: Buffer | string, value: string) => createHmac('sha256', key).update(value).digest()
    const signingKey = hmac(hmac(hmac(hmac('AWS4test-secret-key', '20260914'), 'us-east-1'), 's3'), 'aws4_request')
    const expected = `AWS4-HMAC-SHA256 Credential=test-access-key/${scope}, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=${createHmac('sha256', signingKey).update(stringToSign).digest('hex')}`
    expect(seenPath).toBe(path)
    expect(amzDate).toBe('20260914T120000Z')
    expect(authorization).toBe(expected)
  })
})

describe('PactFlow artifact address contract', () => {
  const valid = {
    bucket: 'test-bucket', key: 'need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt',
    etag: '"0102030405060708090a0b0c0d0e0f10"', bytes: 3,
    hash: 'a'.repeat(64), kind: 'log', summary: 'summary line',
  }

  it('constructs the ref with uri and omits absent versionId', () => {
    const ref = makePactFlowArtifactRef(valid)
    expect(ref.uri).toBe('s3://test-bucket/need-1/run-1/0-log-worker-a1b2c3d4e5f6.txt')
    expect('versionId' in ref).toBe(false)
  })

  it('rejects invalid field combinations', () => {
    expect(() => makePactFlowArtifactRef({ ...valid, etag: 'unquoted' })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, bytes: 0 })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, hash: 'zz' })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, key: 'no-slash' })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, key: '../escape/run-1/x.txt' })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, versionId: ' ' })).toThrow()
  })

  it('bounds the summary on both lines and bytes', () => {
    expect(() => makePactFlowArtifactRef({ ...valid, summary: Array.from({ length: 11 }, () => 'line').join('\n') })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, summary: 'x'.repeat(1025) })).toThrow()
    expect(() => makePactFlowArtifactRef({ ...valid, summary: Array.from({ length: 10 }, () => 'line').join('\n') })).not.toThrow()
  })

  it('mints keys with an unpredictable random segment', () => {
    const first = pactFlowArtifactObjectKey({ needId: 'need-1', runId: 'run-1', seq: 0, kind: 'log', sender: 'worker' })
    const second = pactFlowArtifactObjectKey({ needId: 'need-1', runId: 'run-1', seq: 0, kind: 'log', sender: 'worker' })
    expect(first).not.toBe(second)
    expect(first.startsWith('need-1/run-1/0-log-worker-')).toBe(true)
  })
})
