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
 * Levels a Host probe can attest, and the stage whose success proves each —
 * **declared per Harness**.
 *
 * `tool-invocation` needs the Harness runner to report that it invoked a tool,
 * and `verification` needs the runner to execute a stepwise, order-sensitive task
 * bound to a registered validation profile and report on it. Neither is evidence
 * any runner currently emits, so today every Harness declares the same set and no
 * stage maps to those two rungs: a level with no evidence is never presented as
 * reached.
 *
 * The declaration is per Harness rather than global because those two rungs are
 * not equally out of reach. The `dsh` executor's adapter is written in this
 * repository and shipped by image digest, so it is the one that could report
 * them; `codex` and the others run third-party runners this repository does not
 * write. A global set would make granting `dsh` a level grant it to all of them
 * in the same edit — and by then there is no failing state left to write a guard
 * against. The shape is therefore split first, while it can still be tested.
 */
interface HarnessAttestation {
  readonly levels: readonly PactFlowHarnessCapabilityLevel[]
  /**
   * Which observed stage success proves which level. `connection` is the floor (a
   * probe that created its Job at least reached the endpoint) and is not listed.
   */
  readonly stageLevel: Readonly<Record<string, PactFlowHarnessCapabilityLevel>>
}

const HOST_ATTESTATION: HarnessAttestation = {
  levels: ['connection', 'protocol', 'artifact', 'cancellation'],
  stageLevel: {
    'model-response': 'protocol',
    'api-response': 'protocol',
    'cli-response': 'artifact',
    cleanup: 'cancellation',
  },
}

const PACTFLOW_HARNESS_ATTESTATION: Readonly<Record<PactFlowHarness, HarnessAttestation>> = {
  claude: HOST_ATTESTATION,
  codex: HOST_ATTESTATION,
  opencode: HOST_ATTESTATION,
  // Identical today. `dsh` gains `tool-invocation` and `verification` only once its
  // executor actually reports them (change `dsh-harness-telemetry`), and only here.
  dsh: HOST_ATTESTATION,
}

/** Levels this Harness's probes can attest from their own observations. */
export function hostAttestableLevels(harness: PactFlowHarness): readonly PactFlowHarnessCapabilityLevel[] {
  return PACTFLOW_HARNESS_ATTESTATION[harness].levels
}

/** Stage-success → level map for this Harness. A name absent here is ignored. */
export function probeStageLevels(harness: PactFlowHarness): Readonly<Record<string, PactFlowHarnessCapabilityLevel>> {
  return PACTFLOW_HARNESS_ATTESTATION[harness].stageLevel
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
    maxLevel: harnessProbeMaxLevel(harness),
  }
}

type Stage = { readonly name: string; readonly state: 'succeeded' | 'failed' }

/**
 * Highest level the probe may claim, i.e. the most committed attestable rung. A
 * probe must never report a level above this even if a future harness claims it.
 */
export function harnessProbeMaxLevel(harness: PactFlowHarness): PactFlowHarnessCapabilityLevel {
  const levels = hostAttestableLevels(harness)
  return levels[levels.length - 1]!
}

/**
 * The highest level a probe actually reached, derived only from observed stages.
 * A mere model/API response proves connection + protocol; a delivered artifact
 * needs a successful CLI response; cleanup success is required for cancellation.
 * The result is always an attestable level, so an unobservable rung
 * (`tool-invocation`, `verification`) can never be claimed.
 */
export function harnessAchievedLevel(
  harness: PactFlowHarness,
  result: { readonly stages: readonly Stage[] },
): PactFlowHarnessCapabilityLevel {
  // This Harness's own map, never a shared one: a stage another Harness can prove
  // must not be derivable here just because it shares a name.
  const stageLevel = probeStageLevels(harness)
  let reached: PactFlowHarnessCapabilityLevel = 'connection'
  for (const stage of result.stages) {
    if (stage.state !== 'succeeded') continue
    const level = stageLevel[stage.name]
    if (level === undefined) continue
    if (PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(level) > PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(reached)) {
      reached = level
    }
  }
  return reached
}
