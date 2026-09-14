import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import PactFlowService from '../lib/index.js'
import {
  PACTFLOW_HARNESS_CAPABILITY_LEVELS,
  hostAttestableLevels,
  probeStageLevels,
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
    expect(harnessAchievedLevel('claude', { stages: [] })).toBe('connection')
    expect(harnessAchievedLevel('claude', { stages: [{ name: 'api-response', state: 'succeeded' }] })).toBe('protocol')
  })

  it('reports verification reached only when a CLI response and cleanup both succeeded', () => {
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'model-response', state: 'succeeded' },
      { name: 'cli-response', state: 'succeeded' },
    ] })).toBe('artifact')
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'succeeded' },
    ] })).toBe('cancellation')
  })

  it('does not claim cancellation when cleanup failed', () => {
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'failed' },
    ] })).toBe('artifact')
  })

  it('derives the highest reached level from all successful stages regardless of order', () => {
    // Stage order must not lower the reached level: cleanup can be observed before
    // the CLI stage yet still lift the claim.
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'cleanup', state: 'succeeded' },
      { name: 'cli-response', state: 'succeeded' },
    ] })).toBe('cancellation')
    // A failed stage never contributes.
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'cli-response', state: 'succeeded' },
      { name: 'cleanup', state: 'failed' },
    ] })).toBe('artifact')
  })

  it.each(['claude', 'codex', 'opencode', 'dsh'] as const)(
    '%s never claims tool-invocation or verification, which no probe stage evidences', harness => {
      // These rungs need evidence the runner must emit (a reported tool call, and a
      // stepwise verification report bound to a registered profile) that no runner
      // currently produces, so the derivation must never return them.
      //
      // Judged per Harness: `dsh`'s adapter is written here and shipped by digest,
      // so it is the one that could eventually attest them — and when it does, this
      // loop is what forces that grant to be stated for `dsh` alone.
      expect(hostAttestableLevels(harness)).not.toContain('tool-invocation')
      expect(hostAttestableLevels(harness)).not.toContain('verification')
      expect(Object.values(probeStageLevels(harness))).not.toContain('tool-invocation')
      expect(Object.values(probeStageLevels(harness))).not.toContain('verification')
      expect(harnessProbeMaxLevel(harness)).toBe('cancellation')
      // Every mapped stage resolves to an attestable level at or below the ceiling.
      const ceiling = PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(harnessProbeMaxLevel(harness))
      for (const level of Object.values(probeStageLevels(harness))) {
        expect(hostAttestableLevels(harness)).toContain(level)
        expect(PACTFLOW_HARNESS_CAPABILITY_LEVELS.indexOf(level)).toBeLessThanOrEqual(ceiling)
      }
    })

  it('ignores unknown stage names rather than inferring a level from them', () => {
    expect(harnessAchievedLevel('claude', { stages: [
      { name: 'tool-invocation', state: 'succeeded' },
      { name: 'verification', state: 'succeeded' },
      { name: 'some-future-stage', state: 'succeeded' },
    ] })).toBe('connection')
  })
})

describe('PactFlow declared harness capability query', () => {
  it('exposes the declared capability profile of each configured Harness', async () => {
    // The declaration is only meaningful if it is queryable; this asserts the
    // service actually wires `harnessCapabilityProfile` for configured templates.
    const ctx = new Context()
    await ctx.plugin(SessionStore)
    await ctx.plugin(SessionProjectionRegistry)
    await ctx.plugin(PactFlowService, {
      infrastructure: {
        clusters: [], registries: [], modelConnections: [], workerPools: [], gitProviders: [],
        templates: [
          { id: 'claude', harness: 'claude', apiMode: 'anthropic-messages',
            image: `harbor.example/worker@sha256:${'a'.repeat(64)}`, model: 'm', baseUrl: 'https://m.invalid',
            modelSecretName: 'sec', cpuRequest: '1', memoryRequest: '1Gi', cpuLimit: '1', memoryLimit: '1Gi' },
          { id: 'codex', harness: 'codex', apiMode: 'openai-responses',
            image: `harbor.example/worker@sha256:${'b'.repeat(64)}`, model: 'm', baseUrl: 'https://m.invalid',
            modelSecretName: 'sec', cpuRequest: '1', memoryRequest: '1Gi', cpuLimit: '1', memoryLimit: '1Gi' },
        ],
      },
    })
    try {
      const declared = ctx.pactflow.listHarnessCapabilities()
      expect(declared.map(view => view.templateId).sort()).toEqual(['claude', 'codex'])
      const byId = Object.fromEntries(declared.map(view => [view.templateId, view]))
      // Claude returns structured tool-call output natively; codex does not.
      expect(byId.claude?.structuredOutput).toBe('native')
      expect(byId.codex?.structuredOutput).toBe('text')
      // The declared ceiling is the highest *attestable* level, never an aspiration.
      expect(byId.claude?.maxLevel).toBe(harnessProbeMaxLevel('claude'))
      expect(byId.codex?.maxLevel).toBe(harnessProbeMaxLevel('claude'))
      expect(byId.codex?.apiMode).toBe('openai-responses')
    } finally {
      await ctx.fiber.dispose()
    }
  })
})
