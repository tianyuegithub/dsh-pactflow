import type {
  PactFlowHarness,
  PactFlowHarnessProfileSettings,
  PactFlowHarborArtifactOption,
} from './types.ts'

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
