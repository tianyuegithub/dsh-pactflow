import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createRequestGate } from '../src/client/request-gate.ts'

describe('PactFlow client request ordering', () => {
  it('applies the only issued request', () => {
    const gate = createRequestGate()
    const only = gate.next()
    expect(gate.isLatest(only)).toBe(true)
  })

  it('discards an older response that arrives after a newer one', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    // The second is issued later, so it is the one allowed to apply.
    expect(gate.isLatest(second)).toBe(true)
    expect(gate.isLatest(first)).toBe(false)
  })

  it('keeps only the last of several concurrent requests authoritative', () => {
    const gate = createRequestGate()
    const tokens = [gate.next(), gate.next(), gate.next()]
    const applied = tokens.filter(token => gate.isLatest(token))
    expect(applied).toHaveLength(1)
    expect(applied[0]).toBe(tokens[2])
  })

  it('invalidates every outstanding token on a context change', () => {
    const gate = createRequestGate()
    const first = gate.next()
    const second = gate.next()
    gate.invalidate()
    expect(gate.isLatest(first)).toBe(false)
    expect(gate.isLatest(second)).toBe(false)
    // A request issued after invalidation is authoritative again.
    const third = gate.next()
    expect(gate.isLatest(third)).toBe(true)
  })

  it('keeps an outstanding token authoritative until a newer one is issued', () => {
    const gate = createRequestGate()
    const only = gate.next()
    expect(gate.isLatest(only)).toBe(true)
    expect(gate.isLatest(only)).toBe(true)
  })
})

describe('PactFlow client request ordering wiring', () => {
  const client = (name: string): string =>
    readFileSync(resolve(import.meta.dirname, '..', 'src', 'client', name), 'utf8')

  it('routes the overlay runtime refresh and the panel refresh/secret loads through the gate', () => {
    const overlay = client('overlay.tsx')
    expect(overlay).toContain('createRequestGate')
    expect(overlay).toContain('runtimeGate.current.isLatest(token)')
    expect(overlay).toContain('runtimeGate.current.invalidate()')

    const panel = client('project-panel.tsx')
    expect(panel).toContain('createRequestGate')
    expect(panel).toContain('refreshGate.current.isLatest(token)')
    expect(panel).toContain('gitSecretsGate.current.isLatest(token)')
  })
})
