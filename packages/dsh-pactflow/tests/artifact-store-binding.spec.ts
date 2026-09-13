import { describe, expect, it } from 'vitest'
import { PactFlowInfrastructure } from '../src/infrastructure.ts'
import { pactFlowWorkspaceProjectSchema } from '../src/schema.ts'
import type { PactFlowInfrastructureSettings } from '../src/types.ts'

const template = {
  id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
  image: `harbor.example/pactflow/worker@sha256:${'a'.repeat(64)}`,
  model: 'glm-5.2', baseUrl: 'https://model.invalid', modelSecretName: 'model-secret',
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
}

function settings(overrides: Partial<PactFlowInfrastructureSettings> = {}): PactFlowInfrastructureSettings {
  return {
    clusters: [{ id: 'home', displayName: 'Home K3s', namespace: 'pactflow', pollIntervalMs: 1_000 }],
    registries: [{
      id: 'harbor', displayName: 'Home Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
      project: 'pactflow', tlsVerify: false, imagePullSecret: 'harbor-pull',
    }],
    gitProviders: [{
      id: 'gitea', displayName: 'Home Gitea', kind: 'gitea', baseUrl: 'https://git.example:3000',
      tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
    }],
    templates: [template],
    workerPools: [{
      id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
      templateIds: ['claude'], maxConcurrency: 1, queuePolicy: 'fifo',
    }],
    ...overrides,
  }
}

const store = {
  id: 'rustfs', displayName: 'Home RustFS', kind: 's3' as const,
  endpoint: 'http://10.43.146.89:9000', bucket: 'pactflow-artifacts', pathStyle: true,
  accessKeyCredentialRef: 'PACTFLOW_ARTIFACT_ACCESS_KEY', secretKeyCredentialRef: 'PACTFLOW_ARTIFACT_SECRET_KEY',
}

const projectConfig = {
  schema: 'dsh_pactflow_workspace_project/v1' as const,
  workspaceId: 'ws-1', workspacePath: '/tmp/ws-1', workspaceTitle: 'WS',
  revision: 1, createdAt: 1, updatedAt: 1,
}

describe('PactFlow artifact store binding', () => {
  it('registers a private-endpoint store and resolves it by id', () => {
    const infrastructure = new PactFlowInfrastructure(settings({ artifactStores: [store] }))
    expect(infrastructure.artifactStore('rustfs')?.bucket).toBe('pactflow-artifacts')
    expect(infrastructure.artifactStore('absent')).toBeUndefined()
  })

  it('keeps every existing behavior when no store is configured', () => {
    expect(() => new PactFlowInfrastructure(settings())).not.toThrow()
    const infrastructure = new PactFlowInfrastructure(settings())
    expect(infrastructure.artifactStore('rustfs')).toBeUndefined()
  })

  it('rejects plain HTTP to non-cluster-internal endpoints', () => {
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [{ ...store, endpoint: 'http://rustfs.example.com:9000' }],
    }))).toThrow(/HTTPS/)
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [{ ...store, endpoint: 'http://8.8.8.8:9000' }],
    }))).toThrow(/HTTPS/)
  })

  it('accepts cluster-internal plain HTTP forms', () => {
    for (const endpoint of ['http://10.43.146.89:9000', 'http://192.168.31.7:32571', 'http://rustfs:9000', 'http://127.0.0.1:9000']) {
      expect(() => new PactFlowInfrastructure(settings({
        artifactStores: [{ ...store, endpoint }],
      }))).not.toThrow()
    }
  })

  it('rejects invalid buckets, virtual-host style, and invalid credential refs', () => {
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [{ ...store, bucket: 'UPPER' }],
    }))).toThrow(/bucket/)
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [{ ...store, pathStyle: false }],
    }))).toThrow(/path-style/)
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [{ ...store, accessKeyCredentialRef: 'not a ref!' }],
    }))).toThrow(/Credential ref/)
  })

  it('rejects duplicate store ids', () => {
    expect(() => new PactFlowInfrastructure(settings({
      artifactStores: [store, { ...store, endpoint: 'http://10.0.0.2:9000' }],
    }))).toThrow(/artifact store/)
  })

  it('parses workspace configs with and without the artifact binding', () => {
    expect(pactFlowWorkspaceProjectSchema.parse(projectConfig)).not.toHaveProperty('artifact')
    const bound = pactFlowWorkspaceProjectSchema.parse({ ...projectConfig, artifact: { artifactStoreId: 'rustfs', boundAt: 123 } })
    expect(bound.artifact).toEqual({ artifactStoreId: 'rustfs', boundAt: 123 })
    expect(() => pactFlowWorkspaceProjectSchema.parse({ ...projectConfig, artifact: { artifactStoreId: '', boundAt: 1 } })).toThrow()
    expect(() => pactFlowWorkspaceProjectSchema.parse({ ...projectConfig, artifact: { artifactStoreId: 'rustfs', boundAt: -1 } })).toThrow()
  })
})
