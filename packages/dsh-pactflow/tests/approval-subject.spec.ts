import { describe, expect, it } from 'vitest'
import { pactFlowDeliverySubjectDigest } from '../src/review-authorization.ts'

const refs = [
  { remoteRef: 'refs/remotes/origin/pactflow/need/a', commit: 'a'.repeat(40) },
  { remoteRef: 'refs/remotes/origin/pactflow/need/b', commit: 'b'.repeat(40) },
]

describe('PactFlow delivery subject binding', () => {
  it('is order-independent for the same task set', () => {
    const forward = pactFlowDeliverySubjectDigest('session', 'need', refs)
    const reversed = pactFlowDeliverySubjectDigest('session', 'need', [...refs].reverse())
    expect(forward).toBe(reversed)
  })

  it('changes when a task is added', () => {
    const before = pactFlowDeliverySubjectDigest('session', 'need', refs)
    const after = pactFlowDeliverySubjectDigest('session', 'need', [
      ...refs, { remoteRef: 'refs/remotes/origin/pactflow/need/c', commit: 'c'.repeat(40) },
    ])
    expect(after).not.toBe(before)
  })

  it('changes when a successful commit is replaced', () => {
    const before = pactFlowDeliverySubjectDigest('session', 'need', refs)
    const after = pactFlowDeliverySubjectDigest('session', 'need', [
      { ...refs[0]!, commit: 'd'.repeat(40) }, refs[1]!,
    ])
    expect(after).not.toBe(before)
  })

  it('differs across needs and sessions', () => {
    const base = pactFlowDeliverySubjectDigest('session', 'need', refs)
    expect(pactFlowDeliverySubjectDigest('session', 'other', refs)).not.toBe(base)
    expect(pactFlowDeliverySubjectDigest('other', 'need', refs)).not.toBe(base)
  })
})
