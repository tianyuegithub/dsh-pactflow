import { describe, expect, it } from 'vitest'
import { PactFlowInfrastructure } from '../src/infrastructure.ts'
import { harborProjectName, harborRepositoryPathSegment, probeHttp } from '../src/infrastructure-probe.ts'
import { synchronizeHarnessTemplates } from '../src/harness-discovery.ts'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PactFlowInfrastructureHealthStore } from '../src/infrastructure-health.ts'
import { harnessVersionCommand } from '../src/k3s-worker.ts'
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

describe('PactFlow infrastructure resources', () => {
  it('normalizes Harbor project-prefixed repositories and double-encodes nested paths', () => {
    expect(harborRepositoryPathSegment(
      'datavdl', 'datavdl/prometheus-operator/prometheus-config-reloader',
    )).toBe('prometheus-operator%252Fprometheus-config-reloader')
    expect(harborRepositoryPathSegment('datavdl', 'datavdl/worker')).toBe('worker')
    expect(harborProjectName(' /datavdl/ ')).toBe('datavdl')
  })

  it('probes each Harness image through its own CLI without a model endpoint', () => {
    expect(harnessVersionCommand('claude')).toEqual(['claude', '--version'])
    expect(harnessVersionCommand('codex')).toEqual(['codex', '--version'])
    expect(harnessVersionCommand('opencode')).toEqual(['opencode', '--version'])
    expect(harnessVersionCommand('dsh')).toEqual(['dsh', '--version'])
  })

  it('synchronizes four Harness image identities without overwriting resource limits', () => {
    const artifacts = [
      ['claudecode-ox_v1', '1'], ['codex-ox_v1', '2'], ['opencode-ox_v1', '3'], ['dsh-ox_v1', '4'],
    ].map(([tag, suffix]) => ({
      registryId: 'harbor', repository: 'pactflow-worker', tags: [tag!],
      digest: `sha256:${suffix!.repeat(64)}`, label: `pactflow-worker:${tag!}`,
    }))
    const result = synchronizeHarnessTemplates('harbor', 'pactflow-worker', artifacts, [{
      id: 'codex-custom', displayName: 'Codex', harness: 'codex', registryId: 'old',
      repository: 'old', artifactDigest: `sha256:${'a'.repeat(64)}`,
      cpuRequest: '750m', memoryRequest: '2Gi', cpuLimit: '3', memoryLimit: '6Gi',
    }])
    expect(result.found).toEqual(['claude', 'codex', 'opencode', 'dsh'])
    expect(result.missing).toEqual([])
    expect(result.templates).toHaveLength(4)
    expect(result.templates.find(item => item.harness === 'codex')).toMatchObject({
      id: 'codex-custom', registryId: 'harbor', repository: 'pactflow-worker',
      artifactDigest: `sha256:${'2'.repeat(64)}`, cpuRequest: '750m', memoryLimit: '6Gi',
    })
  })

  it('keeps an existing Harness template when its Harbor image is temporarily missing', () => {
    const existing = [{
      id: 'dsh', displayName: 'DSH', harness: 'dsh' as const, registryId: 'harbor',
      repository: 'pactflow-worker', artifactDigest: `sha256:${'d'.repeat(64)}`,
      cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
    }]
    const result = synchronizeHarnessTemplates('harbor', 'pactflow-worker', [], existing)
    expect(result.missing).toEqual(['claude', 'codex', 'opencode', 'dsh'])
    expect(result.templates).toEqual(existing)
  })

  it('persists redacted health results and invalidates them when configuration changes', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pactflow-health-'))
    try {
      const path = join(root, 'health.json')
      const store = new PactFlowInfrastructureHealthStore(path)
      const configured = settings()
      await store.record(configured, {
        kind: 'cluster', id: 'home', success: true, durationMs: 12,
        stages: [{ name: 'namespace-access', state: 'succeeded', detail: 'namespace pactflow is accessible' }],
      })
      await expect(store.list(configured)).resolves.toMatchObject([{
        probeContractVersion: 2, kind: 'cluster', id: 'home', state: 'succeeded', durationMs: 12,
      }])
      expect(await readFile(path, 'utf8')).not.toContain('password')
      await expect(store.list(settings({
        clusters: [{ ...configured.clusters[0]!, namespace: 'changed' }],
      }))).resolves.toEqual([])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('resolves references into an immutable K3s pool view and matches SSH Gitea remotes', () => {
    const infrastructure = new PactFlowInfrastructure(settings())
    expect(infrastructure.resolve('default', 'claude')).toMatchObject({
      pool: { id: 'default', maxConcurrency: 1 },
      k3s: { namespace: 'pactflow', imagePullSecret: 'harbor-pull', templates: [template] },
    })
    expect(infrastructure.matchGitea('ssh://git@git.example:22/data/data-governance.git')).toMatchObject({
      provider: { id: 'gitea' }, owner: 'data', repo: 'data-governance',
    })
  })

  it('fails closed for broken references, mutable images, and ambiguous providers', () => {
    expect(() => new PactFlowInfrastructure(settings({
      workerPools: [{
        id: 'default', displayName: 'Default', clusterId: 'missing', registryId: 'harbor',
        templateIds: ['claude'], maxConcurrency: 1, queuePolicy: 'fifo',
      }],
    }))).toThrow(/unknown cluster/)
    expect(() => new PactFlowInfrastructure(settings({ templates: [{ ...template, image: 'worker:latest' }] })))
      .toThrow(/sha256 digest/)
    const ambiguous = new PactFlowInfrastructure(settings({
      gitProviders: [
        ...settings().gitProviders,
        { id: 'gitea-two', displayName: 'Two', kind: 'gitea', baseUrl: 'https://git.example:4000', tokenCredentialRef: 'two' },
      ],
    }))
    expect(() => ambiguous.matchGitea('git@git.example:data/repo.git')).toThrow(/multiple Gitea/)
    expect(() => new PactFlowInfrastructure(settings({
      gitProviders: [{
        id: 'gitea', displayName: 'Gitea', kind: 'gitea', baseUrl: 'https://git.example',
        tokenCredentialRef: 'pactflow/gitea',
      }],
    }))).toThrow(/Credential ref is invalid/)
  })

  it('enforces FIFO capacity, exposes counters, and removes cancelled waiters', async () => {
    const infrastructure = new PactFlowInfrastructure(settings())
    const releaseFirst = await infrastructure.acquire('default')
    const order: string[] = []
    const second = infrastructure.acquire('default').then((release) => { order.push('second'); return release })
    const abort = new AbortController()
    const cancelled = infrastructure.acquire('default', abort.signal)
    expect(infrastructure.statuses()[0]).toMatchObject({ running: 1, waiting: 2 })
    abort.abort()
    await expect(cancelled).rejects.toThrow(/cancelled/)
    expect(infrastructure.statuses()[0]).toMatchObject({ running: 1, waiting: 1 })
    releaseFirst()
    const releaseSecond = await second
    expect(order).toEqual(['second'])
    expect(infrastructure.statuses()[0]).toMatchObject({ running: 1, waiting: 0 })
    releaseSecond()
    releaseSecond()
    expect(infrastructure.statuses()[0]).toMatchObject({ running: 0, waiting: 0 })
  })

  it('runs a bounded real HTTP probe without consuming response content', async () => {
    const server = createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('secret-looking-response-body-must-not-be-returned')
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    try {
      const address = server.address()
      if (address === null || typeof address === 'string') throw new Error('test server has no TCP address')
      await expect(probeHttp({ url: `http://127.0.0.1:${String(address.port)}/ping` })).resolves.toBe(200)
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error === undefined ? resolve() : reject(error)))
    }
  })

  it('keeps Harness and model connections independent until execution resolution', () => {
    const infrastructure = new PactFlowInfrastructure({
      clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
      registries: [{
        id: 'harbor', displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
        project: 'pactflow', tlsVerify: true,
      }],
      gitProviders: [],
      templates: [{
        id: 'claude', displayName: 'Claude Code', harness: 'claude', registryId: 'harbor',
        repository: 'worker', artifactDigest: `sha256:${'b'.repeat(64)}`,
        cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
      }],
      modelConnections: [{
        id: 'glm', displayName: 'GLM', apiMode: 'anthropic-messages', model: 'glm-5.2',
        baseUrl: 'https://model.invalid', apiKeyCredentialRef: 'PACTFLOW_MODEL_GLM_API_KEY',
      }],
      workerPools: [{
        id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
        templateIds: ['claude'], maxConcurrency: 2, queuePolicy: 'fifo', imagePullSecret: 'harbor-pull',
      }],
    })
    expect(infrastructure.resolveExecution('default', 'claude', 'glm')).toMatchObject({
      executionTemplateId: 'claude--glm',
      modelConnection: { id: 'glm' },
      k3s: {
        imagePullSecret: 'harbor-pull',
        templates: [expect.objectContaining({
          id: 'claude--glm', image: `harbor.example/pactflow/worker@sha256:${'b'.repeat(64)}`,
          model: 'glm-5.2', apiMode: 'anthropic-messages',
        })],
      },
    })
  })

  it('rejects an execution pool with no protocol-compatible model connection', () => {
    expect(() => new PactFlowInfrastructure({
      clusters: [{ id: 'home', displayName: 'Home', namespace: 'pactflow', pollIntervalMs: 1_000 }],
      registries: [{
        id: 'harbor', displayName: 'Harbor', kind: 'harbor', endpoint: 'https://harbor.example',
        tlsVerify: true,
      }],
      gitProviders: [],
      templates: [{
        id: 'claude', displayName: 'Claude Code', harness: 'claude', registryId: 'harbor',
        repository: 'worker', artifactDigest: `sha256:${'b'.repeat(64)}`,
        cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
      }],
      modelConnections: [{
        id: 'openai', displayName: 'OpenAI', apiMode: 'openai-responses', model: 'gpt',
        baseUrl: 'https://model.invalid', apiKeyCredentialRef: 'PACTFLOW_MODEL_OPENAI_API_KEY',
      }],
      workerPools: [{
        id: 'default', displayName: 'Default', clusterId: 'home', registryId: 'harbor',
        templateIds: ['claude'], maxConcurrency: 1, queuePolicy: 'fifo', imagePullSecret: 'harbor-pull',
      }],
    })).toThrow(/no compatible model connection/)
  })
})
