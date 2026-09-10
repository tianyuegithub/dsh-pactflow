import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_HARNESS_CAPABILITY_LEVELS,
  PACTFLOW_HOST_ATTESTABLE_LEVELS,
  PACTFLOW_PROBE_STAGE_LEVEL,
  harnessCapabilityProfile,
  harnessAchievedLevel,
  harnessProbeMaxLevel,
} from '../src/harness-capabilities.ts'

describe('PactFlow harness capability levels', () => {
  it('orders the levels from least to most committed', () => {
    expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS).toEqual([
      'connection', 'protocol', 'tool-invocation', 'artifact', 'verification', 'cancellation',
    ])
  })

  it('declares a protocol and a structured-output contract per harness', () => {
    for (const harness of ['claude', 'codex', 'opencode', 'dsh'] as const) {
      const profile = harnessCapabilityProfile(harness)
      expect(profile.apiMode.length).toBeGreaterThan(0)
      expect(['native', 'text']).toContain(profile.structuredOutput)
      // A harness that can run a bounded CLI task must at least reach 'artifact'.
      expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(profile.maxLevel))
        .toBeGreaterThanOrEqual(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf('artifact'))
    }
  })

  it('reports only connection when the probe merely reached the model', () => {
    expect(harnessAchievedLevel({ stages: [] })).toBe('connection')
    expect(harnessAchievedLevel({ stages: [{ name: 'api-response', state: 'succeeded' }] })).toBe('protocol')
  })

  it('reports verification reached only when a CLI response and cleanup both succeeded', () => {
    expect(harnessAchievedLevel({ stages: [
      { name: 'model-response', state: 'succeeded' },
      { name: 'cli-response', state: 'succeeded' },
    ] })).toBe('artifact')
    expect(harnessAchievedLevel({ stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'succeeded' },
    ] })).toBe('cancellation')
  })

  it('does not claim cancellation when cleanup failed', () => {
    expect(harnessAchievedLevel({ stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'failed' },
    ] })).toBe('artifact')
  })

  it('derives the highest reached level from all successful stages regardless of order', () => {
    // Stage order must not lower the reached level: cleanup can be observed before
    // the CLI stage yet still lift the claim.
    expect(harnessAchievedLevel({ stages: [
      { name: 'cleanup', state: 'succeeded' },
      { name: 'cli-response', state: 'succeeded' },
    ] })).toBe('cancellation')
    // A failed stage never contributes.
    expect(harnessAchievedLevel({ stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'failed' },
    ] })).toBe('artifact')
  })

  it('never claims tool-invocation or verification, which no probe stage evidences', () => {
    // These rungs need dedicated probe stages (Harness-runner tool-call evidence
    // and a verification stage) that this repository does not yet emit, so the
    // derivation must never return them.
    expect(PACTFLOW_HOST_ATTESTABLE_LEVELS).not.toContain('tool-invocation')
    expect(PACTFLOW_HOST_ATTESTABLE_LEVELS).not.toContain('verification')
    expect(Object.values(PACTFLOW_PROBE_STAGE_LEVEL)).not.toContain('tool-invocation')
    expect(Object.values(PACTFLOW_PROBE_STAGE_LEVEL)).not.toContain('verification')
    expect(harnessProbeMaxLevel()).toBe('cancellation')
    // Every mapped stage resolves to an attestable level at or below the ceiling.
    const ceiling = PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(harnessProbeMaxLevel())
    for (const level of Object.values(PACTFLOW_PROBE_STAGE_LEVEL)) {
      expect(PACTFLOW_HOST_ATTESTABLE_LEVELS).toContain(level)
      expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(level)).toBeLessThanOrEqual(ceiling)
    }
  })

  it('ignores unknown stage names rather than inferring a level from them', () => {
    expect(harnessAchievedLevel({ stages: [
      { name: 'tool-invocation', state: 'succeeded' },
      { name: 'verification', state: 'succeeded' },
      { name: 'some-future-stage', state: 'succeeded' },
    ] })).toBe('connection')
  })
})
