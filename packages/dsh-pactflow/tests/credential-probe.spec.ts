import { describe, expect, it } from 'vitest'
import {
  replaceInfrastructureCredentialRefs,
  temporaryCredentialRef,
} from '../src/client/credential-probe.ts'
import type { PactFlowInfrastructureSettings } from '../src/types.ts'

describe('temporary infrastructure probe credentials', () => {
  it('uses a valid isolated reference and leaves the persisted draft immutable', () => {
    const settings: PactFlowInfrastructureSettings = {
      clusters: [],
      registries: [{
        id: 'harbor', displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.invalid',
        tlsVerify: true, passwordCredentialRef: 'PACTFLOW_HARBOR_PASSWORD',
      }],
      gitProviders: [{
        id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://gitea.invalid',
        tokenCredentialRef: 'PACTFLOW_GITEA_TOKEN',
      }],
      templates: [],
      modelConnections: [{
        id: 'model', displayName: 'Model', apiMode: 'openai-responses', model: 'model',
        baseUrl: 'https://model.invalid', apiKeyCredentialRef: 'PACTFLOW_MODEL_API_KEY',
      }],
      workerPools: [],
    }
    const temporary = temporaryCredentialRef('PACTFLOW_MODEL_API_KEY', 'probe-123')
    const replaced = replaceInfrastructureCredentialRefs(settings, new Map([
      ['PACTFLOW_HARBOR_PASSWORD', 'PACTFLOW_HARBOR_PASSWORD_PROBE_A'],
      ['PACTFLOW_MODEL_API_KEY', temporary],
    ]))

    expect(temporary).toBe('PACTFLOW_MODEL_API_KEY_PROBE_PROBE123')
    expect(replaced.registries[0]?.passwordCredentialRef).toBe('PACTFLOW_HARBOR_PASSWORD_PROBE_A')
    expect(replaced.gitProviders[0]?.tokenCredentialRef).toBe('PACTFLOW_GITEA_TOKEN')
    expect(replaced.modelConnections?.[0]?.apiKeyCredentialRef).toBe(temporary)
    expect(settings.registries[0]?.passwordCredentialRef).toBe('PACTFLOW_HARBOR_PASSWORD')
    expect(settings.modelConnections?.[0]?.apiKeyCredentialRef).toBe('PACTFLOW_MODEL_API_KEY')
  })
})
