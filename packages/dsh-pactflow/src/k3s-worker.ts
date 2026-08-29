/** K3s Job provider for immutable PactFlow Worker runs. */

import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'
import {
  BatchV1Api,
  CoreV1Api,
  KubeConfig,
  type V1ConfigMap,
  type V1EnvVar,
  type V1Job,
  type V1Pod,
} from '@kubernetes/client-node'
import type {
  PactFlowApiMode,
  PactFlowGitRunSpec,
  PactFlowHarness,
  PactFlowHarnessProbeResult,
  PactFlowHarnessProbeStage,
  PactFlowHarnessTemplateView,
  PactFlowK3sResult,
  PactFlowK3sRunSpec,
  PactFlowRunId,
} from './types.ts'

const DNS_LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/
const IMAGE_DIGEST = /^.+@sha256:[0-9a-f]{64}$/
const COMMIT = /^[0-9a-f]{40,64}$/

export const PACTFLOW_HARNESS_API_MODE: Readonly<Record<PactFlowHarness, PactFlowApiMode>> = {
  claude: 'anthropic-messages',
  codex: 'openai-responses',
  opencode: 'openai-chat-completions',
  dsh: 'openai-chat-completions',
}

export type PactFlowHarnessTemplateConfig = PactFlowHarnessTemplateView

export interface PactFlowK3sConfig {
  readonly namespace: string
  readonly kubeconfig?: string
  readonly context?: string
  readonly imagePullSecret: string
  readonly pollIntervalMs: number
  readonly templates: readonly PactFlowHarnessTemplateConfig[]
}

interface WorkerResultDocument {
  readonly schema: 'dsh_pactflow_k3s_result/v1'
  readonly status: 'succeeded' | 'failed'
  readonly commit: string
  readonly branch: string
  readonly harnessVersion: string
  readonly agentExitCode: number
  readonly pushExitCode: number
}

export type PactFlowK3sObservation =
  | { readonly state: 'pending' | 'missing' }
  | { readonly state: 'succeeded'; readonly result: PactFlowK3sResult }
  | { readonly state: 'failed'; readonly finishedAt: number; readonly outcome: string }

/** Host-side K3s client; Pods receive no API token and never write Session events. */
export class PactFlowK3sWorker {
  private readonly batch: BatchV1Api
  private readonly core: CoreV1Api
  private readonly templates = new Map<string, PactFlowHarnessTemplateConfig>()

  constructor(private readonly config: PactFlowK3sConfig) {
    this.requireDnsName('namespace', config.namespace)
    this.requireDnsName('imagePullSecret', config.imagePullSecret)
    if (config.kubeconfig !== undefined && !isAbsolute(config.kubeconfig)) {
      throw new Error('PactFlow K3s kubeconfig must be an absolute path')
    }
    if (!Number.isSafeInteger(config.pollIntervalMs) || config.pollIntervalMs < 250 || config.pollIntervalMs > 30_000) {
      throw new Error('PactFlow K3s pollIntervalMs must be 250-30000')
    }
    for (const template of config.templates) {
      this.validateTemplate(template)
      if (this.templates.has(template.id)) throw new Error(`duplicate PactFlow K3s template "${template.id}"`)
      this.templates.set(template.id, Object.freeze({ ...template }))
    }
    const kubeconfig = new KubeConfig()
    if (config.kubeconfig === undefined) kubeconfig.loadFromDefault()
    else kubeconfig.loadFromFile(config.kubeconfig)
    if (config.context !== undefined) kubeconfig.setCurrentContext(config.context)
    this.batch = kubeconfig.makeApiClient(BatchV1Api)
    this.core = kubeconfig.makeApiClient(CoreV1Api)
  }

  /** Detached non-secret templates safe for Remote and UI consumers. */
  listTemplates(): readonly PactFlowHarnessTemplateConfig[] {
    return [...this.templates.values()]
  }

  /** Verify namespace access without reading any Secret payload. */
  async preflight(): Promise<void> {
    try {
      await this.core.readNamespace({ name: this.config.namespace })
    } catch {
      throw new Error(`PactFlow cannot access K3s namespace "${this.config.namespace}"`)
    }
  }

  /** Validate the task inputs that would enter the ConfigMap before claim. */
  preflightRun(git: PactFlowGitRunSpec, prompt: string): void {
    if (!/^(?:ssh:\/\/|[^\s@]+@[^\s:]+:)/.test(git.remoteUrl)) {
      throw new Error('PactFlow K3s Workers require an SSH Git remote')
    }
    const promptBytes = new TextEncoder().encode(prompt).length
    if (promptBytes === 0 || promptBytes > 262_144) {
      throw new Error('PactFlow K3s Worker prompt must contain 1-262144 UTF-8 bytes')
    }
  }

  /** Resolve one configured template into an immutable Run spec. */
  plan(
    runId: PactFlowRunId,
    templateId: string,
    gitSecretName: string,
    leaseDurationMs: number,
  ): PactFlowK3sRunSpec {
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    this.requireDnsName('gitSecretName', gitSecretName)
    const suffix = runId.slice('run-'.length, 'run-'.length + 20).toLowerCase()
    const activeDeadlineSeconds = Math.max(1, Math.floor(leaseDurationMs / 1_000))
    return {
      templateId: template.id,
      namespace: this.config.namespace,
      jobName: `dsh-pf-${suffix}`,
      configMapName: `dsh-pf-${suffix}`,
      image: template.image,
      imagePullSecret: this.config.imagePullSecret,
      harness: template.harness,
      apiMode: template.apiMode,
      model: template.model,
      baseUrl: template.baseUrl,
      modelSecretName: template.modelSecretName,
      gitSecretName,
      cpuRequest: template.cpuRequest,
      memoryRequest: template.memoryRequest,
      cpuLimit: template.cpuLimit,
      memoryLimit: template.memoryLimit,
      activeDeadlineSeconds,
    }
  }

  /** Create the immutable ConfigMap and Job, then wait for a termination result. */
  async run(
    spec: PactFlowK3sRunSpec,
    git: PactFlowGitRunSpec,
    prompt: string,
    signal: AbortSignal,
  ): Promise<PactFlowK3sResult> {
    const configMap = this.configMap(spec, git, prompt)
    try {
      await this.core.createNamespacedConfigMap({ namespace: spec.namespace, body: configMap })
    } catch {
      throw new Error(`PactFlow failed to create K3s ConfigMap "${spec.configMapName}"`)
    }
    try {
      await this.batch.createNamespacedJob({ namespace: spec.namespace, body: this.job(spec) })
    } catch {
      await this.deleteConfigMap(spec)
      throw new Error(`PactFlow failed to create K3s Job "${spec.jobName}"`)
    }
    return await this.waitForResult(spec, signal)
  }

  /** Run the real Harness CLI in a short-lived Job and return bounded step logs. */
  async probe(templateId: string, prompt: string, timeoutMs: number): Promise<PactFlowHarnessProbeResult> {
    const startedAt = Date.now()
    const stages: PactFlowHarnessProbeStage[] = []
    const template = this.templates.get(templateId)
    if (template === undefined) throw new Error(`PactFlow K3s template "${templateId}" is not configured`)
    const promptBytes = new TextEncoder().encode(prompt).length
    if (promptBytes === 0 || promptBytes > 65_536 || !Number.isSafeInteger(timeoutMs)
      || timeoutMs < 10_000 || timeoutMs > 600_000) {
      throw new Error('PactFlow Harness probe requires a 1-65536 byte prompt and timeoutMs 10000-600000')
    }
    stages.push({ name: 'validate', state: 'succeeded', detail: 'template, protocol, prompt, and timeout accepted' })
    const jobName = `dsh-pf-probe-${randomUUID().slice(0, 20)}`
    let output = ''
    let success = false
    try {
      await this.batch.createNamespacedJob({
        namespace: this.config.namespace,
        body: this.probeJob(jobName, template, prompt, timeoutMs),
      })
      stages.push({ name: 'create-job', state: 'succeeded', detail: `Job ${jobName} created` })
      for (;;) {
        const job = await this.batch.readNamespacedJob({ name: jobName, namespace: this.config.namespace })
        if ((job.status?.succeeded ?? 0) > 0 || (job.status?.failed ?? 0) > 0) {
          output = await this.probeLog(jobName)
          success = (job.status?.succeeded ?? 0) > 0
          stages.push({
            name: 'model-response',
            state: success ? 'succeeded' : 'failed',
            detail: success ? 'Harness returned successfully' : 'Harness Job failed',
          })
          break
        }
        await new Promise(resolveDelay => setTimeout(resolveDelay, this.config.pollIntervalMs))
      }
    } catch (error) {
      output = error instanceof Error ? error.message.slice(0, 4_096) : 'Harness probe failed'
      stages.push({ name: 'model-response', state: 'failed', detail: 'Harness probe failed before a result' })
    } finally {
      try {
        await this.batch.deleteNamespacedJob({
          name: jobName,
          namespace: this.config.namespace,
          gracePeriodSeconds: 0,
          propagationPolicy: 'Background',
          body: {},
        })
        stages.push({ name: 'cleanup', state: 'succeeded', detail: `Job ${jobName} deleted` })
      } catch {
        stages.push({ name: 'cleanup', state: 'failed', detail: `Job ${jobName} cleanup failed` })
      }
    }
    return {
      kind: 'harness',
      templateId: template.id,
      harness: template.harness,
      apiMode: template.apiMode,
      model: template.model,
      baseUrl: template.baseUrl,
      image: template.image,
      modelSecretName: template.modelSecretName,
      prompt,
      timeoutMs,
      success,
      durationMs: Date.now() - startedAt,
      output: this.bounded(output, 16_384),
      stages,
    }
  }

  /** Observe an existing Job without creating or mutating resources. */
  async observe(spec: PactFlowK3sRunSpec): Promise<PactFlowK3sObservation> {
    let job: V1Job
    try {
      job = await this.batch.readNamespacedJob({ name: spec.jobName, namespace: spec.namespace })
    } catch (error) {
      const status = (error as { code?: unknown; statusCode?: unknown }).code
        ?? (error as { statusCode?: unknown }).statusCode
      if (status === 404) return { state: 'missing' }
      const reason = error instanceof Error ? error.message.slice(0, 512) : 'unavailable'
      throw new Error(`PactFlow cannot read K3s Job "${spec.jobName}" (status ${String(status ?? 'unavailable')}): ${reason}`)
    }
    if ((job.status?.succeeded ?? 0) > 0) return await this.terminalObservation(spec, true)
    if ((job.status?.failed ?? 0) > 0) return await this.terminalObservation(spec, false)
    return { state: 'pending' }
  }

  /** Wait for a Job created before the current Host activation. */
  async waitExisting(spec: PactFlowK3sRunSpec, signal: AbortSignal): Promise<PactFlowK3sResult> {
    return await this.waitForResult(spec, signal)
  }

  /** Cancel only the exact Job and ConfigMap owned by one Run. */
  async cancelRun(spec: PactFlowK3sRunSpec): Promise<void> {
    await this.cancel(spec)
  }

  private configMap(spec: PactFlowK3sRunSpec, git: PactFlowGitRunSpec, prompt: string): V1ConfigMap {
    return {
      apiVersion: 'v1',
      kind: 'ConfigMap',
      immutable: true,
      metadata: { name: spec.configMapName, namespace: spec.namespace, labels: this.labels(spec) },
      data: {
        'spec.json': JSON.stringify({
          schema: 'dsh_pactflow_k3s_run/v1',
          repoUrl: git.remoteUrl,
          baseCommit: git.baseCommit,
          branch: git.branch,
          prompt,
        }),
        'worker.sh': WORKER_SCRIPT,
      },
    }
  }

  private job(spec: PactFlowK3sRunSpec): V1Job {
    return {
      apiVersion: 'batch/v1',
      kind: 'Job',
      metadata: { name: spec.jobName, namespace: spec.namespace, labels: this.labels(spec) },
      spec: {
        activeDeadlineSeconds: spec.activeDeadlineSeconds,
        backoffLimit: 0,
        template: {
          metadata: { labels: this.labels(spec) },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            securityContext: { fsGroup: 1_001, fsGroupChangePolicy: 'OnRootMismatch' },
            imagePullSecrets: [{ name: spec.imagePullSecret }],
            terminationGracePeriodSeconds: 30,
            containers: [{
              name: 'worker',
              image: spec.image,
              imagePullPolicy: 'IfNotPresent',
              command: ['/bin/bash', '/opt/dsh-pactflow/worker.sh'],
              env: this.modelEnvironment(spec),
              resources: {
                requests: { cpu: spec.cpuRequest, memory: spec.memoryRequest },
                limits: { cpu: spec.cpuLimit, memory: spec.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false,
                capabilities: { drop: ['ALL'] },
                runAsNonRoot: true,
                runAsUser: 1_001,
                runAsGroup: 1_001,
              },
              terminationMessagePath: '/dev/termination-log',
              terminationMessagePolicy: 'File',
              volumeMounts: [
                { name: 'spec', mountPath: '/opt/dsh-pactflow', readOnly: true },
                { name: 'git', mountPath: '/var/run/pactflow-git', readOnly: true },
              ],
            }],
            volumes: [
              { name: 'spec', configMap: { name: spec.configMapName, defaultMode: 0o555 } },
              { name: 'git', secret: { secretName: spec.gitSecretName, defaultMode: 0o440 } },
            ],
          },
        },
      },
    }
  }

  private probeJob(
    jobName: string,
    template: PactFlowHarnessTemplateConfig,
    prompt: string,
    timeoutMs: number,
  ): V1Job {
    const timeoutSeconds = Math.ceil(timeoutMs / 1_000)
    return {
      apiVersion: 'batch/v1', kind: 'Job',
      metadata: {
        name: jobName, namespace: this.config.namespace,
        labels: { 'app.kubernetes.io/name': 'dsh-pactflow-probe', 'app.kubernetes.io/managed-by': 'dsh-pactflow' },
      },
      spec: {
        activeDeadlineSeconds: timeoutSeconds,
        backoffLimit: 0,
        template: {
          metadata: { labels: { 'app.kubernetes.io/name': 'dsh-pactflow-probe' } },
          spec: {
            automountServiceAccountToken: false,
            restartPolicy: 'Never',
            nodeSelector: { 'kubernetes.io/arch': 'amd64' },
            imagePullSecrets: [{ name: this.config.imagePullSecret }],
            containers: [{
              name: 'probe', image: template.image, imagePullPolicy: 'IfNotPresent',
              command: ['/usr/local/bin/pactflow-harness-runner.sh'],
              env: [
                ...this.modelEnvironment({ ...template, activeDeadlineSeconds: timeoutSeconds }),
                { name: 'PACTFLOW_TEST_PROMPT', value: prompt },
                { name: 'PACTFLOW_HARNESS_PROBE', value: '1' },
              ],
              resources: {
                requests: { cpu: template.cpuRequest, memory: template.memoryRequest },
                limits: { cpu: template.cpuLimit, memory: template.memoryLimit },
              },
              securityContext: {
                allowPrivilegeEscalation: false, capabilities: { drop: ['ALL'] },
                runAsNonRoot: true, runAsUser: 1_001, runAsGroup: 1_001,
              },
            }],
          },
        },
      },
    }
  }

  private modelEnvironment(spec: Pick<
    PactFlowK3sRunSpec,
    'harness' | 'apiMode' | 'model' | 'baseUrl' | 'modelSecretName' | 'activeDeadlineSeconds'
  >): V1EnvVar[] {
    const common: V1EnvVar[] = [
      { name: 'WORKER_TYPE', value: spec.harness },
      { name: 'MODEL', value: spec.model },
      { name: 'HARNESS_TIMEOUT_SECONDS', value: String(Math.max(1, spec.activeDeadlineSeconds - 30)) },
    ]
    if (spec.apiMode === 'anthropic-messages') {
      return [
        ...common,
        { name: 'ANTHROPIC_MODEL', value: spec.model },
        { name: 'ANTHROPIC_BASE_URL', value: spec.baseUrl },
        this.secretEnv('ANTHROPIC_AUTH_TOKEN', spec.modelSecretName),
      ]
    }
    return [
      ...common,
      { name: 'OPENAI_MODEL', value: spec.model },
      { name: 'OPENAI_BASE_URL', value: spec.baseUrl },
      this.secretEnv('OPENAI_API_KEY', spec.modelSecretName),
    ]
  }

  private secretEnv(key: string, secretName: string): V1EnvVar {
    return { name: key, valueFrom: { secretKeyRef: { name: secretName, key } } }
  }

  private async probeLog(jobName: string): Promise<string> {
    const list = await this.core.listNamespacedPod({
      namespace: this.config.namespace, labelSelector: `job-name=${jobName}`,
    })
    const podName = list.items[0]?.metadata?.name
    if (podName === undefined) return 'Harness probe Pod was not found'
    return await this.core.readNamespacedPodLog({
      name: podName, namespace: this.config.namespace, container: 'probe',
      limitBytes: 32_768, tailLines: 200,
    })
  }

  private async waitForResult(spec: PactFlowK3sRunSpec, signal: AbortSignal): Promise<PactFlowK3sResult> {
    for (;;) {
      if (signal.aborted) {
        await this.cancel(spec)
        throw new Error(`PactFlow K3s Job "${spec.jobName}" was cancelled`)
      }
      const observation = await this.observe(spec)
      if (observation.state === 'succeeded') return observation.result
      if (observation.state === 'failed') throw new Error(observation.outcome)
      if (observation.state === 'missing') throw new Error(`PactFlow K3s Job "${spec.jobName}" is missing`)
      await this.delay(signal)
    }
  }

  private async terminalObservation(
    spec: PactFlowK3sRunSpec,
    expectSuccess: boolean,
  ): Promise<Extract<PactFlowK3sObservation, { state: 'succeeded' | 'failed' }>> {
    let pods: readonly V1Pod[]
    try {
      const list = await this.core.listNamespacedPod({
        namespace: spec.namespace, labelSelector: `job-name=${spec.jobName}`,
      })
      pods = list.items
    } catch {
      throw new Error(`PactFlow cannot read Pods for K3s Job "${spec.jobName}"`)
    }
    const pod = pods.toSorted((left, right) =>
      (right.metadata?.creationTimestamp?.valueOf() ?? 0) - (left.metadata?.creationTimestamp?.valueOf() ?? 0))[0]
    const terminated = pod?.status?.containerStatuses?.[0]?.state?.terminated
    if (pod?.metadata?.name === undefined || terminated === undefined) {
      return {
        state: 'failed', finishedAt: Date.now(),
        outcome: `PactFlow K3s Job "${spec.jobName}" has no terminal Worker Pod result`,
      }
    }
    let document: WorkerResultDocument
    try {
      document = JSON.parse(terminated.message ?? '') as WorkerResultDocument
    } catch {
      return {
        state: 'failed', finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
        outcome: `PactFlow K3s Job "${spec.jobName}" returned an invalid termination document`,
      }
    }
    const valid = document.schema === 'dsh_pactflow_k3s_result/v1'
      && document.branch.length > 0 && COMMIT.test(document.commit)
      && Number.isInteger(document.agentExitCode) && Number.isInteger(document.pushExitCode)
    if (!valid || !expectSuccess || document.status !== 'succeeded' || terminated.exitCode !== 0
      || document.agentExitCode !== 0 || document.pushExitCode !== 0) {
      return {
        state: 'failed', finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
        outcome: `PactFlow K3s Worker failed (pod ${pod.metadata.name}, exit ${String(terminated.exitCode)})`,
      }
    }
    return {
      state: 'succeeded',
      result: {
        podName: pod.metadata.name,
        exitCode: terminated.exitCode,
        commit: document.commit,
        branch: document.branch,
        harnessVersion: document.harnessVersion.slice(0, 256),
        finishedAt: terminated.finishedAt?.getTime() ?? Date.now(),
      },
    }
  }

  private async cancel(spec: PactFlowK3sRunSpec): Promise<void> {
    await Promise.allSettled([
      this.batch.deleteNamespacedJob({
        name: spec.jobName,
        namespace: spec.namespace,
        gracePeriodSeconds: 0,
        propagationPolicy: 'Background',
        body: {},
      }),
      this.deleteConfigMap(spec),
    ])
  }

  private async deleteConfigMap(spec: PactFlowK3sRunSpec): Promise<void> {
    try {
      await this.core.deleteNamespacedConfigMap({ name: spec.configMapName, namespace: spec.namespace })
    } catch {
      // Best-effort rollback owns only the exact ConfigMap created for this Run.
    }
  }

  private delay(signal: AbortSignal): Promise<void> {
    return new Promise((resolveDelay) => {
      const onAbort = (): void => { clearTimeout(timer); resolveDelay() }
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolveDelay()
      }, this.config.pollIntervalMs)
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  private labels(spec: PactFlowK3sRunSpec): Record<string, string> {
    return {
      'app.kubernetes.io/name': 'dsh-pactflow-worker',
      'app.kubernetes.io/managed-by': 'dsh-pactflow',
      'pactflow.run': spec.jobName.slice('dsh-pf-'.length),
    }
  }

  private validateTemplate(template: PactFlowHarnessTemplateConfig): void {
    this.requireDnsName('template id', template.id)
    this.requireDnsName('modelSecretName', template.modelSecretName)
    if (PACTFLOW_HARNESS_API_MODE[template.harness] !== template.apiMode) {
      throw new Error(`PactFlow Harness ${template.harness} does not support ${template.apiMode}`)
    }
    if (!IMAGE_DIGEST.test(template.image)) throw new Error('PactFlow K3s template image must use a sha256 digest')
    if (template.model.trim().length === 0) throw new Error('PactFlow K3s template model must be non-empty')
    let baseUrl: URL
    try {
      baseUrl = new URL(template.baseUrl)
    } catch {
      throw new Error('PactFlow K3s template baseUrl must be an HTTP(S) URL')
    }
    if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username !== '' || baseUrl.password !== ''
      || baseUrl.search !== '' || baseUrl.hash !== '') {
      throw new Error('PactFlow K3s template baseUrl must be credential-free')
    }
    for (const value of [template.cpuRequest, template.memoryRequest, template.cpuLimit, template.memoryLimit]) {
      if (value.trim().length === 0 || /[\0\r\n]/.test(value)) throw new Error('PactFlow K3s resources must be non-empty')
    }
  }

  private requireDnsName(label: string, value: string): void {
    if (!DNS_LABEL.test(value)) throw new Error(`PactFlow K3s ${label} must be a DNS label`)
  }

  private bounded(value: string, maximumBytes: number): string {
    const bytes = new TextEncoder().encode(value)
    if (bytes.length <= maximumBytes) return value
    return `${new TextDecoder().decode(bytes.slice(0, maximumBytes - 16))}\n[truncated]`
  }
}

const WORKER_SCRIPT = String.raw`#!/bin/bash
set -euo pipefail
SPEC_PATH=/opt/dsh-pactflow/spec.json
eval "$(python3 - <<'PY'
import json, shlex
spec = json.load(open('/opt/dsh-pactflow/spec.json', encoding='utf-8'))
for key, field in [('REPO_URL','repoUrl'),('BASE_COMMIT','baseCommit'),('BRANCH','branch')]:
    print(f"{key}={shlex.quote(str(spec[field]))}")
with open('/tmp/prompt.txt', 'w', encoding='utf-8') as output:
    output.write(str(spec['prompt']))
PY
)"
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
install -m 600 /var/run/pactflow-git/id_ed25519 "$HOME/.ssh/id_ed25519"
install -m 644 /var/run/pactflow-git/known_hosts "$HOME/.ssh/known_hosts"
export GIT_SSH_COMMAND="ssh -i $HOME/.ssh/id_ed25519 -o IdentitiesOnly=yes -o StrictHostKeyChecking=yes -o UserKnownHostsFile=$HOME/.ssh/known_hosts"
git clone --no-checkout "$REPO_URL" /workspace/repo
git -C /workspace/repo checkout -b "$BRANCH" "$BASE_COMMIT"
git -C /workspace/repo config user.name "PactFlow Worker"
git -C /workspace/repo config user.email "pactflow-worker@local"
cd /workspace/repo
set +e
PROMPT_PATH=/tmp/prompt.txt /usr/local/bin/pactflow-harness-runner.sh
AGENT_EXIT_CODE=$?
set -e
HARNESS_VERSION="$(cat /tmp/harness-version.txt 2>/dev/null || true)"
CURRENT_COMMIT="$(git rev-parse HEAD)"
PUSH_EXIT_CODE=1
STATUS=failed
if [ "$AGENT_EXIT_CODE" -eq 0 ] && [ "$CURRENT_COMMIT" != "$BASE_COMMIT" ] && [ -z "$(git status --porcelain)" ]; then
    if git push origin "HEAD:refs/heads/$BRANCH"; then
        PUSH_EXIT_CODE=0
        STATUS=succeeded
    else
        PUSH_EXIT_CODE=$?
    fi
fi
export STATUS CURRENT_COMMIT PUSH_EXIT_CODE AGENT_EXIT_CODE HARNESS_VERSION BRANCH
python3 - <<'PY'
import json, os
document = {
    'schema': 'dsh_pactflow_k3s_result/v1',
    'status': os.environ['STATUS'],
    'commit': os.environ.get('CURRENT_COMMIT', ''),
    'branch': os.environ.get('BRANCH', ''),
    'harnessVersion': os.environ.get('HARNESS_VERSION', '')[:256],
    'agentExitCode': int(os.environ.get('AGENT_EXIT_CODE', '1')),
    'pushExitCode': int(os.environ.get('PUSH_EXIT_CODE', '1')),
}
with open('/dev/termination-log', 'w', encoding='utf-8') as output:
    json.dump(document, output, ensure_ascii=False, separators=(',', ':'))
PY
if [ "$STATUS" = succeeded ]; then exit 0; fi
exit 1
`
