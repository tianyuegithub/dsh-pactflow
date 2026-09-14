import { describe, expect, it, vi } from 'vitest'
import { harnessTimeoutSeconds, PactFlowK3sWorker, pactFlowK3sSpecDigest, pactFlowSecretHash } from '../src/k3s-worker.ts'
import type { PactFlowK3sRunSpec } from '../src/types.ts'

/**
 * Three pieces of arithmetic that turned the Host's own budgets into failures
 * attributed to something else.
 */

const spec: PactFlowK3sRunSpec = {
  jobUid: 'arith-job-uid', runNonceHash: '1'.repeat(64), claimTokenHash: '2'.repeat(64),
  templateId: 'dsh', namespace: 'pactflow', jobName: 'dsh-pf-arith', configMapName: 'dsh-pf-arith',
  image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`, imagePullSecret: 'pull',
  harness: 'dsh', apiMode: 'openai-chat-completions', model: 'model', baseUrl: 'https://model.invalid',
  modelSecretName: 'dsh-pf-arith-model', gitSecretName: 'pactflow-git-secret',
  cpuRequest: '100m', memoryRequest: '128Mi', cpuLimit: '1', memoryLimit: '1Gi',
  activeDeadlineSeconds: 3_600, finishedJobTtlSeconds: 86_400,
}

const git = {
  remote: 'origin', remoteUrl: 'https://git.invalid/o/r.git', defaultBranch: 'main',
  baseCommit: 'b'.repeat(40), branch: 'pactflow/task', worktreePath: '/tmp/wt', validationCommands: [],
}

function worker(): PactFlowK3sWorker {
  return new PactFlowK3sWorker({ namespace: 'pactflow', imagePullSecret: 'pull', pollIntervalMs: 250, templates: [] })
}

describe('PactFlow Harness wall-clock reservation', () => {
  it('leaves the CLI a usable budget on a short probe', () => {
    // A flat 30-second reservation only ever made sense against the 3600s Run
    // default. `probe(…, 15_000, …)` produced `max(1, 15 - 30)` = one second, so
    // the CLI necessarily timed out and the operator was told the model
    // connection was unavailable — a verdict about someone else's system,
    // caused entirely by this expression.
    expect(harnessTimeoutSeconds(15)).toBeGreaterThan(1)
    expect(harnessTimeoutSeconds(15)).toBeLessThan(15)
    expect(harnessTimeoutSeconds(10)).toBeGreaterThan(1)
  })

  it('reserves exactly the same 30 seconds on a long Run budget', () => {
    expect(harnessTimeoutSeconds(3_600)).toBe(3_570)
    expect(harnessTimeoutSeconds(600)).toBe(570)
  })

  it('never returns a non-positive budget', () => {
    for (const seconds of [1, 2, 3, 5, 8, 13, 60, 3_600, 86_400]) {
      expect(harnessTimeoutSeconds(seconds), String(seconds)).toBeGreaterThanOrEqual(1)
      expect(harnessTimeoutSeconds(seconds)).toBeLessThanOrEqual(seconds)
    }
  })
})

describe('PactFlow prepared runtime secrets are released on every terminal path', () => {
  it.each([
    ['the spec digest does not reconcile', 'digest'],
    ['the claim secrets do not match', 'claim'],
  ] as const)('releases them when %s', async (_label, variant) => {
    // The caller sets `runStarted = true` BEFORE calling run(), on the premise
    // that run() owns the prepared secrets from here and releases them on every
    // terminal path — so an early throw that skips the release strands a 32-byte
    // runNonce and claimToken in memory, once per retry, for the process's life.
    const instance = worker()
    const secrets = { runNonce: 'n'.repeat(32), claimToken: 'c'.repeat(32) }
    const pending = new Map([[spec.jobName, secrets]])
    Reflect.set(instance, 'pendingRuntimeSecrets', pending)

    const base = {
      ...spec,
      runNonceHash: pactFlowSecretHash(secrets.runNonce),
      claimTokenHash: pactFlowSecretHash(secrets.claimToken),
    }
    const planned: PactFlowK3sRunSpec = variant === 'digest'
      // A digest that does not correspond to these inputs.
      ? { ...base, specDigest: 'f'.repeat(64) }
      // Correct digest, but the prepared secrets are not the ones this spec names.
      : { ...base, runNonceHash: '9'.repeat(64), specDigest: undefined }

    await expect(instance.run(planned, git, 'prompt', new AbortController().signal)).rejects.toThrow()
    expect(pending.has(spec.jobName), 'the prepared secrets must not outlive the refusal').toBe(false)
  })

  it('accepts the run when digest and claim secrets both reconcile', async () => {
    const instance = worker()
    const secrets = { runNonce: 'n'.repeat(32), claimToken: 'c'.repeat(32) }
    Reflect.set(instance, 'pendingRuntimeSecrets', new Map([[spec.jobName, secrets]]))
    const base = {
      ...spec,
      runNonceHash: pactFlowSecretHash(secrets.runNonce),
      claimTokenHash: pactFlowSecretHash(secrets.claimToken),
    }
    const planned: PactFlowK3sRunSpec = { ...base, specDigest: pactFlowK3sSpecDigest(base, git, 'prompt') }
    Reflect.set(instance, 'core', {
      createNamespacedSecret: vi.fn(async () => { throw new Error('stop after admission') }),
      createNamespacedConfigMap: vi.fn(async () => { throw new Error('stop after admission') }),
    })
    // Past both gates: the failure comes from creating a cluster resource, which
    // only happens after admission accepted the spec.
    await expect(instance.run(planned, git, 'prompt', new AbortController().signal))
      .rejects.toThrow(/failed to create/)
  })
})
