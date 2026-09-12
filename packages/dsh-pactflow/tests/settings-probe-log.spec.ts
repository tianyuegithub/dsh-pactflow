import { probeImpl, type SettingsProbeController } from '../src/client/settings-probe.ts'
import type { PactFlowInfrastructureSettings, PactFlowInfrastructureProbeResult } from '../src/types.ts'
import type { CredentialActivity, InfrastructureTestLog } from '../src/client/settings-contract.ts'
import { describe, expect, it, vi } from 'vitest'

const draft: PactFlowInfrastructureSettings = {
  clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
  registries: [], gitProviders: [], templates: [], modelConnections: [], workerPools: [],
}

interface StubController extends SettingsProbeController {
  readonly testLogs: Record<string, InfrastructureTestLog>
}

function stubController(overrides: Partial<SettingsProbeController> = {}): StubController {
  const logs: Record<string, InfrastructureTestLog> = {}
  const activity: { current: CredentialActivity | null } = { current: null }
  const controller = {
    temporaryCredentialRefs: { current: new Map<string, string>() },
    credentialActivityRef: activity,
    unsetCredentialRef: { current: () => {} },
    unsetCredential: () => Promise.resolve(),
    setCredentialActivity: () => {},
    draft,
    credentialDrafts: {},
    postSaveRef: { current: null },
    settings: { set: () => Promise.resolve() },
    probeInfrastructure: (): Promise<PactFlowInfrastructureProbeResult> => Promise.resolve({
      kind: 'cluster', id: 'home', success: true, durationMs: 1,
      stages: [{ name: 'namespace-access', state: 'succeeded', detail: 'namespace pactflow is accessible' }],
    }),
    setCredential: () => Promise.resolve(),
    listImagePullSecrets: () => Promise.resolve(['pull-secret']),
    listHarborArtifacts: () => Promise.resolve([]),
    setProbingId: () => {},
    setTestedFingerprints: () => {},
    setTestLogs: update => {
      const next = update(logs)
      for (const [key, value] of Object.entries(next)) logs[key] = value
    },
    setExpandedLogs: () => {},
    setPullSecrets: () => {},
    setHarborArtifacts: () => {},
    setDraft: () => {},
    setAdvanced: () => {},
    setPersisted: () => {},
    setSavingId: () => {},
    setNotice: () => {},
    resourceFingerprint: () => 'fingerprint',
    draftForProbe: () => draft,
    credentialsForProbe: () => [],
    appendDiscoveryFailure: () => {},
    probeCredentialRef: reference => reference,
    beginCredentialActivity: (value: CredentialActivity) => {
      activity.current = value
      return true
    },
    finishCredentialActivity: (value: CredentialActivity) => {
      if (activity.current === value) activity.current = null
    },
    ...overrides,
  } as SettingsProbeController
  return Object.assign(controller, { testLogs: logs }) as StubController
}

describe('settings probe test-log lifecycle', () => {
  it('clears the running flag when a saved cluster probe succeeds without discovery', async () => {
    // Saved probes intentionally skip pull-secret discovery; the header must
    // not stay 进行中 forever merely because no async continuation follows.
    const listImagePullSecrets = vi.fn(() => Promise.resolve(['pull-secret']))
    const controller = stubController({ listImagePullSecrets })
    probeImpl(controller, 'cluster', 'home', true)
    await vi.waitFor(() => {
      expect(controller.testLogs['cluster:home'].running).toBe(false)
    })
    expect(controller.testLogs['cluster:home']?.success).toBe(true)
    expect(controller.testLogs['cluster:home']?.entries.map(entry => entry.name))
      .toContain('访问 K3s Namespace')
    expect(listImagePullSecrets).not.toHaveBeenCalled()
  })

  it('clears the running flag once pull-secret discovery settles a draft cluster probe', async () => {
    const controller = stubController()
    probeImpl(controller, 'cluster', 'home', false)
    await vi.waitFor(() => {
      expect(controller.testLogs['cluster:home'].running).toBe(false)
    })
    expect(controller.testLogs['cluster:home']?.success).toBe(true)
  })

  it('clears the running flag when a saved cluster probe fails', async () => {
    const controller = stubController({
      probeInfrastructure: (): Promise<PactFlowInfrastructureProbeResult> => Promise.resolve({
        kind: 'cluster', id: 'home', success: false, durationMs: 1,
        stages: [{ name: 'namespace-access', state: 'failed', detail: 'boom' }],
      }),
    })
    probeImpl(controller, 'cluster', 'home', true)
    await vi.waitFor(() => {
      expect(controller.testLogs['cluster:home'].running).toBe(false)
    })
    expect(controller.testLogs['cluster:home']?.success).toBe(false)
  })
})
