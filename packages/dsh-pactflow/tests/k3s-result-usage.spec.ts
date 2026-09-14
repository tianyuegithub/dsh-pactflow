import { describe, expect, it } from 'vitest'
import { parseResultUsage, parseResultToolInvocations } from '../src/k3s-worker.ts'

/**
 * Usage and tool-invocation counts arrive as OPTIONAL fields on the existing
 * result document, so the parsing side has to hold two lines at once:
 *
 *  - a document without them is legal (every third-party Harness produces one),
 *    and must parse to "unavailable" — never to zero;
 *  - a document WITH them that is malformed is not a document to salvage. Filling
 *    in a default would put a number nobody measured into the durable record, and
 *    the whole point of this dimension is that it never pretends.
 *
 * Absent and malformed therefore land on the same answer — unavailable — by two
 * different routes, and neither one ever yields a figure.
 */

describe('PactFlow result-document usage parsing', () => {
  it('reads a well-formed usage section', () => {
    expect(parseResultUsage({ usage: { inputTokens: 100, outputTokens: 20, modelCalls: 2 } }))
      .toEqual({ available: true, inputTokens: 100, outputTokens: 20, modelCalls: 2 })
  })

  it('treats a document with no usage section as unavailable, not as zero', () => {
    // This is every third-party Harness's document today, and it is legal.
    const usage = parseResultUsage({ schema: 'dsh_pactflow_k3s_result/v1', commit: 'a'.repeat(40) })
    expect(usage.available).toBe(false)
    expect(usage).not.toHaveProperty('inputTokens')
  })

  it.each([
    ['a negative count', { usage: { inputTokens: -5, outputTokens: 0, modelCalls: 0 } }],
    ['a fractional count', { usage: { inputTokens: 0.5, outputTokens: 0, modelCalls: 0 } }],
    ['a string count', { usage: { inputTokens: '100', outputTokens: 0, modelCalls: 0 } }],
    ['a half-filled section', { usage: { inputTokens: 100 } }],
    ['a non-object usage value', { usage: 42 }],
  ] as const)('refuses %s instead of filling in a default', (_label, document) => {
    expect(parseResultUsage(document).available).toBe(false)
  })

  it('keeps a measured zero as a measured zero', () => {
    const usage = parseResultUsage({ usage: { inputTokens: 0, outputTokens: 0, modelCalls: 0 } })
    expect(usage).toEqual({ available: true, inputTokens: 0, outputTokens: 0, modelCalls: 0 })
  })
})

describe('PactFlow result-document tool-invocation parsing', () => {
  it('reads a reported count', () => {
    expect(parseResultToolInvocations({ toolInvocations: 7 })).toBe(7)
  })

  it('reads a reported zero as zero, not as absent', () => {
    // "The runner told us it invoked no tool" and "the runner does not report"
    // are different facts; only the first is a count.
    expect(parseResultToolInvocations({ toolInvocations: 0 })).toBe(0)
  })

  it.each([
    ['no field', {}],
    ['a negative count', { toolInvocations: -1 }],
    ['a fractional count', { toolInvocations: 1.5 }],
    ['a string count', { toolInvocations: '7' }],
  ] as const)('reports %s as undefined rather than as zero', (_label, document) => {
    expect(parseResultToolInvocations(document)).toBeUndefined()
  })
})
