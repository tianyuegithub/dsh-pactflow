import { describe, expect, it } from 'vitest'
import { buildTtlProbeJob, evaluateTtlRecycle, evaluateZeroProof } from '../../../scripts/k3s-batch-stages.mjs'

describe('PactFlow K3s batch TTL stage', () => {
  it('builds a short-TTL probe Job that recycles itself', () => {
    const job = buildTtlProbeJob({ name: 'pf-ttl-probe', namespace: 'pactflow', image: 'busybox:1.36', ttlSeconds: 60 })
    expect(job.metadata.name).toBe('pf-ttl-probe')
    expect(job.spec.ttlSecondsAfterFinished).toBe(60)
    expect(job.spec.backoffLimit).toBe(0)
    // TTL after finished requires the Job to actually finish.
    expect(job.spec.template.spec.restartPolicy).toBe('Never')
  })

  it('treats a disappeared probe Job as recycled, a still-present one as not', () => {
    expect(evaluateTtlRecycle({ exists: false, finished: true })).toMatchObject({ recycled: true })
    expect(evaluateTtlRecycle({ exists: true, finished: true })).toMatchObject({ recycled: false })
    // A Job that never finished cannot be recycled by ttl-after-finished.
    expect(evaluateTtlRecycle({ exists: true, finished: false })).toMatchObject({ recycled: false, reason: 'not-finished' })
  })
})

describe('PactFlow K3s batch zero-proof stage', () => {
  it('is proven only when every tracked resource is confirmed absent', () => {
    const ok = evaluateZeroProof({
      tracked: [{ kind: 'job', name: 'a', uid: 'u1' }, { kind: 'configmap', name: 'b', uid: 'u2' }],
      present: [],
      unexplained: [],
    })
    expect(ok).toMatchObject({ zero: true, remaining: [] })
  })

  it('reports remaining tracked resources and unexplained leftovers', () => {
    const result = evaluateZeroProof({
      tracked: [{ kind: 'job', name: 'a', uid: 'u1' }],
      present: [{ kind: 'job', name: 'a', uid: 'u1' }],
      unexplained: [{ kind: 'pod', name: 'foreign' }],
    })
    expect(result.zero).toBe(false)
    expect(result.remaining).toEqual([{ kind: 'job', name: 'a', uid: 'u1' }])
    expect(result.unexplained).toEqual([{ kind: 'pod', name: 'foreign' }])
  })

  it('does not treat a same-name different-UID object as the tracked one being present', () => {
    const result = evaluateZeroProof({
      tracked: [{ kind: 'job', name: 'a', uid: 'u1' }],
      present: [{ kind: 'job', name: 'a', uid: 'u2' }],
      unexplained: [],
    })
    // The tracked UID is gone (zero for our responsibility); the replacement is reported.
    expect(result.zero).toBe(true)
    expect(result.unexplained).toEqual([])
    expect(result.replaced).toEqual([{ kind: 'job', name: 'a', uid: 'u2' }])
  })
})
