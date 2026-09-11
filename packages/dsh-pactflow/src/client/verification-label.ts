/**
 * Client-side presentation of "how much automatic verification ran".
 *
 * A raw count of zero is ambiguous on screen: it can read as "verification
 * passed with zero findings" when it actually means "nothing was verified at
 * all". This pure function makes the zero case a first-class, distinct label so
 * the honest meaning is what reaches the user (validation-integrity-signals).
 */
import type { PactFlowLocaleKey } from './locale.ts'

export interface PactFlowVerificationLabel {
  readonly key: PactFlowLocaleKey
  readonly count?: number
}

/**
 * @param count - executed registered validation commands (from real evidence).
 * @returns the locale key for the count, or the explicit "no verification" label at zero.
 */
export function pactFlowVerificationLabel(count: number): PactFlowVerificationLabel {
  if (!Number.isFinite(count) || count <= 0) return { key: 'noVerification' }
  return { key: 'validations', count: Math.trunc(count) }
}
