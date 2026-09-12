import { synchronizeHarnessTemplates } from '../harness-discovery.ts'
import { friendlyOption, isHarnessProfile } from './resource-model.ts'
import { releaseTemporaryCredentialRefs, replaceInfrastructureCredentialRefs, temporaryCredentialRef } from './credential-probe.ts'
import type { SettingsCardProps, CredentialActivity, InfrastructureTestLog, ActiveResourceEditor } from './settings-contract.ts'
import type { PactFlowInfrastructureSettings, PactFlowInfrastructureResourceKind, PactFlowHarborArtifactOption } from '../types.ts'
import { probeStageEntry } from './settings-model.ts'

/**
 * Host surface for the credential mutual-exclusion gate. The component builds
 * this object per render so every route stays on the current closures.
 */
export interface SettingsCredentialController {
  readonly temporaryCredentialRefs: { current: Map<string, string> }
  readonly credentialActivityRef: { current: CredentialActivity | null }
  readonly unsetCredentialRef: { current: (ref: string) => void }
  readonly unsetCredential: Props['unsetCredential']
  setCredentialActivity(activity: CredentialActivity | null): void
}

export function probeCredentialRefImpl(controller: SettingsCredentialController, reference: string): string {
  const existing = controller.temporaryCredentialRefs.current.get(reference)
  if (existing !== undefined) return existing
  const created = temporaryCredentialRef(reference, crypto.randomUUID())
  controller.temporaryCredentialRefs.current.set(reference, created)
  return created
}

export async function releaseTemporaryCredentialsImpl(
  controller: SettingsCredentialController,
  references?: readonly string[],
): Promise<void> {
  const result = await releaseTemporaryCredentialRefs(
    controller.temporaryCredentialRefs.current,
    controller.unsetCredential,
    references,
  )
  if (result.failed.length > 0) {
    throw new Error(`有 ${String(result.failed.length)} 个临时凭证清理失败；引用已保留，请重试`)
  }
}

export function beginCredentialActivityImpl(controller: SettingsCredentialController, activity: CredentialActivity): boolean {
  if (controller.credentialActivityRef.current !== null) return false
  controller.credentialActivityRef.current = activity
  controller.setCredentialActivity(activity)
  return true
}

export function finishCredentialActivityImpl(controller: SettingsCredentialController, activity: CredentialActivity): void {
  if (controller.credentialActivityRef.current !== activity) return
  controller.credentialActivityRef.current = null
  controller.setCredentialActivity(null)
}

type Props = SettingsCardProps

/** Host surface for the infrastructure probe execution chain. */
export interface SettingsProbeController extends SettingsCredentialController {
  readonly draft: PactFlowInfrastructureSettings
  readonly credentialDrafts: Record<string, string>
  readonly postSaveRef: {
    current: {
      readonly persisted: PactFlowInfrastructureSettings
      readonly draft: PactFlowInfrastructureSettings
      readonly active: ActiveResourceEditor | null
    } | null
  }
  readonly settings: Props['settings']
  readonly probeInfrastructure: Props['probeInfrastructure']
  readonly setCredential: Props['setCredential']
  readonly listImagePullSecrets: Props['listImagePullSecrets']
  readonly listHarborArtifacts: Props['listHarborArtifacts']
  setProbingId(id: string | null): void
  setTestedFingerprints(update: (current: Record<string, string>) => Record<string, string>): void
  setTestLogs(update: (current: Record<string, InfrastructureTestLog>) => Record<string, InfrastructureTestLog>): void
  setExpandedLogs(update: (current: ReadonlySet<string>) => ReadonlySet<string>): void
  setPullSecrets(update: (current: Record<string, readonly string[]>) => Record<string, readonly string[]>): void
  setHarborArtifacts(update: (current: Record<string, readonly PactFlowHarborArtifactOption[]>) => Record<string, readonly PactFlowHarborArtifactOption[]>): void
  setDraft(value: PactFlowInfrastructureSettings): void
  setAdvanced(value: string): void
  setPersisted(value: PactFlowInfrastructureSettings): void
  setSavingId(id: string | null): void
  setNotice(value: string): void
  resourceFingerprint(kind: PactFlowInfrastructureResourceKind, id: string): string
  draftForProbe(kind: PactFlowInfrastructureResourceKind, id: string): PactFlowInfrastructureSettings
  credentialsForProbe(kind: PactFlowInfrastructureResourceKind, id: string): readonly [string, string][]
  appendDiscoveryFailure(key: string, name: string, error: unknown): void
  probeCredentialRef(reference: string): string
  beginCredentialActivity(activity: CredentialActivity): boolean
  finishCredentialActivity(activity: CredentialActivity): void
}

export function probeImpl(
  controller: SettingsProbeController,
  kind: PactFlowInfrastructureResourceKind, id: string, saved = false,
): void {
  if (!controller.beginCredentialActivity('probe')) return
  const key = `${kind}:${id}`
  const startedAt = Date.now()
  controller.setProbingId(id)
  controller.setTestedFingerprints(current => {
    const next = { ...current }
    delete next[key]
    return next
  })
  controller.setTestLogs(current => ({
    ...current,
    [key]: {
      running: true,
      entries: [{
        state: 'running', name: '准备测试',
        detail: saved ? '读取已保存资源及其当前依赖配置' : '读取当前卡片中未保存的表单值',
      }],
    },
  }))
  const credentialWrites = controller.credentialsForProbe(kind, id)
  const temporaryWrites = credentialWrites.map(([ref, secret]) => [
    controller.probeCredentialRef(ref), secret,
  ] as const)
  const replacements = new Map(credentialWrites.map(([ref], index) => [ref, temporaryWrites[index]![0]]))
  const probeDraft = saved
    ? undefined
    : replaceInfrastructureCredentialRefs(controller.draftForProbe(kind, id), replacements)
  void Promise.all(temporaryWrites.map(([ref, secret]) => controller.setCredential(ref, secret)))
    .then(() => {
      if (credentialWrites.length === 0) return
      controller.setTestLogs(current => ({
        ...current,
        [key]: {
            ...current[key]!,
            entries: [...current[key]!.entries, {
              state: 'succeeded', name: '凭证准备', detail: '新凭证已写入隔离的临时 Credential Ref，日志不包含原值',
            }],
        },
      }))
    })
    .then(() => controller.probeInfrastructure(kind, id, probeDraft)).then(
    result => {
      controller.setProbingId(null)
      controller.setTestLogs(current => ({
        ...current,
        [key]: {
          running: result.success && (kind === 'cluster' || kind === 'registry'),
          success: result.success, durationMs: Date.now() - startedAt,
          ...(saved ? { testedAt: new Date().toISOString() } : {}),
          entries: [
            ...(current[key]?.entries ?? []).map(entry => entry.state === 'running'
              ? { ...entry, state: 'succeeded' as const }
              : entry),
            ...result.stages.map(probeStageEntry),
          ],
        },
      }))
      if (!result.success) return
      if (saved && kind !== 'registry') {
        // Saved probes skip async discovery entirely, so nothing else will
        // clear the running flag set above.
        controller.setTestLogs(current => ({
          ...current,
          [key]: { ...current[key]!, running: false },
        }))
        controller.setExpandedLogs(current => new Set(current).add(key))
        return
      }
      if (kind !== 'cluster' && kind !== 'registry') {
        controller.setTestedFingerprints(current => ({ ...current, [key]: controller.resourceFingerprint(kind, id) }))
      }
      const discoveryDraft = probeDraft ?? controller.draftForProbe(kind, id)
      if (kind === 'cluster') {
        void controller.listImagePullSecrets(id, discoveryDraft).then(
          (values) => {
            controller.setPullSecrets(current => ({ ...current, [id]: values }))
            controller.setTestLogs(current => ({
              ...current,
              [key]: {
                ...current[key]!, running: false,
                entries: [...current[key]!.entries, {
                  state: 'succeeded', name: '读取镜像拉取凭证',
                  detail: `发现 ${String(values.length)} 个 dockerconfigjson Secret`,
                }],
              },
            }))
            controller.setTestedFingerprints(current => ({ ...current, [key]: controller.resourceFingerprint(kind, id) }))
          },
          error => controller.appendDiscoveryFailure(key, '读取镜像拉取凭证', error),
        )
      }
      if (kind === 'registry') {
        void controller.listHarborArtifacts(id, discoveryDraft).then(
          (values) => {
            controller.setHarborArtifacts(current => ({ ...current, [id]: values }))
            const registry = discoveryDraft.registries.find(item => item.id === id)
            const profiles = controller.draft.templates.filter(isHarnessProfile)
            const synchronized = synchronizeHarnessTemplates(
              id, registry?.harnessRepository?.trim() || 'pactflow-worker', values, profiles,
            )
            const legacy = controller.draft.templates.filter(template => !isHarnessProfile(template))
            const nextDraft = { ...controller.draft, templates: [...legacy, ...synchronized.templates] }
            controller.setDraft(nextDraft)
            controller.setAdvanced(JSON.stringify(nextDraft, null, 2))
            controller.setTestLogs(current => ({
              ...current,
              [key]: {
                ...current[key]!, running: false, success: synchronized.missing.length === 0,
                entries: [...current[key]!.entries, {
                  state: 'succeeded', name: '读取 Harness 镜像',
                  detail: `从 ${registry?.harnessRepository ?? 'pactflow-worker'} 发现 ${String(values.length)} 个制品，识别 ${String(synchronized.found.length)} 类 Harness`,
                }, ...(synchronized.missing.length === 0 ? [] : [{
                  state: 'failed' as const, name: 'Harness 镜像完整性',
                  detail: `缺少 ${synchronized.missing.map(friendlyOption).join('、')}，已有模板未删除`,
                }])],
              },
            }))
            if (synchronized.missing.length === 0) {
              if (saved) {
                controller.setSavingId(id)
                controller.postSaveRef.current = { persisted: nextDraft, draft: nextDraft, active: null }
                void controller.settings.set('infrastructure', nextDraft).then(
                  () => {
                    controller.setPersisted(nextDraft)
                    controller.setDraft(nextDraft)
                    controller.setSavingId(null)
                    controller.setExpandedLogs(current => new Set(current).add(key))
                    controller.setNotice(`已从 ${registry?.harnessRepository ?? 'pactflow-worker'} 同步 ${String(synchronized.found.length)} 个 Harness 模板`)
                  },
                  error => {
                    controller.postSaveRef.current = null
                    controller.setSavingId(null)
                    controller.appendDiscoveryFailure(key, '保存 Harness 模板', error)
                  },
                )
              } else {
                controller.setTestedFingerprints(current => ({ ...current, [key]: controller.resourceFingerprint(kind, id) }))
              }
            }
          },
          error => controller.appendDiscoveryFailure(key, '读取 Harbor 制品', error),
        )
      }
    },
    error => {
      const detail = error instanceof Error ? error.message : String(error)
      controller.setProbingId(null)
      controller.setTestLogs(current => ({
        ...current,
        [key]: {
          running: false, success: false, durationMs: Date.now() - startedAt,
          entries: [
            ...(current[key]?.entries ?? []).map(entry => entry.state === 'running'
              ? { ...entry, state: 'succeeded' as const }
              : entry),
            { state: 'failed', name: '测试调用', detail },
          ],
        },
      }))
    },
  ).finally(() => controller.finishCredentialActivity('probe'))
}
