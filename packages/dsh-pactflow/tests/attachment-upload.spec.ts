import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { randomUUID } from 'node:crypto'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PACTFLOW_CHANNEL_LIMITS, PactFlowArtifactStoreClient } from '../src/artifact-store.ts'

/**
 * Attachment upload, against a REAL S3-compatible store when one is armed.
 *
 * The parts that decide whether this feature is safe are all orderings — size
 * checked before any request, redaction gate before the object exists, event
 * only after it does — and an ordering cannot be demonstrated against a stub
 * that was written to have the same ordering. So when
 * `PACTFLOW_REAL_ARTIFACT_*` is present these run against the real store and
 * assert on what is actually there; the refusal cases need no store at all,
 * because their whole point is that nothing is ever created.
 *
 * Arm it with any local endpoint — see scripts/run-real-artifact.mjs.
 */

const endpoint = process.env.PACTFLOW_REAL_ARTIFACT_ENDPOINT
const bucket = process.env.PACTFLOW_REAL_ARTIFACT_BUCKET
const accessKeyId = process.env.PACTFLOW_REAL_ARTIFACT_ACCESS_KEY
const secretAccessKey = process.env.PACTFLOW_REAL_ARTIFACT_SECRET_KEY
const armed = endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined

const STORE_ID = 'attachments'

async function harness(withBinding = true) {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService, armed && withBinding ? {
    infrastructure: {
      clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [], gitProviders: [],
      artifactStores: [{
        id: STORE_ID, displayName: 'Attachments', kind: 's3' as const,
        endpoint: endpoint!, region: 'us-east-1', bucket: bucket!,
        accessKeyCredentialRef: 'PACTFLOW_ATTACHMENT_ACCESS', secretKeyCredentialRef: 'PACTFLOW_ATTACHMENT_SECRET',
      }],
    },
  } : {})
  ctx.provide('credentials', {
    describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
    resolve: (ref: string) => Promise.resolve({
      value: String(ref).includes('ACCESS') ? accessKeyId : secretAccessKey, source: 'memory',
    }),
  } as never)
  const session = ctx.sessions.create(SessionId(`attach-${randomUUID().slice(0, 8)}`), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Attachments' })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  if (armed && withBinding) {
    // Bind the store the way the product does, so the lookup under test is the real one.
    Reflect.set(ctx.pactflow, 'workspaceProjectForSession', async () => ({ artifact: { artifactStoreId: STORE_ID } }))
  }
  return { ctx, session, need }
}

const base64 = (text: string) => Buffer.from(text, 'utf8').toString('base64')

beforeAll(async () => {
  if (!armed) return
  await new PactFlowArtifactStoreClient({
    endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
    accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
  }).createBucket()
})

describe('PactFlow attachment refusals need no object store at all', () => {
  it('refuses an oversize attachment before any request is made', async () => {
    // Over the channel threshold: refused whole, never uploaded in part. This one
    // runs unarmed on purpose — if it ever reached the store, the absence of a
    // store would be the thing that failed, and that is not what is being asserted.
    const { ctx, session, need } = await harness(false)
    try {
      const oversize = 'a'.repeat(PACTFLOW_CHANNEL_LIMITS.attachment + 1)
      await expect(ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'big.bin', mediaType: 'application/octet-stream',
        contentBase64: base64(oversize),
      })).rejects.toThrow(/pactflow\.artifact\.oversize/)
      // Nothing recorded either.
      expect(Object.keys((await ctx.pactflow.snapshot(session.id)).delivery.attachments)).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it('states that no artifact store is bound instead of writing somewhere else', async () => {
    const { ctx, session, need } = await harness(false)
    try {
      await expect(ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'note.txt', mediaType: 'text/plain', contentBase64: base64('hello'),
      })).rejects.toThrow(/no artifact store binding|is not configured/)
      expect(Object.keys((await ctx.pactflow.snapshot(session.id)).delivery.attachments)).toHaveLength(0)
    } finally { await ctx.fiber.dispose() }
  })

  it.each([
    ['a path separator', '../escape.txt'],
    ['a nested path', 'dir/file.txt'],
    ['a dotfile', '.env'],
  ] as const)('refuses %s as a file name', async (_label, fileName) => {
    const { ctx, session, need } = await harness(false)
    try {
      await expect(ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName, mediaType: 'text/plain', contentBase64: base64('x'),
      })).rejects.toThrow(/file name/)
    } finally { await ctx.fiber.dispose() }
  })
})

describe.skipIf(!armed)('PactFlow attachment upload against a real store', () => {
  it('uploads the bytes and records only the address and digest', async () => {
    const { ctx, session, need } = await harness()
    try {
      const content = `attachment body ${randomUUID()}\n`.repeat(12)
      const attachment = await ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'notes.txt', mediaType: 'text/plain',
        contentBase64: base64(content), summary: 'design notes',
      })

      expect(attachment.ref.bytes).toBe(Buffer.byteLength(content, 'utf8'))
      expect(attachment.ref.hash).toMatch(/^[0-9a-f]{64}$/)
      expect(attachment.ref.uri.startsWith(`s3://${bucket!}/`)).toBe(true)
      expect(attachment.linkedBy).toBe('user')

      // The durable record carries the address, never the bytes, and never a URL
      // anyone could fetch without the binding.
      const event = session.events.find(entry => entry.type === 'pactflow/attachment-linked')
      const payload = JSON.stringify(event?.data)
      expect(payload).not.toContain(content.slice(0, 40))
      expect(payload).not.toContain('X-Amz-Signature')
      expect(payload).toContain(attachment.ref.hash)

      // It survives the fold and is readable back, verified against its digest.
      const stored = (await ctx.pactflow.snapshot(session.id)).delivery.attachments[attachment.id]
      expect(stored?.ref).toEqual(attachment.ref)
      const read = await ctx.pactflow.readAttachment(session.id, attachment.id)
      expect(Buffer.from(read.contentBase64, 'base64').toString('utf8')).toBe(content)
    } finally { await ctx.fiber.dispose() }
  })

  it.each([
    ['a private key block', '-----BEGIN RSA PRIVATE KEY-----\nMIIBOgIBAAJBAK\n-----END RSA PRIVATE KEY-----\n'],
    ['a bearer token', 'curl -H "Authorization: Bearer sk-aaaaaaaaaaaaaaaaaaaa" https://api.example\n'],
    ['a URL with embedded credentials', 'git clone https://user:hunter2hunter2@git.example/o/r.git\n'],
    ['a credential assignment', 'export API_KEY=sk-live-aaaaaaaaaaaaaaaaaaaa\n'],
  ] as const)('refuses %s and leaves no object behind', async (_label, content) => {
    const { ctx, session, need } = await harness()
    try {
      const before = await listKeys()
      await expect(ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'leak.txt', mediaType: 'text/plain', contentBase64: base64(content),
      })).rejects.toThrow(/redaction gate/)

      // Both halves of the contract: no object in the store, no event in the log.
      expect(await listKeys()).toEqual(before)
      expect(session.events.some(entry => entry.type === 'pactflow/attachment-linked')).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it('refuses when the scanner itself fails, rather than treating it as clean', async () => {
    // "The scanner is unavailable" is not a reason to store something unscanned.
    const { ctx, session, need } = await harness()
    try {
      const before = await listKeys()
      const store = await Reflect.get(ctx.pactflow, 'artifactStoreClient').call(ctx.pactflow, session)
      const put = store.putArtifact.bind(store)
      Reflect.set(ctx.pactflow, 'artifactStoreClient', async () => ({
        ...store,
        putArtifact: (input: Parameters<typeof put>[0]) => put({
          ...input, uploadGate: () => { throw new Error('scanner exploded') },
        }),
      }))
      await expect(ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'note.txt', mediaType: 'text/plain', contentBase64: base64('harmless'),
      })).rejects.toThrow()
      expect(await listKeys()).toEqual(before)
    } finally { await ctx.fiber.dispose() }
  })
})

describe.skipIf(!armed)('PactFlow attachment objects enter the ledger and orphans surface', () => {
  it('lists a linked attachment as a recorded object, not an orphan', async () => {
    const { ctx, session, need } = await harness()
    try {
      const attachment = await ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'ledger.txt', mediaType: 'text/plain',
        contentBase64: base64(`ledger ${randomUUID()}\n`),
      })
      const ledger = await ctx.pactflow.artifactLedger(session.id)
      const entry = ledger.orphans.concat(ledger.overdue).find(record => record.uri === attachment.ref.uri)
      // Recorded objects are not orphans; they may age into `overdue`, which is a
      // different statement entirely.
      expect(ledger.orphans.some(record => record.uri === attachment.ref.uri)).toBe(false)
      void entry
      expect(ledger.totalBytes).toBeGreaterThanOrEqual(attachment.ref.bytes)
    } finally { await ctx.fiber.dispose() }
  })

  it('marks an object the log never recorded as an orphan, and deletes nothing', async () => {
    // This is what "upload succeeded, append failed" leaves behind. The contract
    // refuses to resolve it automatically: it is surfaced for a person to judge.
    const { ctx, session } = await harness()
    try {
      const client = new PactFlowArtifactStoreClient({
        endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
        accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
      })
      const strayKey = `pactflow-attachments/orphan-${randomUUID()}/stray.txt`
      const stray = await client.putArtifact({
        key: strayKey, content: 'an object no event ever named\n', kind: 'attachment', summary: 'stray',
      })

      const ledger = await ctx.pactflow.artifactLedger(session.id)
      const orphan = ledger.orphans.find(record => record.uri === stray.uri)
      expect(orphan, 'an unrecorded object must surface as an orphan').toBeDefined()
      expect(orphan?.orphan).toBe(true)

      // Still there: nothing auto-deletes.
      expect(await listKeys()).toContain(strayKey)
    } finally { await ctx.fiber.dispose() }
  })
})

async function listKeys(): Promise<readonly string[]> {
  const client = new PactFlowArtifactStoreClient({
    endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
    accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
  })
  const entries = await client.listObjects('pactflow-attachments/')
  return entries.map(entry => entry.key).sort()
}
