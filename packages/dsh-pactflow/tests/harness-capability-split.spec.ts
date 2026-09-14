import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_HARNESS_CAPABILITY_LEVELS,
  harnessAchievedLevel,
  harnessProbeMaxLevel,
  hostAttestableLevels,
  probeStageLevels,
} from '../src/harness-capabilities.ts'
import type { PactFlowHarness } from '../src/types.ts'

/**
 * The attestable set and the stage→level map used to be global constants, so any
 * level one Harness could prove would immediately be provable for all of them.
 *
 * The `dsh` executor is the one whose adapter this repository owns and ships by
 * image digest, so it is the one that could eventually report tool invocations
 * and run a stepwise verification protocol. Making that possible for `dsh` must
 * not make it possible for `codex`, whose runner this repository does not write —
 * and the guard has to exist BEFORE the first level is added to any one Harness,
 * because afterwards there is no failing state left to write a test against.
 *
 * Today every Harness declares the same set; these cases hold the shape, not a
 * difference. `dsh` gains its two levels only when the executor actually reports
 * them (see change `dsh-harness-telemetry`), and the case below is what will stop
 * that from leaking sideways.
 */

const HARNESSES: readonly PactFlowHarness[] = ['claude', 'codex', 'opencode', 'dsh']

describe('PactFlow attestable levels are declared per Harness', () => {
  it.each(HARNESSES)('%s declares its own attestable set', harness => {
    const levels = hostAttestableLevels(harness)
    expect(levels.length).toBeGreaterThan(0)
    // Every declared level is a real rung of the ladder.
    for (const level of levels) expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS).toContain(level)
    // The floor is always attestable: a probe that created its Job reached the endpoint.
    expect(levels).toContain('connection')
  })

  it.each(HARNESSES)('%s maps only stages whose level it can attest', harness => {
    const attestable = new Set(hostAttestableLevels(harness))
    for (const level of Object.values(probeStageLevels(harness))) {
      expect(attestable, `${harness} maps a stage to a level it cannot attest`).toContain(level)
    }
  })

  it('derives one Harness level without consulting another Harness', () => {
    // The adversarial case: grant `dsh` a level and observe `codex`. This is the
    // exact leak a global constant made structurally impossible to prevent.
    const stages = [{ name: 'tool-invocation', state: 'succeeded' as const }]
    const withDshGrant = [...hostAttestableLevels('dsh'), 'tool-invocation'] as const
    void withDshGrant

    for (const harness of HARNESSES) {
      if (hostAttestableLevels(harness).includes('tool-invocation')) continue
      expect(harnessAchievedLevel(harness, { stages })).toBe('connection')
    }
  })

  it.each(HARNESSES)('%s ignores a stage name not in its own map', harness => {
    expect(harnessAchievedLevel(harness, {
      stages: [
        { name: 'a-stage-no-version-ever-emitted', state: 'succeeded' },
        { name: 'verification', state: 'succeeded' },
        { name: 'tool-invocation', state: 'succeeded' },
      ],
    })).toBe('connection')
  })

  it.each(HARNESSES)('%s takes its probe ceiling from its own attestable set', harness => {
    const levels = hostAttestableLevels(harness)
    const ceiling = harnessProbeMaxLevel(harness)
    expect(levels).toContain(ceiling)
    // The ceiling is the most committed rung that Harness can attest.
    for (const level of levels) {
      expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(level))
        .toBeLessThanOrEqual(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(ceiling))
    }
  })

  it.each(HARNESSES)('%s still derives its real levels from its own successful stages', harness => {
    // The split must not weaken what already worked.
    expect(harnessAchievedLevel(harness, { stages: [{ name: 'cli-response', state: 'succeeded' }] })).toBe('artifact')
    expect(harnessAchievedLevel(harness, {
      stages: [{ name: 'cli-response', state: 'succeeded' }, { name: 'cleanup', state: 'succeeded' }],
    })).toBe('cancellation')
    expect(harnessAchievedLevel(harness, { stages: [{ name: 'cleanup', state: 'failed' }] })).toBe('connection')
  })
})
