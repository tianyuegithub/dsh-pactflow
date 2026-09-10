import { describe, expect, it, vi, afterEach } from 'vitest'
import { ttlStage, zeroProofStage } from '../../../scripts/run-real-k3s-batch.mjs'

// A B-class stage must FAIL CLOSED when unarmed: it may not touch a real cluster
// unless explicitly armed. If these guards were removed, an unarmed run would
// proceed (or fail with a confusing kubectl error) instead of refusing with the
// designed "B-class operation" message. The guard is deterministic (env only), so
// it is guarded here without needing a cluster.
describe('PactFlow real K3s batch stages fail closed when unarmed', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  it('ttlStage refuses to run without its explicit arm', () => {
    vi.stubEnv('PACTFLOW_K3S_TTL_PROBE', '')
    expect(() => ttlStage()).toThrow(/ttlStage: real-cluster TTL probe is a B-class operation/)
    vi.stubEnv('PACTFLOW_K3S_TTL_PROBE', '0')
    expect(() => ttlStage()).toThrow(/B-class operation/)
  })

  it('zeroProofStage refuses to run without its explicit arm', () => {
    vi.stubEnv('PACTFLOW_K3S_ZERO_PROOF', '')
    expect(() => zeroProofStage()).toThrow(/zeroProofStage: real-cluster zero-proof is a B-class operation/)
    vi.stubEnv('PACTFLOW_K3S_ZERO_PROOF', 'true')
    // Only the exact literal '1' arms it — 'true' must NOT be treated as armed.
    expect(() => zeroProofStage()).toThrow(/B-class operation/)
  })
})
