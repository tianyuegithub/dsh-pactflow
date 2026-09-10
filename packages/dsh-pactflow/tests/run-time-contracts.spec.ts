import { describe, expect, it } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'

const digest = `sha256:${'a'.repeat(64)}`
const template = {
  id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/datavdl/pactflow-worker@${digest}`, model: 'glm-5.2',
  baseUrl: 'https://model.example.invalid/v1', modelSecretName: 'pactflow-model-claude',
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
}
function worker(overrides: Partial<PactFlowK3sConfig> = {}): PactFlowK3sWorker {
  return new PactFlowK3sWorker({
    namespace: 'pactflow', imagePullSecret: 'pactflow-registry', pollIntervalMs: 250, templates: [template], ...overrides,
  })
}

describe('PactFlow K3s run time contracts', () => {
  it('does not derive the Job wall-clock deadline from the ownership lease', () => {
    // A short lease is an ownership-renewal interval, not the task's wall-clock budget.
    const spec = worker().plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 5_000)
    // The old behaviour set activeDeadlineSeconds = lease/1000 = 5, killing healthy tasks.
    expect(spec.activeDeadlineSeconds).toBeGreaterThan(60)
  })

  it('honours an explicit wall-clock budget independently of the lease', () => {
    const spec = worker({ jobMaxWallClockSeconds: 1_800 })
      .plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 5_000)
    expect(spec.activeDeadlineSeconds).toBe(1_800)
  })

  it('floors an explicit budget so a tiny value cannot kill a task immediately', () => {
    const spec = worker({ jobMaxWallClockSeconds: 1 })
      .plan('run-11111111-2222-3333-4444-555555555555' as never, 'claude', 'git', 5_000)
    expect(spec.activeDeadlineSeconds).toBeGreaterThanOrEqual(60)
  })
})
