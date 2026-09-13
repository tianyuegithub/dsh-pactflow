import { describe, expect, it, vi } from 'vitest'
import { PactFlowK3sWorker, type PactFlowK3sConfig } from '../src/k3s-worker.ts'
import type { PactFlowGitRunSpec, PactFlowK3sRunSpec } from '../src/types.ts'
import type { V1ConfigMap, V1Job, V1Secret } from '@kubernetes/client-node'

const template = {
  id: 'claude', harness: 'claude' as const, apiMode: 'anthropic-messages' as const,
  image: `registry.invalid/datavdl/pactflow-worker@sha256:${'a'.repeat(64)}`,
  model: 'glm-5.2', baseUrl: 'https://model.example.invalid/v1', modelSecretName: 'pactflow-model-claude',
  cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
}

function config(overrides: Partial<PactFlowK3sConfig> = {}): PactFlowK3sConfig {
  return { namespace: 'pactflow', imagePullSecret: 'pactflow-registry', pollIntervalMs: 250, templates: [template], ...overrides }
}

const git = (): PactFlowGitRunSpec => ({ remote: 'origin', remoteUrl: 'ssh://git@gitea.invalid/org/repo.git', defaultBranch: 'main',
  baseCommit: 'b'.repeat(40), branch: 'pactflow/need/node/run', worktreePath: '/tmp/isolated-k3s-artifact-test', validationCommands: [] })

const artifactStore = {
  secretName: 'dsh-pf-artifact-test-store', endpoint: 'http://10.43.146.89:9000',
  bucket: 'pactflow-artifacts', region: 'us-east-1',
}
const credentials = { accessKeyId: 'AKTESTCREDENTIAL', secretAccessKey: 'SKTESTCREDENTIAL-VALUE' }

const RUN_ID = 'run-11111111-2222-3333-4444-555555555555' as never

function stubHappy(worker: PactFlowK3sWorker): {
  readonly jobs: V1Job[]
  readonly secrets: V1Secret[]
  readonly configMaps: V1ConfigMap[]
  readonly intents: Array<{ readonly phase: string; readonly jobName: string; readonly childNames?: readonly string[] }>
} {
  const jobs: V1Job[] = []
  const secrets: V1Secret[] = []
  const configMaps: V1ConfigMap[] = []
  const intents: Array<{ readonly phase: string; readonly jobName: string; readonly childNames?: readonly string[] }> = []
  Reflect.set(worker, 'core', {
    createNamespacedSecret: async ({ body }: { body: V1Secret }) => {
      const stored = { ...body, metadata: { ...body.metadata, uid: `uid-${body.metadata?.name}` } }
      secrets.push(stored)
      return stored
    },
    createNamespacedConfigMap: async ({ body }: { body: V1ConfigMap }) => {
      const stored = { ...body, metadata: { ...body.metadata, uid: `uid-${body.metadata?.name}` } }
      configMaps.push(stored)
      return stored
    },
    replaceNamespacedSecret: async () => {}, replaceNamespacedConfigMap: async () => {},
    readNamespacedSecret: async () => secrets[0], readNamespacedConfigMap: async () => configMaps[0],
    listNamespacedPod: async () => ({ items: [] }),
    deleteNamespacedSecret: async () => {}, deleteNamespacedConfigMap: async () => {},
  })
  Reflect.set(worker, 'batch', {
    createNamespacedJob: async ({ body }: { body: V1Job }) => {
      const stored = { ...body, metadata: { ...body.metadata, uid: 'uid-job' } }
      jobs.push(stored)
      return stored
    },
    readNamespacedJob: async () => jobs[0],
    deleteNamespacedJob: async () => {},
  })
  Reflect.set(worker, 'waitForResult', async () => ({
    podName: 'pod', exitCode: 0, commit: 'c'.repeat(40), branch: 'pactflow/need/node/run',
    harnessVersion: '1.0', finishedAt: 1,
  }))
  return { jobs, secrets, configMaps, intents: intents }
}

function recording(worker: PactFlowK3sWorker, intents: unknown[]): (entry: unknown) => Promise<void> {
  return async entry => { intents.push(entry) }
}

describe('PactFlow K3s artifact store injection', () => {
  it('plan validates the artifact store inputs and folds them into the spec digest', () => {
    const worker = new PactFlowK3sWorker(config())
    const plain = worker.plan(RUN_ID, 'claude', 'git', 60_000)
    const withStore = worker.plan(RUN_ID, 'claude', 'git', 60_000, undefined, '', artifactStore)
    expect(withStore.artifactStore).toEqual(artifactStore)
    expect(withStore.specDigest).not.toBe(plain.specDigest)
    expect(() => worker.plan(RUN_ID, 'claude', 'git', 60_000, undefined, '', { ...artifactStore, bucket: 'UPPER!' })).toThrow(/bucket/)
    expect(() => worker.plan(RUN_ID, 'claude', 'git', 60_000, undefined, '', { ...artifactStore, endpoint: 'ftp://x' })).toThrow(/http/)
  })

  it('creates the per-run Secret, records it in the creation intent, and injects env via secretKeyRef', async () => {
    const worker = new PactFlowK3sWorker(config())
    const fixture = stubHappy(worker)
    const intents: unknown[] = []
    const runSpec: PactFlowK3sRunSpec = worker.plan(RUN_ID, 'claude', 'git', 60_000, git(), 'task', artifactStore)
    await worker.run(runSpec, git(), 'task', new AbortController().signal, undefined, undefined, undefined,
      recording(worker, intents), credentials)

    const intent = intents.find(entry => (entry as { phase: string }).phase === 'intent') as { childNames?: readonly string[] }
    expect(intent.childNames).toContain(artifactStore.secretName)

    const artifactSecret = fixture.secrets.find(secret => secret.metadata?.name === artifactStore.secretName)
    expect(artifactSecret?.stringData).toEqual({
      'access-key-id': credentials.accessKeyId, 'secret-access-key': credentials.secretAccessKey,
    })

    const job = fixture.jobs[0]
    const container = job.spec?.template.spec?.containers[0]
    const envNames = new Set((container?.env ?? []).map(item => item.name))
    for (const name of ['PACTFLOW_ARTIFACT_ENDPOINT', 'PACTFLOW_ARTIFACT_BUCKET', 'PACTFLOW_ARTIFACT_ACCESS_KEY_ID', 'PACTFLOW_ARTIFACT_SECRET_ACCESS_KEY']) {
      expect(envNames.has(name)).toBe(true)
    }
    const secretEnv = (container?.env ?? []).filter(item => item.valueFrom?.secretKeyRef?.name === artifactStore.secretName)
    expect(secretEnv.map(item => item.name).sort()).toEqual(['PACTFLOW_ARTIFACT_ACCESS_KEY_ID', 'PACTFLOW_ARTIFACT_SECRET_ACCESS_KEY'])

    // Credentials stay out of ConfigMaps and the input Secret entirely.
    const configMapText = JSON.stringify(fixture.configMaps)
    const inputSecret = fixture.secrets.find(secret => secret.metadata?.name?.endsWith('-input'))
    expect(configMapText).not.toContain(credentials.accessKeyId)
    expect(configMapText).not.toContain(credentials.secretAccessKey)
    expect(JSON.stringify(inputSecret)).not.toContain(credentials.accessKeyId)
    expect(JSON.stringify(inputSecret)).not.toContain(credentials.secretAccessKey)
    // Plain env carries only endpoint/bucket/region, never key material.
    const plainValues = (container?.env ?? []).filter(item => item.value !== undefined)
      .map(item => String(item.value)).join('\n')
    expect(plainValues).not.toContain(credentials.accessKeyId)
    expect(plainValues).not.toContain(credentials.secretAccessKey)
    expect(plainValues).toContain(artifactStore.endpoint)
    expect(plainValues).toContain(artifactStore.bucket)
  })

  it('refuses to run with an artifact store binding but no credentials', async () => {
    const worker = new PactFlowK3sWorker(config())
    const fixture = stubHappy(worker)
    const runSpec: PactFlowK3sRunSpec = worker.plan(RUN_ID, 'claude', 'git', 60_000, git(), 'task', artifactStore)
    await expect(worker.run(runSpec, git(), 'task', new AbortController().signal, undefined, undefined, undefined, undefined))
      .rejects.toThrow(/artifact store credentials are required/)
    expect(fixture.jobs).toHaveLength(0)
    expect(fixture.secrets).toHaveLength(0)
  })

  it('runs unchanged when no artifact store is bound (zero regression)', async () => {
    const worker = new PactFlowK3sWorker(config())
    const fixture = stubHappy(worker)
    const runSpec = worker.plan(RUN_ID, 'claude', 'git', 60_000, git(), 'task')
    await worker.run(runSpec, git(), 'task', new AbortController().signal, undefined, undefined, undefined, undefined)
    expect(fixture.secrets.every(secret => secret.metadata?.name !== artifactStore.secretName)).toBe(true)
    const container = fixture.jobs[0].spec?.template.spec?.containers[0]
    expect((container?.env ?? []).some(item => item.name?.startsWith('PACTFLOW_ARTIFACT_'))).toBe(false)
  })

  function observeFixture(worker: PactFlowK3sWorker, runSpec: PactFlowK3sRunSpec, terminated: { exitCode: number; message: string }): void {
    const labels = Reflect.get(worker, 'labels').call(worker, runSpec) as Record<string, string>
    const annotations = Reflect.get(worker, 'annotations').call(worker, runSpec) as Record<string, string>
    const withUid = { ...runSpec, jobUid: 'job-uid' }
    Reflect.set(worker, 'batch', { readNamespacedJob: async () => ({ metadata: { uid: 'job-uid', labels, annotations }, status: { succeeded: 1 } }) })
    Reflect.set(worker, 'core', { listNamespacedPod: async () => ({ items: [{
      metadata: { name: 'worker-pod', labels, annotations, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job',
        name: runSpec.jobName, uid: 'job-uid', controller: true }] },
      status: { containerStatuses: [{ name: 'worker', imageID: `${runSpec.image.split('@')[0]}@${runSpec.image.split('@')[1]}`,
        state: { terminated: { exitCode: terminated.exitCode, finishedAt: new Date(), message: terminated.message } } }] },
    }] }) })
    void withUid
  }

  it('carries the externalized log fields from the result document into the result', async () => {
    const worker = new PactFlowK3sWorker(config())
    const gitSpec = git()
    const runSpec: PactFlowK3sRunSpec = { ...worker.plan(RUN_ID, 'claude', 'git', 60_000, gitSpec, 'task'), jobUid: 'job-uid' }
    const document = { schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit: 'c'.repeat(40),
      branch: runSpec.expectedBranch, harnessVersion: 'test', agentExitCode: 0, pushExitCode: 0,
      runNonceHash: runSpec.runNonceHash, claimTokenHash: runSpec.claimTokenHash, specDigest: runSpec.specDigest,
      logTail: 'last lines of the run', logDegraded: false,
      logArtifact: { uri: `s3://pactflow-artifacts/need-1/${runSpec.jobName}/0-execution-log-runner-aa.txt`,
        etag: '"0102030405060708090a0b0c0d0e0f10"', bytes: 12, hash: 'a'.repeat(64), kind: 'execution-log', summary: 'tail' } }
    observeFixture(worker, runSpec, { exitCode: 0, message: JSON.stringify(document) })
    const observation = await worker.observe(runSpec)
    expect(observation.state).toBe('succeeded')
    if (observation.state !== 'succeeded') return
    expect(observation.result.logTail).toBe('last lines of the run')
    expect(observation.result.logArtifact?.kind).toBe('execution-log')
    expect(observation.result.logDegraded).toBe(false)
  })

  it('rejects a result document over the result-channel budget with the oversize marker', async () => {
    const worker = new PactFlowK3sWorker(config())
    const runSpec: PactFlowK3sRunSpec = { ...worker.plan(RUN_ID, 'claude', 'git', 60_000, git(), 'task'), jobUid: 'job-uid' }
    const bloated = { schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit: 'c'.repeat(40),
      branch: runSpec.expectedBranch, harnessVersion: 'test', agentExitCode: 0, pushExitCode: 0,
      runNonceHash: runSpec.runNonceHash, claimTokenHash: runSpec.claimTokenHash, specDigest: runSpec.specDigest,
      logTail: 'x'.repeat(4 * 1024) }
    observeFixture(worker, runSpec, { exitCode: 0, message: JSON.stringify(bloated) })
    const observation = await worker.observe(runSpec)
    expect(observation).toMatchObject({ state: 'failed', outcome: expect.stringContaining('pactflow.artifact.oversize') })
  })

  it('fails closed on a malformed log artifact ref', async () => {
    const worker = new PactFlowK3sWorker(config())
    const runSpec: PactFlowK3sRunSpec = { ...worker.plan(RUN_ID, 'claude', 'git', 60_000, git(), 'task'), jobUid: 'job-uid' }
    const document = { schema: 'dsh_pactflow_k3s_result/v1', status: 'succeeded', commit: 'c'.repeat(40),
      branch: runSpec.expectedBranch, harnessVersion: 'test', agentExitCode: 0, pushExitCode: 0,
      runNonceHash: runSpec.runNonceHash, claimTokenHash: runSpec.claimTokenHash, specDigest: runSpec.specDigest,
      logArtifact: { uri: 'https://evil.example/fetch-everything', etag: 'x', bytes: -1, hash: 'zz', kind: '', summary: '' } }
    observeFixture(worker, runSpec, { exitCode: 0, message: JSON.stringify(document) })
    const observation = await worker.observe(runSpec)
    expect(observation).toMatchObject({ state: 'failed', outcome: expect.stringContaining('invalid artifact ref') })
  })
})
