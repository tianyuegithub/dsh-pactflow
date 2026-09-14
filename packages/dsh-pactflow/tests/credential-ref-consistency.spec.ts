import { describe, expect, it } from 'vitest'
import { replaceInfrastructureCredentialRefs } from '../src/client/credential-probe.ts'
import { resourceCredentialRefs, EMPTY_INFRASTRUCTURE } from '../src/client/settings-model.ts'
import type {
  PactFlowArtifactStoreSettings, PactFlowGitProviderSettings, PactFlowInfrastructureResourceKind,
  PactFlowInfrastructureSettings, PactFlowModelConnectionSettings, PactFlowRegistrySettings,
  PactFlowWorkerPoolSettings,
} from '../src/types.ts'

/**
 * Class-level guard for the credential-ref lists: the probe credential
 * collector (resourceCredentialRefs) and the probe draft replacer
 * (replaceInfrastructureCredentialRefs) must agree for EVERY resource kind.
 * A kind present in one but not the other is exactly the defect class that
 * broke artifact-store probe credential preparation at first use.
 */
describe('PactFlow credential ref lists stay consistent across resource kinds', () => {
  const sample: PactFlowInfrastructureSettings = {
    ...EMPTY_INFRASTRUCTURE,
    registries: [{
      id: 'reg-1', displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
      tlsVerify: false, usernameCredentialRef: 'REF_REG_USER', passwordCredentialRef: 'REF_REG_PASS',
    }],
    gitProviders: [{ id: 'git-1', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example', tokenCredentialRef: 'REF_GIT_TOKEN' }],
    modelConnections: [{
      id: 'model-1', displayName: 'Model', apiMode: 'anthropic-messages',
      model: 'm', baseUrl: 'https://model.example', apiKeyCredentialRef: 'REF_MODEL_KEY',
    }],
    artifactStores: [{
      id: 'store-1', displayName: 'RustFS', kind: 's3', endpoint: 'http://10.43.0.1:9000',
      bucket: 'pactflow-artifacts', pathStyle: true,
      accessKeyCredentialRef: 'REF_STORE_ACCESS', secretKeyCredentialRef: 'REF_STORE_SECRET',
    }],
    workerPools: [],
  }

  const kindsWithRefs: readonly PactFlowInfrastructureResourceKind[] = [
    'registry', 'git-provider', 'model-connection', 'artifact-store',
  ]

  it('replaces every ref the collector returns, for every kind with credential refs', () => {
    for (const kind of kindsWithRefs) {
      const resource = (sample[kindRows(kind)] as readonly unknown[])[0]
      expect(resource, `sample resource for ${kind}`).toBeDefined()
      const refs = resourceCredentialRefs(kind, resource as never)
      expect(refs.length, `${kind} declares credential refs`).toBeGreaterThan(0)
      const replacements = new Map(refs.map(ref => [ref, `TEMP_${ref}`]))
      const replaced = replaceInfrastructureCredentialRefs(sample, replacements)
      const afterRefs = resourceCredentialRefs(kind, resourceRowsOf(replaced, kind)[0] as never)
      for (const ref of refs) {
        expect(afterRefs, `${kind} ref ${ref} must be swapped to its temporary credential`).toContain(`TEMP_${ref}`)
        expect(afterRefs).not.toContain(ref)
      }
    }
  })

  it('leaves kinds without credential refs untouched', () => {
    const pool: PactFlowWorkerPoolSettings = {
      id: 'pool-1', displayName: 'Pool', clusterId: 'cluster-1', registryId: 'reg-1',
      templateIds: [], maxConcurrency: 1, queuePolicy: 'fifo',
    }
    const settings: PactFlowInfrastructureSettings = { ...sample, workerPools: [pool] }
    const before = JSON.stringify(settings.workerPools)
    const replaced = replaceInfrastructureCredentialRefs(settings, new Map([['pool-1', 'temp']]))
    expect(JSON.stringify(replaced.workerPools)).toBe(before)
  })
})

function kindRows(kind: PactFlowInfrastructureResourceKind): keyof PactFlowInfrastructureSettings {
  switch (kind) {
    case 'registry': return 'registries'
    case 'git-provider': return 'gitProviders'
    case 'model-connection': return 'modelConnections'
    case 'artifact-store': return 'artifactStores'
    default: return 'workerPools'
  }
}

function resourceRowsOf(settings: PactFlowInfrastructureSettings, kind: PactFlowInfrastructureResourceKind): readonly unknown[] {
  return settings[kindRows(kind)] as readonly unknown[]
}
