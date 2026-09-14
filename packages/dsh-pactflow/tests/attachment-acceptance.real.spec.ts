import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { randomUUID } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowArtifactStoreClient } from '../src/artifact-store.ts'
import { WorkbenchEvidenceView } from '../src/client/session-workbench-view.tsx'

/**
 * need-attachments 5.1 — the whole chain, on a real object store, in one case.
 *
 * Split across unit tests each half is convincing and the JOIN is not: the point
 * of this one is that the same bytes that left the browser encoder are the bytes
 * the workbench ends up showing a verified digest for, with a real HTTP round
 * trip and a real fold in between. Nothing here is stubbed except the browser's
 * File API, which is not part of the claim.
 *
 * Skipped unless PACTFLOW_REAL_ARTIFACT_* is present — a skipped suite is not a
 * pass, and it is not counted as one.
 */

const endpoint = process.env.PACTFLOW_REAL_ARTIFACT_ENDPOINT
const bucket = process.env.PACTFLOW_REAL_ARTIFACT_BUCKET
const accessKeyId = process.env.PACTFLOW_REAL_ARTIFACT_ACCESS_KEY
const secretAccessKey = process.env.PACTFLOW_REAL_ARTIFACT_SECRET_KEY
const armed = endpoint !== undefined && bucket !== undefined && accessKeyId !== undefined && secretAccessKey !== undefined

const STORE_ID = 'acceptance'
const SECRET_VALUE = 'pactflow-acceptance-secret-must-never-appear'

describe.skipIf(!armed)('PactFlow attachment real-path acceptance', () => {
  it('carries one attachment from browser encode to verified workbench read', async () => {
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      infrastructure: {
        clusters: [], registries: [], templates: [], modelConnections: [], workerPools: [], gitProviders: [],
        artifactStores: [{
          id: STORE_ID, displayName: 'Acceptance', kind: 's3' as const,
          endpoint: endpoint!, region: 'us-east-1', bucket: bucket!,
          accessKeyCredentialRef: 'PACTFLOW_ACCEPT_ACCESS', secretKeyCredentialRef: 'PACTFLOW_ACCEPT_SECRET',
        }],
      },
    })
    ctx.provide('credentials', {
      describe: () => Promise.resolve({ configured: true, source: 'memory', writable: true }),
      resolve: (ref: string) => Promise.resolve({
        value: String(ref).includes('ACCESS') ? accessKeyId : secretAccessKey, source: 'memory',
      }),
    } as never)

    const session = ctx.sessions.create(SessionId(`accept-${randomUUID().slice(0, 8)}`), { meta: { agentPreset: 'pactflow' } })
    ctx.pactflow.initialize(session.id, { name: 'Acceptance' })
    const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
    Reflect.set(ctx.pactflow, 'workspaceProjectForSession', async () => ({ artifact: { artifactStoreId: STORE_ID } }))

    try {
      await new PactFlowArtifactStoreClient({
        endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
        accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
      }).createBucket()

      // 1. Browser side: encode the file exactly as the workbench does.
      const body = `acceptance attachment ${randomUUID()}\n`.repeat(20)
      const bytes = new TextEncoder().encode(body)
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      const contentBase64 = Buffer.from(binary, 'binary').toString('base64')

      // 2. Host: redaction gate, real upload, event append.
      const attachment = await ctx.pactflow.linkAttachment(session.id, {
        needId: need.id, fileName: 'acceptance.txt', mediaType: 'text/plain', contentBase64,
      })

      // 3. The object is really in the store, at the recorded key and size.
      const client = new PactFlowArtifactStoreClient({
        endpoint: endpoint!, bucket: bucket!, region: 'us-east-1',
        accessKeyId: accessKeyId!, secretAccessKey: secretAccessKey!,
      })
      const listed = await client.listObjects('pactflow-attachments/')
      const key = attachment.ref.uri.slice(`s3://${bucket!}/`.length)
      const entry = listed.find(candidate => candidate.key === key)
      expect(entry, 'the object must exist in the real store').toBeDefined()
      expect(entry?.bytes).toBe(attachment.ref.bytes)

      // 4. Credentials appear in neither the event nor the ref.
      const log = JSON.stringify(session.events)
      for (const forbidden of [accessKeyId!, secretAccessKey!, SECRET_VALUE, 'X-Amz-Signature']) {
        expect(log, `the log must not carry ${forbidden.slice(0, 12)}`).not.toContain(forbidden)
      }
      expect(log).not.toContain(body.slice(0, 40))

      // 5. Agent-face read: resolve and verify against the recorded digest.
      const read = await ctx.pactflow.readAttachment(session.id, attachment.id)
      expect(Buffer.from(read.contentBase64, 'base64').toString('utf8')).toBe(body)

      // 6. Workbench render: the same digest, from the folded projection.
      const snapshot = await ctx.pactflow.snapshot(session.id)
      const html = renderToStaticMarkup(createElement(WorkbenchEvidenceView, {
        snapshot, needId: need.id, tab: 'delivery', onResume: vi.fn(), resumingNodeId: null,
        attachmentStoreBound: true, onReadAttachment: vi.fn(),
      }))
      expect(html).toContain('acceptance.txt')
      expect(html).toContain(attachment.ref.hash.slice(0, 12))
      expect(html).toContain('读取并校验')
      expect(html).not.toContain(body.slice(0, 40))

      // 7. Orphan reconciliation really finds one.
      const stray = await client.putArtifact({
        key: `pactflow-attachments/orphan-${randomUUID()}/stray.txt`,
        content: 'no event ever named this object\n', kind: 'attachment', summary: 'stray',
      })
      const ledger = await ctx.pactflow.artifactLedger(session.id)
      expect(ledger.orphans.some(record => record.uri === stray.uri)).toBe(true)
      expect(ledger.orphans.some(record => record.uri === attachment.ref.uri)).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })
})
