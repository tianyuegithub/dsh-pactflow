import { PACTFLOW_HARNESS_API_MODE } from './k3s-worker.ts'
import type { PactFlowApiMode, PactFlowHarness } from './types.ts'

/**
 * Harness capability levels, from "reached the endpoint" to "runs and cleans up a
 * bounded CLI task". The point is to never present a mere connectivity success as
 * a delivered artifact: each level is a separate, verifiable claim.
 */
export const PACTFLOW_HARNESS_CAPABILITY_LEVELS = [
  'connection', 'protocol', 'tool-invocation', 'artifact', 'verification', 'cancellation',
] as const

export type PactFlowHarnessCapabilityLevel = typeof PACTFLOW_HARNESS_CAPABILITY_LEVELS[number]

/**
 * Levels a Host probe can attest from its own observations. `tool-invocation`
 * needs the Harness runner to report that it invoked a tool, and `verification`
 * needs a dedicated verification stage; both are evidence outside what this
 * repository's probes currently emit, so no Host stage maps to them and they are
 * never claimed. Listing the attestable rungs explicitly keeps the ladder honest:
 * a level with no evidence is never silently presented as reached.
 */
export const PACTFLOW_HOST_ATTESTABLE_LEVELS: readonly PactFlowHarnessCapabilityLevel[] = [
  'connection', 'protocol', 'artifact', 'cancellation',
]

/**
 * Which observed stage success proves which level. Every attestable level above the
 * floor has exactly one evidence stage; `connection` is the floor (a probe that
 * created its Job at least reached the endpoint) and is not listed here.
 */
export const PACTFLOW_PROBE_STAGE_LEVEL: Readonly<Record<string, PactFlowHarnessCapabilityLevel>> = {
  'model-response': 'protocol',
  'api-response': 'protocol',
  'cli-response': 'artifact',
  cleanup: 'cancellation',
}

export interface PactFlowHarnessCapabilityProfile {
  readonly harness: PactFlowHarness
  readonly apiMode: PactFlowApiMode
  /** Whether the protocol returns structured output the Host parses, or only text. */
  readonly structuredOutput: 'native' | 'text'
  /** Highest level this harness is declared and verified to support. */
  readonly maxLevel: PactFlowHarnessCapabilityLevel
}

/** Declared capability of every harness this plugin ships a worker image for. */
export function harnessCapabilityProfile(harness: PactFlowHarness): PactFlowHarnessCapabilityProfile {
  return {
    harness,
    apiMode: PACTFLOW_HARNESS_API_MODE[harness],
    // All four harnesses are run as a bounded CLI in a Job and report a termination
    // document; Claude additionally supports structured tool-call responses.
    structuredOutput: harness === 'claude' ? 'native' : 'text',
    maxLevel: 'cancellation',
  }
}

type Stage = { readonly name: string; readonly state: 'succeeded' | 'failed' }

/**
 * Highest level the probe may claim, i.e. the most committed attestable rung. A
 * probe must never report a level above this even if a future harness claims it.
 */
export function harnessProbeMaxLevel(): PactFlowHarnessCapabilityLevel {
  return PACTFLOW_HOST_ATTESTABLE_LEVELS[PACTFLOW_HOST_ATTESTABLE_LEVELS.length - 1]!
}

/**
 * The highest level a probe actually reached, derived only from observed stages.
 * A mere model/API response proves connection + protocol; a delivered artifact
 * needs a successful CLI response; cleanup success is required for cancellation.
 * The result is always an attestable level, so an unobservable rung
 * (`tool-invocation`, `verification`) can never be claimed.
 */
export function harnessAchievedLevel(result: { readonly stages: readonly Stage[] }): PactFlowHarnessCapabilityLevel {
  let reached: PactFlowHarnessCapabilityLevel = 'connection'
  for (const stage of result.stages) {
    if (stage.state !== 'succeeded') continue
    const level = PACTFLOW_PROBE_STAGE_LEVEL[stage.name]
    if (level === undefined) continue
    if (PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(level) > PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(reached)) {
      reached = level
    }
  }
  return reached
}
