import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchEvidenceView } from '../src/client/session-workbench-view.tsx'
import { PACTFLOW_ARTIFACT_OVERSIZE_CODE, PACTFLOW_CHANNEL_LIMITS } from '../src/artifact-store.ts'
import type { PactFlowSnapshot } from '../src/types.ts'

/**
 * The attachment area, rendered.
 *
 * Two of its statements are the contract, not decoration: with no store bound the
 * entry has to SAY so (silence would read as "nothing to attach yet"), and the
 * digest has to be visible, because reading verifies against it and a mismatch is
 * a refusal rather than a silent substitution.
 */

const NEED = 'need'

function snapshot(attachments: Record<string, unknown> = {}): PactFlowSnapshot {
  return {
    project: { project: null },
    needs: { byId: { [NEED]: { id: NEED, title: 'Need', description: '', phase: 'closing', revision: 1, createdAt: 1, updatedAt: 1 } } },
    dag: { byId: {} },
    runs: { byId: {} },
    delivery: { reviews: {}, documents: {}, attachments, releases: {}, cleanups: {} },
  } as never as PactFlowSnapshot
}

const attachment = (overrides: Record<string, unknown> = {}) => ({
  id: 'attachment-1', needId: NEED, fileName: 'design-notes.txt', mediaType: 'text/markdown',
  summary: 'design notes', linkedAt: 1, linkedBy: 'user',
  ref: {
    uri: 's3://bucket/pactflow-attachments/s/n/a/design-notes.txt', etag: '"e"',
    bytes: 2048, hash: 'ab'.repeat(32), kind: 'attachment', summary: 'design notes',
  },
  ...overrides,
})

function render(extra: Partial<Parameters<typeof WorkbenchEvidenceView>[0]> = {}, value = snapshot()): string {
  return renderToStaticMarkup(createElement(WorkbenchEvidenceView, {
    snapshot: value, needId: NEED, tab: 'delivery', onResume: vi.fn(), resumingNodeId: null, ...extra,
  }))
}

describe('PactFlow workbench attachment area', () => {
  it('lists a linked attachment with its size, media type and digest', () => {
    const html = render({}, snapshot({ 'attachment-1': attachment() }))
    expect(html).toContain('design-notes.txt')
    expect(html).toContain('text/markdown')
    expect(html).toContain('2.0 KiB')
    // The digest is on screen because reading verifies against it.
    expect(html).toContain('ab'.repeat(32).slice(0, 12))
  })

  it('never renders the content itself or a fetchable address', () => {
    const html = render({}, snapshot({ 'attachment-1': attachment() }))
    expect(html).not.toContain('X-Amz-Signature')
    expect(html).not.toContain('contentBase64')
  })

  it('states that no store is bound rather than showing an entry that cannot work', () => {
    const html = render({ attachmentStoreBound: false })
    expect(html).toContain('未绑定对象存储')
    // And says what it will NOT do, because the alternative users expect is a
    // silent fallback to storing the bytes somewhere else.
    expect(html).toContain('不会退回为内联大文本')
    expect(html).not.toContain('type="file"')
  })

  it('offers the upload entry when a store is bound', () => {
    const html = render({ attachmentStoreBound: true, onLinkAttachment: vi.fn() })
    expect(html).toContain('type="file"')
  })

  it('says there are no attachments rather than rendering an empty list', () => {
    expect(render({ attachmentStoreBound: true })).toContain('暂无附件')
  })

  it('offers an explicit read action per attachment, never an automatic fetch', () => {
    const onReadAttachment = vi.fn()
    const html = render({ onReadAttachment }, snapshot({ 'attachment-1': attachment() }))
    expect(html).toContain('读取并校验')
    // Rendering must not fetch anything by itself.
    expect(onReadAttachment).not.toHaveBeenCalled()
  })
})

describe('PactFlow workbench refuses an oversize attachment before sending', () => {
  it('takes its threshold from the single channel definition', () => {
    // A second copy of the number here would drift from the Host's check, and the
    // drift would show up as an upload the client allowed and the Host refused.
    const source = new URL('../src/client/session-workbench-view.tsx', import.meta.url)
    const text = require('node:fs').readFileSync(source, 'utf8') as string
    expect(text).toContain('PACTFLOW_CHANNEL_LIMITS.attachment')
    expect(text).toContain('PACTFLOW_ARTIFACT_OVERSIZE_CODE')
    // And no hand-written byte count that could drift from it.
    expect(text).not.toMatch(/const PACTFLOW_ATTACHMENT_MAX_BYTES = \d/)
  })

  it('has a threshold with real headroom under every measured transport limit', () => {
    // Measured: 256 MiB crossed the Remote channel with no refusal, and the next
    // rung fails inside V8 string construction (~512 MiB string cap). The
    // threshold sits a factor of 8 under what was measured to pass and 16 under
    // the structural limit, so an oversize attachment is always OUR refusal with
    // our own message, never an opaque transport or V8 error.
    const MEASURED_PASSING = 256 * 1024 * 1024
    const V8_STRING_CAP = 512 * 1024 * 1024
    expect(PACTFLOW_CHANNEL_LIMITS.attachment).toBe(32 * 1024 * 1024)
    expect(PACTFLOW_CHANNEL_LIMITS.attachment * 8).toBeLessThanOrEqual(MEASURED_PASSING)
    expect(PACTFLOW_CHANNEL_LIMITS.attachment * 16).toBeLessThanOrEqual(V8_STRING_CAP)
  })

  it('carries the oversize code the contract names', () => {
    expect(PACTFLOW_ARTIFACT_OVERSIZE_CODE).toBe('pactflow.artifact.oversize')
  })
})
