import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createFreshnessTracker } from '../src/client/runtime-freshness.ts'

describe('PactFlow runtime data freshness', () => {
  it('does not requery before the interval elapses and does after', () => {
    const tracker = createFreshnessTracker({ intervalMs: 1_000, now: () => 0 })
    expect(tracker.shouldRequery()).toBe(true) // first read is immediately due
    tracker.onSuccess()
    expect(tracker.shouldRequery()).toBe(false)
    expect(tracker.shouldRequery(999)).toBe(false)
    expect(tracker.shouldRequery(1_000)).toBe(true)
  })

  it('records the last success time and reports fresh', () => {
    let clock = 5_000
    const tracker = createFreshnessTracker({ intervalMs: 1_000, now: () => clock })
    tracker.onSuccess()
    expect(tracker.state()).toMatchObject({ stale: false, lastSuccessAt: 5_000 })
    clock = 6_000
    expect(tracker.shouldRequery()).toBe(true)
  })

  it('marks stale on failure and keeps the previous success time', () => {
    const tracker = createFreshnessTracker({ intervalMs: 1_000, now: () => 0 })
    tracker.onSuccess()
    tracker.onFailure()
    expect(tracker.state()).toMatchObject({ stale: true, lastSuccessAt: 0 })
  })

  it('clears stale on the next success', () => {
    let clock = 0
    const tracker = createFreshnessTracker({ intervalMs: 1_000, now: () => clock })
    tracker.onFailure()
    expect(tracker.state().stale).toBe(true)
    clock = 1_000
    tracker.onSuccess()
    expect(tracker.state()).toMatchObject({ stale: false, lastSuccessAt: 1_000 })
  })

  it('reports no confirmed data before the first success', () => {
    const tracker = createFreshnessTracker({ intervalMs: 1_000, now: () => 0 })
    expect(tracker.state()).toEqual({ stale: false, lastSuccessAt: null })
  })

  it('uses a bounded default interval', () => {
    const tracker = createFreshnessTracker({ now: () => 0 })
    // A positive default interval exists and is not absurdly large.
    const interval = tracker.intervalMs
    expect(interval).toBeGreaterThan(0)
    expect(interval).toBeLessThanOrEqual(60_000)
  })
})

describe('PactFlow runtime freshness wiring', () => {
  it('requeries on a bounded interval and surfaces staleness in the overlay', () => {
    const overlay = readFileSync(resolve(import.meta.dirname, '..', 'src', 'client', 'overlay.tsx'), 'utf8')
    // Bounded interval requery while open and ready.
    expect(overlay).toContain('PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS')
    expect(overlay).toContain('setInterval')
    expect(overlay).toContain('clearInterval')
    // Failure marks stale, success clears it, and the UI shows the state.
    expect(overlay).toContain('freshness.current.onFailure()')
    expect(overlay).toContain('freshness.current.onSuccess()')
    expect(overlay).toContain('freshnessState.stale')
    // The workbench presents this read timestamp in diagnostics, not as readiness.
    expect(overlay).toContain("freshnessState.lastSuccessAt === null ? '尚未读取'")
    // Context change resets freshness so a previous owner's timestamp is not shown.
    expect(overlay).toContain('freshness.current = createFreshnessTracker()')
    // The initial load's runtime data counts as confirmed (no false "unconfirmed" flash).
    expect(overlay.split('load(sessionId, signal)')[1] ?? '').toContain('freshness.current.onSuccess()')
  })
})
