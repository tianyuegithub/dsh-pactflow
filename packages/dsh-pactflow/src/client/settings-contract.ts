import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import { NS } from './locale.ts'
import type { PactFlowArtifactStoreSettings, PactFlowHarnessProfileSettings, PactFlowHarborArtifactOption, PactFlowSettingsView, PactFlowInfrastructureSettings, PactFlowInfrastructureProbeResult, PactFlowInfrastructureHealthRecord, PactFlowInfrastructureDeletionImpact, PactFlowInfrastructureResourceKind, PactFlowDiscoveredModel, PactFlowGitProviderSettings, PactFlowK3sClusterSettings, PactFlowKubeconfigView, PactFlowModelConnectionSettings, PactFlowRegistrySettings, PactFlowWorkerPoolSettings } from '../types.ts'

export type SettingsCardProps =
  PropsRuntime<'settings.plugin.item'>
  & PropsLocale<typeof NS>
  & InjectFace<{
    readonly settings: SettingsScope<PactFlowSettingsView>
    probeInfrastructure(
      kind: PactFlowInfrastructureResourceKind,
      id: string,
      draft?: PactFlowInfrastructureSettings,
    ): Promise<PactFlowInfrastructureProbeResult>
    listInfrastructureHealth(): Promise<readonly PactFlowInfrastructureHealthRecord[]>
    pickHostFile(): Promise<string | null>
    inspectKubeconfig(path: string): Promise<PactFlowKubeconfigView>
    listImagePullSecrets(clusterId: string, draft: PactFlowInfrastructureSettings): Promise<readonly string[]>
    listHarborArtifacts(registryId: string, draft: PactFlowInfrastructureSettings): Promise<readonly PactFlowHarborArtifactOption[]>
    discoverModels(model: PactFlowModelConnectionSettings, apiKey: string): Promise<readonly PactFlowDiscoveredModel[]>
    setCredential(ref: string, value: string): Promise<void>
    unsetCredential(ref: string): Promise<void>
    deletionImpact(
      kind: PactFlowInfrastructureResourceKind, id: string, draft: PactFlowInfrastructureSettings,
    ): Promise<PactFlowInfrastructureDeletionImpact>
  }>

export interface InfrastructureTestLog {
  readonly running: boolean
  readonly success?: boolean
  readonly durationMs?: number
  readonly testedAt?: string
  readonly entries: readonly {
    readonly state: 'running' | 'succeeded' | 'failed'
    readonly name: string
    readonly detail: string
  }[]
}

export type InfrastructureResource =
  | PactFlowK3sClusterSettings | PactFlowRegistrySettings | PactFlowGitProviderSettings
  | PactFlowHarnessProfileSettings | PactFlowModelConnectionSettings | PactFlowWorkerPoolSettings
  | PactFlowArtifactStoreSettings

export interface ActiveResourceEditor {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly mode: 'new' | 'edit'
}

export type CredentialActivity = 'cancel' | 'model-discovery' | 'probe' | 'save'

export interface DeleteResourceDialogState {
  readonly kind: PactFlowInfrastructureResourceKind
  readonly id: string
  readonly name: string
  readonly impact: PactFlowInfrastructureDeletionImpact | null
  readonly error: string | null
}
