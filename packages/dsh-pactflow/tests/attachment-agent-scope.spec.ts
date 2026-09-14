import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import { createScope } from '@deepseek-ai/dsh-scope'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it } from 'vitest'
import PactFlowService from '../lib/index.js'
import * as PactFlowAgentTools from '../presets/pactflow/plugin/index.js'

/**
 * The Agent face reads attachments; it never creates them and never learns how
 * to reach the store.
 *
 * Both halves matter. If the model could upload, the durable `linkedBy: 'user'`
 * would become a forgeable human trace. And if the tool surface carried endpoint
 * or credential parameters, the store binding would stop being the Host's — the
 * model could aim an upload somewhere the project never bound.
 */

async function setup() {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  await ctx.plugin(SystemPrompt, {})
  await ctx.plugin(ToolRuntime)
  const session = ctx.sessions.create(SessionId('attachment-scope'), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Scope' })
  const need = ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const agent = { id: session.id, session } as Agent
  const scope = createScope(ctx, agent)
  await scope.ctx.plugin(PactFlowAgentTools)
  session.append('turn/start', { turn: 1 })
  return { ctx, session, need, agent }
}

const AGENT_SOURCE = readFileSync(resolve(import.meta.dirname, '..', 'src', 'agent', 'index.ts'), 'utf8')

describe('PactFlow Agent face cannot create attachments', () => {
  it('registers no attachment-writing tool', () => {
    // Every registered tool name is a `name: 'pactflow_…'` literal in the face.
    const names = [...AGENT_SOURCE.matchAll(/name: '(pactflow_[a-z_]+)'/g)].map(match => match[1])
    expect(names.length).toBeGreaterThan(10)
    expect(names.filter(name => /attach|upload|link/i.test(name ?? ''))).toEqual([])
  })

  it('never names the write entry point in the tool surface', () => {
    // Behaviour is asserted above; this catches an alias or a later re-export
    // that would not show up as a tool name until it was already callable.
    expect(AGENT_SOURCE).not.toContain('linkAttachment')
  })

  it('exposes no store endpoint or credential parameter to the model', () => {
    // The binding is the Host's. A tool PARAMETER naming an endpoint, a bucket or
    // a credential would let the model aim an upload outside it. Matched on
    // parameter declarations rather than on the whole file, because the face
    // legitimately mentions "endpoint" in prose that tells the model the opposite
    // — that it must never pass a raw one.
    const parameters = [...AGENT_SOURCE.matchAll(/^\s{6}([a-z_0-9]+): \{ type:/gm)].map(match => match[1] ?? '')
    expect(parameters.length).toBeGreaterThan(10)
    for (const parameter of parameters) {
      expect(parameter, `the Agent face must not take "${parameter}"`)
        .not.toMatch(/endpoint|bucket|access_key|secret_key|artifact_store/i)
    }
  })
})

describe('PactFlow Agent face reads attachment summaries, not bytes', () => {
  it('carries linked attachments in the snapshot with ref and digest but no content', async () => {
    const harness = await setup()
    try {
      const ref = {
        uri: 's3://bucket/pactflow-attachments/a/b/notes.txt', etag: '"abc"', bytes: 42,
        hash: 'c'.repeat(64), kind: 'attachment', summary: 'design notes',
      }
      harness.session.append('pactflow/attachment-linked', {
        v: 1,
        attachment: {
          id: 'attachment-1', needId: harness.need.id, fileName: 'notes.txt',
          mediaType: 'text/plain', summary: 'design notes', ref, linkedAt: 1, linkedBy: 'user',
        },
      })

      const executed = await harness.ctx.tools.execute({
        callId: ToolCallId('view-call'), name: 'pactflow_view', arguments: {},
        agent: harness.agent, signal: new AbortController().signal,
      })
      expect(executed.isError).toBe(false)
      const text = JSON.stringify(executed)
      // The address, size, digest and media type are visible…
      expect(text).toContain('notes.txt')
      expect(text).toContain(ref.hash)
      expect(text).toContain('text/plain')
      // …and nothing that would let the model reach the object on its own.
      expect(text).not.toContain('X-Amz-Signature')
      expect(text).not.toContain('accessKey')
    } finally { await harness.ctx.fiber.dispose() }
  })

  it('refuses to read an attachment whose stored bytes do not match its digest', async () => {
    // The consumption obligation: resolve and verify before use, and on a mismatch
    // fail loudly rather than fall back to whatever the conversation remembers.
    const harness = await setup()
    try {
      harness.session.append('pactflow/attachment-linked', {
        v: 1,
        attachment: {
          id: 'attachment-corrupt', needId: harness.need.id, fileName: 'x.txt',
          mediaType: 'text/plain', summary: 'x',
          ref: { uri: 's3://bucket/k', etag: '"e"', bytes: 5, hash: 'd'.repeat(64), kind: 'attachment', summary: 'x' },
          linkedAt: 1, linkedBy: 'user',
        },
      })
      Reflect.set(harness.ctx.pactflow, 'artifactStoreClient', async () => ({
        // A store that hands back content not matching the recorded digest.
        resolveArtifact: () => { throw new Error('object s3://bucket/k does not match its ref bytes/hash') },
      }))
      await expect(harness.ctx.pactflow.readAttachment(harness.session.id, 'attachment-corrupt'))
        .rejects.toThrow(/does not match its ref/)
    } finally { await harness.ctx.fiber.dispose() }
  })

  it('refuses an attachment id that was never linked', async () => {
    const harness = await setup()
    try {
      await expect(harness.ctx.pactflow.readAttachment(harness.session.id, 'attachment-missing'))
        .rejects.toThrow(/does not exist/)
    } finally { await harness.ctx.fiber.dispose() }
  })
})
