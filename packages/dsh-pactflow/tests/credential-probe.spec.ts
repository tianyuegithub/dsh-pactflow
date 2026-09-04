import { describe, expect, it } from 'vitest'
import {
  releaseTemporaryCredentialRefs,
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

  it('retains failed cleanup refs so a later attempt can retry them', async () => {
    const references = new Map([['PACTFLOW_MODEL_API_KEY', 'PACTFLOW_MODEL_API_KEY_PROBE_A']])
    const first = await releaseTemporaryCredentialRefs(
      references,
      async () => { throw new Error('credentials service unavailable') },
      ['PACTFLOW_MODEL_API_KEY'],
    )

    expect(first).toMatchObject({ released: [], failed: ['PACTFLOW_MODEL_API_KEY'] })
    expect(references.get('PACTFLOW_MODEL_API_KEY')).toBe('PACTFLOW_MODEL_API_KEY_PROBE_A')

    const second = await releaseTemporaryCredentialRefs(
      references,
      async () => {},
      ['PACTFLOW_MODEL_API_KEY'],
    )
    expect(second).toMatchObject({ released: ['PACTFLOW_MODEL_API_KEY'], failed: [] })
    expect(references.has('PACTFLOW_MODEL_API_KEY')).toBe(false)
  })

  it('fails closed when a new temporary ref replaces the one being released', async () => {
    const reference = 'PACTFLOW_MODEL_API_KEY'
    const references = new Map([[reference, 'PACTFLOW_MODEL_API_KEY_PROBE_A']])

    const result = await releaseTemporaryCredentialRefs(references, async () => {
      references.set(reference, 'PACTFLOW_MODEL_API_KEY_PROBE_B')
    }, [reference])

    expect(result).toMatchObject({ released: [], failed: [reference] })
    expect(references.get(reference)).toBe('PACTFLOW_MODEL_API_KEY_PROBE_B')
  })
})
