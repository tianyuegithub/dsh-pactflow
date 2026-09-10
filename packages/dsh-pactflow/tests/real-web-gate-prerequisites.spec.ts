import { describe, expect, it, vi, afterEach } from 'vitest'
import { checkWebGatePrerequisites } from '../../../scripts/run-real-web-gate.mjs'

// The real web gate is the zero-skip release lane: if its prerequisite check were
// silently wrong it would either block a legitimate run or let an UNARMED run
// proceed. The DSH_SNAPSHOT branch is deterministic (no cluster/credential
// dependency), so it is guarded here.
describe('PactFlow real web gate prerequisites', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('always requires record mode for the real worker suites', () => {
    vi.stubEnv('DSH_SNAPSHOT', '')
    expect(checkWebGatePrerequisites()).toContain(
      'DSH_SNAPSHOT=record (real worker suites must run in record mode)',
    )
    vi.stubEnv('DSH_SNAPSHOT', 'replay')
    expect(checkWebGatePrerequisites()).toContain(
      'DSH_SNAPSHOT=record (real worker suites must run in record mode)',
    )
  })

  it('never reports the record-mode prerequisite once armed (the other entries are environment-dependent)', () => {
    vi.stubEnv('DSH_SNAPSHOT', 'record')
    const missing = checkWebGatePrerequisites()
    expect(missing).not.toContain(
      'DSH_SNAPSHOT=record (real worker suites must run in record mode)',
    )
    // The remaining entries depend on the live cluster/creds; whatever their
    // outcome, the result is always an array of strings (never null/undefined).
    expect(Array.isArray(missing)).toBe(true)
    expect(missing.every(entry => typeof entry === 'string' && entry.length > 0)).toBe(true)
  })
})
