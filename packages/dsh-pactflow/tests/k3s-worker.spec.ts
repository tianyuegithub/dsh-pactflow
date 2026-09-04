import { describe, expect, it } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import type { PactFlowGitRunSpec } from '../src/types.ts'

const digest = `sha256:${'a'.repeat(64)}`
const template = {
  id: 'claude',
  harness: 'claude' as const,
  apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/datavdl/pactflow-worker@${digest}`,
  model: 'glm-5.2',
  baseUrl: 'https://model.example.invalid/v1',
  modelSecretName: 'pactflow-model-claude',
  cpuRequest: '500m',
  memoryRequest: '1Gi',
  cpuLimit: '2',
  memoryLimit: '4Gi',
}

function config(overrides: Partial<PactFlowK3sConfig> = {}): PactFlowK3sConfig {
  return {
    namespace: 'pactflow',
    imagePullSecret: 'pactflow-registry',
    pollIntervalMs: 250,
    templates: [template],
    ...overrides,
  }
}

describe('PactFlow K3s Worker provider', () => {
  it('keeps Harness/API compatibility fixed and plans immutable digest Jobs', () => {
    const worker = new PactFlowK3sWorker(config())
    expect(worker.listTemplates()).toEqual([template])
    const spec = worker.plan(
      `run-${'1'.repeat(8)}-${'2'.repeat(4)}-${'3'.repeat(4)}-${'4'.repeat(4)}-${'5'.repeat(12)}` as never,
      'claude',
      'pactflow-git',
      60_000,
    )
    expect(spec).toMatchObject({
      templateId: 'claude',
      harness: 'claude',
      apiMode: 'anthropic-messages',
      activeDeadlineSeconds: 60,
      image: template.image,
      gitSecretName: 'pactflow-git',
    })
    expect(spec.jobName).toMatch(/^dsh-pf-[a-z0-9-]+$/)
    expect(spec.runNonceHash).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.claimTokenHash).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.specDigest).toMatch(/^[0-9a-f]{64}$/)
    expect(spec.inputSecretName).toMatch(/^dsh-pf-[a-z0-9-]+-input$/)
  })

  it('rejects protocol drift, mutable image tags, duplicate ids, and unknown templates', () => {
    expect(() => new PactFlowK3sWorker(config({ kubeconfig: 'relative/config' })))
      .toThrow(/absolute path/)
    expect(() => new PactFlowK3sWorker(config({
      templates: [{ ...template, apiMode: 'openai-chat-completions' }],
    }))).toThrow(/does not support/)
    expect(() => new PactFlowK3sWorker(config({
      templates: [{ ...template, image: 'registry.invalid/worker:latest' }],
    }))).toThrow(/sha256 digest/)
    expect(() => new PactFlowK3sWorker(config({ templates: [template, template] })))
      .toThrow(/duplicate/)
    const worker = new PactFlowK3sWorker(config())
    expect(() => worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'missing', 'git', 60_000))
      .toThrow(/not configured/)
  })

  it('keeps prompts in the Job-owned input Secret rather than the ConfigMap', () => {
    const worker = new PactFlowK3sWorker(config())
    const spec = worker.plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 60_000)
    const configMap = (Reflect.get(worker, 'configMap') as (value: unknown) => { data?: Record<string, string> }).call(worker, spec)
    expect(configMap.data?.['spec.json']).toBeUndefined()
    expect(configMap.data?.['worker.sh']).toContain('pactflow-input')
  })

  it('admits only bounded prompts and SSH Git remotes before claim', () => {
    const worker = new PactFlowK3sWorker(config())
    const base: PactFlowGitRunSpec = {
      remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
      baseCommit: 'a'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/worktree',
      validationCommands: [],
    }
    expect(() => worker.preflightRun(base, 'do the task')).not.toThrow()
    expect(() => worker.preflightRun({ ...base, remoteUrl: 'https://gitea.invalid/org/repo.git' }, 'task'))
      .toThrow(/require an SSH Git remote/)
    expect(() => worker.preflightRun(base, '')).toThrow(/1-262144/)
  })

})
