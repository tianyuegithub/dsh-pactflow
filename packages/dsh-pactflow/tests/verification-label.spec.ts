import { describe, expect, it } from 'vitest'
import { pactFlowVerificationLabel } from '../src/client/verification-label.ts'

// A bare count of zero is ambiguous on screen ("0 findings" vs "nothing ran").
// The label function must make zero an explicit "no automatic verification".
describe('PactFlow client verification label', () => {
  it('labels zero as no automatic verification, not the count', () => {
    expect(pactFlowVerificationLabel(0)).toEqual({ key: 'noVerification' })
  })

  it('keeps the count for executed validations', () => {
    expect(pactFlowVerificationLabel(2)).toEqual({ key: 'validations', count: 2 })
    expect(pactFlowVerificationLabel(1)).toEqual({ key: 'validations', count: 1 })
  })

  it('fails closed to no-verification for non-finite or negative counts', () => {
    expect(pactFlowVerificationLabel(Number.NaN)).toEqual({ key: 'noVerification' })
    expect(pactFlowVerificationLabel(-1)).toEqual({ key: 'noVerification' })
  })
})
