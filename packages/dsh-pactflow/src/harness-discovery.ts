import type {
  PactFlowApiMode,
  PactFlowHarness,
  PactFlowHarnessProfileSettings,
  PactFlowHarnessTemplateView,
  PactFlowHarborArtifactOption,
  PactFlowModelConnectionSettings,
  PactFlowWorkerPoolSettings,
} from './types.ts'

export const PACTFLOW_HARNESS_PROTOCOL: Readonly<Record<PactFlowHarness, PactFlowApiMode>> = {
  claude: 'anthropic-messages', codex: 'openai-responses',
  opencode: 'openai-chat-completions', dsh: 'openai-chat-completions',
}

export interface PactFlowHarnessProbeAvailability {
  readonly apiMode: PactFlowApiMode
  readonly apiReady: boolean
  readonly modelConnectionId?: string
  readonly workerPoolId?: string
  readonly reason?: string
}

export function harnessProbeAvailability(
  template: PactFlowHarnessTemplateView | PactFlowHarnessProfileSettings,
  pools: readonly PactFlowWorkerPoolSettings[],
  models: readonly PactFlowModelConnectionSettings[],
): PactFlowHarnessProbeAvailability {
  const apiMode = 'registryId' in template ? PACTFLOW_HARNESS_PROTOCOL[template.harness] : template.apiMode
  const matchingPools = pools.filter(pool => pool.templateIds.includes(template.id))
  const compatibleModels = models.filter(model => model.apiMode === apiMode)
  const reasons: string[] = []
  if (compatibleModels.length === 0) reasons.push(`缺少${protocolLabel(apiMode)}模型连接`)
  if (compatibleModels.length > 1) reasons.push('存在多个兼容模型，需在项目 Agent 中明确选择')
  if (matchingPools.length === 0) reasons.push('尚未在执行资源池中启用')
  if (matchingPools.length > 1) reasons.push('属于多个执行资源池，需明确选择')
  const model = compatibleModels.length === 1 ? compatibleModels[0] : undefined
  const pool = matchingPools.length === 1 ? matchingPools[0] : undefined
  return {
    apiMode,
    apiReady: model !== undefined && pool !== undefined,
    ...(model === undefined ? {} : { modelConnectionId: model.id }),
    ...(pool === undefined ? {} : { workerPoolId: pool.id }),
    ...(reasons.length === 0 ? {} : { reason: reasons.join('；') }),
  }
}

function protocolLabel(apiMode: PactFlowApiMode): string {
  if (apiMode === 'anthropic-messages') return ' Anthropic 消息协议的'
  if (apiMode === 'openai-responses') return ' OpenAI Responses 协议的'
  return ' OpenAI Chat Completions 协议的'
}

const SPECS: readonly {
  readonly harness: PactFlowHarness
  readonly id: string
  readonly name: string
  readonly preferredTag: string
  readonly prefixes: readonly string[]
}[] = [
  { harness: 'claude', id: 'claude', name: 'Claude Code', preferredTag: 'claudecode-ox_v1', prefixes: ['claudecode', 'claude'] },
  { harness: 'codex', id: 'codex', name: 'Codex', preferredTag: 'codex-ox_v1', prefixes: ['codex'] },
  { harness: 'opencode', id: 'opencode', name: 'OpenCode', preferredTag: 'opencode-ox_v1', prefixes: ['opencode'] },
  { harness: 'dsh', id: 'dsh', name: 'DeepSeek Harness', preferredTag: 'dsh-ox_v1', prefixes: ['dsh'] },
]

export interface PactFlowHarnessDiscoveryResult {
  readonly templates: readonly PactFlowHarnessProfileSettings[]
  readonly found: readonly PactFlowHarness[]
  readonly missing: readonly PactFlowHarness[]
}

function artifactFor(
  artifacts: readonly PactFlowHarborArtifactOption[],
  preferredTag: string,
  prefixes: readonly string[],
): PactFlowHarborArtifactOption | undefined {
  return artifacts.find(item => item.tags.includes(preferredTag))
    ?? artifacts.find(item => item.tags.some(tag => prefixes.some(prefix => tag.toLowerCase().startsWith(prefix))))
}

/** Synchronize image identity from Harbor without overwriting user-owned resource limits. */
export function synchronizeHarnessTemplates(
  registryId: string,
  repository: string,
  artifacts: readonly PactFlowHarborArtifactOption[],
  existing: readonly PactFlowHarnessProfileSettings[],
): PactFlowHarnessDiscoveryResult {
  const next = [...existing]
  const found: PactFlowHarness[] = []
  const missing: PactFlowHarness[] = []
  for (const spec of SPECS) {
    const artifact = artifactFor(artifacts, spec.preferredTag, spec.prefixes)
    if (artifact === undefined) {
      missing.push(spec.harness)
      continue
    }
    found.push(spec.harness)
    const index = next.findIndex(item => item.harness === spec.harness)
    if (index >= 0) {
      next[index] = {
        ...next[index]!, registryId, repository, artifactDigest: artifact.digest,
      }
      continue
    }
    next.push({
      id: spec.id, displayName: spec.name, harness: spec.harness,
      registryId, repository, artifactDigest: artifact.digest,
      cpuRequest: '500m', memoryRequest: '1Gi', cpuLimit: '2', memoryLimit: '4Gi',
    })
  }
  return { templates: next, found, missing }
}
