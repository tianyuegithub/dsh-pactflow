import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { isHarnessProfile, friendlyOption } from './resource-model.ts'
import { PactFlowHarnessCapabilities, harnessCapabilityViewOf } from './harness-capability-view.tsx'
import { ActionFeedbackToast, useActionFeedback } from './action-feedback.tsx'
import { releaseTemporaryCredentialRefs } from './credential-probe.ts'
import { EditableResourceCards, DeleteResourceDialog, CredentialInput, HarborArtifactField, ModelDiscoveryField, HarnessSelectionField } from './resource-cards.tsx'
import type { SettingsCardProps, InfrastructureTestLog, InfrastructureResource, ActiveResourceEditor, CredentialActivity, DeleteResourceDialogState } from './settings-contract.ts'
import type { PactFlowHarnessProfileSettings, PactFlowHarborArtifactOption, PactFlowInfrastructureSettings, PactFlowInfrastructureResourceKind, PactFlowDiscoveredModel, PactFlowK3sClusterSettings, PactFlowGitProviderSettings, PactFlowModelConnectionSettings, PactFlowRegistrySettings, PactFlowWorkerPoolSettings } from '../types.ts'
import { settingsCardStyle, hintStyle, settingsEditorStyle, summaryGridStyle, summaryItemStyle, summaryLabelStyle, summaryValueStyle, inputStyle, readOnlyInputStyle, secondaryButtonStyle, filePickerStyle, noticeStyle, sectionTitleStyle } from './styles.ts'
import {
  EMPTY_INFRASTRUCTURE,
  artifactStoreColumns,
  clusterColumns, compatibleHarnessTemplateIds, gitProviderColumns, modelColumns,
  newArtifactStore, newCluster, newGitProvider, newModel, newRegistry, newTemplate, newWorkerPool,
  normalizeInfrastructure, probeStageEntry, registryColumns, removeResource,
  replaceResource, resourceCredentialRefs, resourceRows, templateColumns, toggleSet, workerPoolColumns,
} from './settings-model.ts'
import {
  beginCredentialActivityImpl,
  finishCredentialActivityImpl,
  probeCredentialRefImpl,
  probeImpl,
  releaseTemporaryCredentialsImpl,
  type SettingsCredentialController,
  type SettingsProbeController,
} from './settings-probe.ts'

/** Restart-applied structured editor for non-secret infrastructure resources. */
export function PactFlowSettingsCard({
  settings, probeInfrastructure, pickHostFile, inspectKubeconfig,
  listImagePullSecrets, listHarborArtifacts, discoverModels, listInfrastructureHealth,
  setCredential, unsetCredential, deletionImpact, t,
}: SettingsCardProps) {
  const snapshot = useSyncExternalStore(
    listener => settings.subscribe(listener),
    () => settings.getSnapshot(),
  )
  const [persisted, setPersisted] = useState<PactFlowInfrastructureSettings>(EMPTY_INFRASTRUCTURE)
  const [draft, setDraft] = useState<PactFlowInfrastructureSettings>(EMPTY_INFRASTRUCTURE)
  const [advanced, setAdvanced] = useState(JSON.stringify(EMPTY_INFRASTRUCTURE, null, 2))
  const [notice, setNotice] = useState('')
  const { feedback, showFeedback, clearFeedback } = useActionFeedback()
  const [probingId, setProbingId] = useState<string | null>(null)
  const [testLogs, setTestLogs] = useState<Record<string, InfrastructureTestLog>>({})
  const [contextOptions, setContextOptions] = useState<Record<string, readonly string[]>>({})
  const [pullSecrets, setPullSecrets] = useState<Record<string, readonly string[]>>({})
  const [harborArtifacts, setHarborArtifacts] = useState<Record<string, readonly PactFlowHarborArtifactOption[]>>({})
  const [modelOptions, setModelOptions] = useState<Record<string, readonly PactFlowDiscoveredModel[]>>({})
  const [modelDiscovery, setModelDiscovery] = useState<Record<string, { readonly busy: boolean; readonly failure?: string; readonly manual: boolean }>>({})
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>({})
  const [activeEditor, setActiveEditor] = useState<ActiveResourceEditor | null>(null)
  const [testedFingerprints, setTestedFingerprints] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)
  const [deleteDialog, setDeleteDialog] = useState<DeleteResourceDialogState | null>(null)
  const [expandedLogs, setExpandedLogs] = useState<ReadonlySet<string>>(new Set())
  const postSaveRef = useRef<{
    readonly persisted: PactFlowInfrastructureSettings
    readonly draft: PactFlowInfrastructureSettings
    readonly active: ActiveResourceEditor | null
  } | null>(null)
  const temporaryCredentialRefsRef = useRef(new Map<string, string>())
  const credentialActivityRef = useRef<CredentialActivity | null>(null)
  const [credentialActivity, setCredentialActivity] = useState<CredentialActivity | null>(null)
  const unsetCredentialRef = useRef(unsetCredential)

  useEffect(() => { unsetCredentialRef.current = unsetCredential }, [unsetCredential])
  useEffect(() => () => {
    void releaseTemporaryCredentialRefs(
      temporaryCredentialRefsRef.current,
      ref => unsetCredentialRef.current(ref),
    )
  }, [])

  const credentialController: SettingsCredentialController = {
    temporaryCredentialRefs: temporaryCredentialRefsRef,
    credentialActivityRef,
    unsetCredentialRef,
    unsetCredential,
    setCredentialActivity,
  }
  const probeCredentialRef = (reference: string): string => probeCredentialRefImpl(credentialController, reference)
  const releaseTemporaryCredentials = async (references?: readonly string[]): Promise<void> => {
    return await releaseTemporaryCredentialsImpl(credentialController, references)
  }
  const beginCredentialActivity = (activity: CredentialActivity): boolean => beginCredentialActivityImpl(credentialController, activity)
  const finishCredentialActivity = (activity: CredentialActivity): void => finishCredentialActivityImpl(credentialController, activity)

  useEffect(() => {
    if (snapshot.value === undefined) return
    const source = snapshot.value.infrastructure === false
      ? EMPTY_INFRASTRUCTURE
      : snapshot.value.infrastructure
    const value = normalizeInfrastructure(source)
    const postSave = postSaveRef.current
    if (postSave !== null && JSON.stringify(postSave.persisted) === JSON.stringify(value)) {
      postSaveRef.current = null
      setPersisted(postSave.persisted)
      setDraft(postSave.draft)
      setActiveEditor(postSave.active)
      setAdvanced(JSON.stringify(postSave.draft, null, 2))
      return
    }
    setPersisted(value)
    setDraft(value)
    setActiveEditor(null)
    setAdvanced(JSON.stringify(value, null, 2))
  }, [snapshot.value])

  useEffect(() => {
    void listInfrastructureHealth().then(records => {
      setTestLogs(current => {
        const next = { ...current }
        for (const record of records) next[`${record.kind}:${record.id}`] = {
          running: false, success: record.state === 'succeeded', durationMs: record.durationMs,
          testedAt: record.testedAt,
          entries: record.stages.map(probeStageEntry),
        }
        return next
      })
    }).catch(error => { setNotice(error instanceof Error ? error.message : String(error)) })
  }, [snapshot.value, listInfrastructureHealth])

  const change = <K extends keyof PactFlowInfrastructureSettings>(
    key: K, rows: PactFlowInfrastructureSettings[K],
  ): void => {
    const value = { ...draft, [key]: rows }
    setDraft(value)
    setAdvanced(JSON.stringify(value, null, 2))
  }
  const changeRows = (
    kind: PactFlowInfrastructureResourceKind,
    key: keyof PactFlowInfrastructureSettings,
    rows: PactFlowInfrastructureSettings[typeof key],
  ): void => {
    change(key, rows)
    if (activeEditor?.kind === kind) {
      const testKey = `${kind}:${activeEditor.id}`
      setTestedFingerprints(current => {
        const next = { ...current }
        delete next[testKey]
        return next
      })
    }
  }
  const disabled = !snapshot.writable
  const actionDisabled = disabled || credentialActivity !== null
  const modeFor = (kind: PactFlowInfrastructureResourceKind, id: string): 'view' | 'edit' | 'new' => {
    return activeEditor?.kind === kind && activeEditor.id === id ? activeEditor.mode : 'view'
  }
  const refreshPoolPullSecrets = (pool: PactFlowWorkerPoolSettings): void => {
    const clusterDraft = {
      ...EMPTY_INFRASTRUCTURE,
      clusters: draft.clusters.filter(cluster => cluster.id === pool.clusterId),
    }
    void listImagePullSecrets(pool.clusterId, clusterDraft).then(
      values => {
        setPullSecrets(current => ({ ...current, [pool.clusterId]: values }))
        if (values.length !== 1 || pool.imagePullSecret !== undefined) return
        setDraft(current => {
          const currentPool = current.workerPools.find(item => item.id === pool.id)
          if (currentPool === undefined || currentPool.imagePullSecret !== undefined) return current
          const next = replaceResource(current, 'worker-pool', { ...currentPool, imagePullSecret: values[0]! })
          setAdvanced(JSON.stringify(next, null, 2))
          return next
        })
      },
      error => { setNotice(error instanceof Error ? error.message : String(error)) },
    )
  }
  const beginAdd = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (activeEditor !== null) return
    // New fill-in cards lead their section so the form is visible without scrolling.
    const value = replaceResource(persisted, kind, resource, true)
    setDraft(value)
    setAdvanced(JSON.stringify(value, null, 2))
    setActiveEditor({ kind, id: resource.id, mode: 'new' })
    if (kind === 'worker-pool') refreshPoolPullSecrets(resource as PactFlowWorkerPoolSettings)
  }
  const beginEdit = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (activeEditor !== null) return
    setDraft(persisted)
    setAdvanced(JSON.stringify(persisted, null, 2))
    setActiveEditor({ kind, id: resource.id, mode: 'edit' })
    if (kind === 'worker-pool') refreshPoolPullSecrets(resource as PactFlowWorkerPoolSettings)
  }
  const cancelEdit = (): void => {
    if (!beginCredentialActivity('cancel')) return
    const editor = activeEditor
    if (editor !== null) {
      const resource = resourceRows(draft, editor.kind).find(row => row.id === editor.id)
      if (resource !== undefined) {
        const refs = resourceCredentialRefs(editor.kind, resource)
        void releaseTemporaryCredentials(refs).then(() => {
          setCredentialDrafts(current => {
            const next = { ...current }
            for (const ref of refs) delete next[ref]
            return next
          })
          setDraft(persisted)
          setAdvanced(JSON.stringify(persisted, null, 2))
          setActiveEditor(null)
        }, error => {
          const detail = error instanceof Error ? error.message : String(error)
          setNotice(detail)
          showFeedback('error', `取消失败：${detail}`)
        }).finally(() => finishCredentialActivity('cancel'))
        return
      }
    }
    setDraft(persisted)
    setAdvanced(JSON.stringify(persisted, null, 2))
    setActiveEditor(null)
    finishCredentialActivity('cancel')
  }
  const resourceFingerprint = (kind: PactFlowInfrastructureResourceKind, id: string): string => {
    return JSON.stringify(resourceRows(draft, kind).find(row => row.id === id) ?? null)
  }
  const canSaveResource = (kind: PactFlowInfrastructureResourceKind, id: string): boolean => {
    return testedFingerprints[`${kind}:${id}`] === resourceFingerprint(kind, id)
  }
  const updateSecret = (ref: string, value: string): void => {
    setCredentialDrafts(current => ({ ...current, [ref]: value }))
    if (activeEditor !== null) {
      const key = `${activeEditor.kind}:${activeEditor.id}`
      setTestedFingerprints(current => {
        const next = { ...current }
        delete next[key]
        return next
      })
    }
  }
  const saveResource = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    if (!canSaveResource(kind, resource.id) || savingId !== null) return
    const nextPersisted = replaceResource(persisted, kind, resource)
    let nextDraft = nextPersisted
    let nextActive: ActiveResourceEditor | null = null
    if (kind === 'model-connection' && nextPersisted.workerPools.length === 0
      && nextPersisted.clusters.length > 0 && nextPersisted.registries.length > 0
      && nextPersisted.templates.some(isHarnessProfile)) {
      const pool = newWorkerPool(
        [], nextPersisted.clusters[0]!.id, nextPersisted.registries[0]!.id,
        compatibleHarnessTemplateIds(
          nextPersisted.templates.filter(isHarnessProfile), nextPersisted.modelConnections ?? [],
        ),
      )
      nextDraft = replaceResource(nextPersisted, 'worker-pool', pool)
      nextActive = { kind: 'worker-pool', id: pool.id, mode: 'new' }
    }
    const refs = resourceCredentialRefs(kind, resource)
    const writes = refs.map(ref => [ref, credentialDrafts[ref] ?? ''] as const)
      .filter((entry): entry is [string, string] => entry[1].trim() !== '')
    if (!beginCredentialActivity('save')) return
    setSavingId(resource.id)
    postSaveRef.current = { persisted: nextPersisted, draft: nextDraft, active: nextActive }
    void releaseTemporaryCredentials(refs)
      .then(() => Promise.all(writes.map(([ref, secret]) => setCredential(ref, secret))))
      .then(() => snapshot.value?.k3s === false ? undefined : settings.set('k3s', false))
      .then(() => settings.set('infrastructure', nextPersisted))
      .then(() => {
        setPersisted(nextPersisted)
        setDraft(nextDraft)
        setAdvanced(JSON.stringify(nextDraft, null, 2))
        setActiveEditor(nextActive)
        setSavingId(null)
        setNotice('已保存，重启 Profile 后运行时生效')
        showFeedback('success', '保存成功，重启 Profile 后运行时生效')
        setCredentialDrafts(current => {
          const next = { ...current }
          for (const ref of refs) delete next[ref]
          return next
        })
      })
      .catch((error) => {
        const detail = error instanceof Error ? error.message : String(error)
        postSaveRef.current = null
        setSavingId(null)
        setNotice(detail)
        showFeedback('error', `保存失败：${detail}`)
      })
      .finally(() => finishCredentialActivity('save'))
  }
  const resourceName = (resource: InfrastructureResource): string => {
    return 'displayName' in resource && typeof resource.displayName === 'string'
      ? resource.displayName
      : resource.id
  }
  const requestDelete = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): void => {
    setDeleteDialog({ kind, id: resource.id, name: resourceName(resource), impact: null, error: null })
    void deletionImpact(kind, resource.id, persisted).then(
      impact => setDeleteDialog(current => current?.kind === kind && current.id === resource.id
        ? { ...current, impact }
        : current),
      error => setDeleteDialog(current => current?.kind === kind && current.id === resource.id
        ? { ...current, error: error instanceof Error ? error.message : String(error) }
        : current),
    )
  }
  const confirmDelete = (): void => {
    const candidate = deleteDialog
    if (candidate === null || candidate.impact === null
      || candidate.impact.blockers.length > 0 || savingId !== null) return
    const nextPersisted = removeResource(persisted, candidate.kind, candidate.id)
    setSavingId(candidate.id)
    postSaveRef.current = { persisted: nextPersisted, draft: nextPersisted, active: null }
    void settings.set('infrastructure', nextPersisted)
      .then(async () => {
        const failures: string[] = []
        for (const ref of candidate.impact!.credentialRefs) {
          try { await unsetCredential(ref) } catch { failures.push(ref) }
        }
        setPersisted(nextPersisted)
        setDraft(nextPersisted)
        setAdvanced(JSON.stringify(nextPersisted, null, 2))
        setActiveEditor(null)
        setSavingId(null)
        setDeleteDialog(null)
        setNotice(failures.length === 0
          ? `已删除「${candidate.name}」`
          : `资源已删除，但凭证清理失败：${failures.join(', ')}`)
      })
      .catch((error) => {
        postSaveRef.current = null
        setSavingId(null)
        setDeleteDialog(current => current === null
          ? null
          : { ...current, error: error instanceof Error ? error.message : String(error) })
      })
  }
  const pickKubeconfig = (index: number): void => {
    void pickHostFile().then(async (path) => {
      if (path === null) return
      const view = await inspectKubeconfig(path)
      const context = view.currentContext ?? view.contexts[0]
      const rows = draft.clusters.map((cluster, rowIndex) => rowIndex === index
        ? { ...cluster, kubeconfig: view.path, ...(context === undefined ? {} : { context }) }
        : cluster)
      changeRows('cluster', 'clusters', rows)
      setContextOptions(current => ({ ...current, [rows[index]!.id]: view.contexts }))
    }).catch(error => { setNotice(error instanceof Error ? error.message : String(error)) })
  }
  const loadModels = (model: PactFlowModelConnectionSettings): void => {
    if (!beginCredentialActivity('model-discovery')) return
    setModelDiscovery(current => ({ ...current, [model.id]: { busy: true, manual: false } }))
    const apiKey = credentialDrafts[model.apiKeyCredentialRef] ?? ''
    const discoveryModel = apiKey.trim() === '' ? model : {
      ...model, apiKeyCredentialRef: probeCredentialRef(model.apiKeyCredentialRef),
    }
    void discoverModels(discoveryModel, apiKey).then(
      (models) => {
        if (models.length === 0) throw new Error('模型服务返回空列表')
        setModelOptions(current => ({ ...current, [model.id]: models }))
        setModelDiscovery(current => ({ ...current, [model.id]: { busy: false, manual: false } }))
      },
      (error) => setModelDiscovery(current => ({
        ...current,
        [model.id]: { busy: false, manual: false, failure: error instanceof Error ? error.message : String(error) },
      })),
    ).finally(() => finishCredentialActivity('model-discovery'))
  }
  const draftForProbe = (
    kind: PactFlowInfrastructureResourceKind, id: string,
  ): PactFlowInfrastructureSettings => {
    if (kind === 'cluster') return { ...EMPTY_INFRASTRUCTURE, clusters: draft.clusters.filter(item => item.id === id) }
    if (kind === 'registry') return { ...EMPTY_INFRASTRUCTURE, registries: draft.registries.filter(item => item.id === id) }
    if (kind === 'git-provider') return { ...EMPTY_INFRASTRUCTURE, gitProviders: draft.gitProviders.filter(item => item.id === id) }
    if (kind === 'harness') return {
      ...EMPTY_INFRASTRUCTURE,
      registries: draft.registries,
      templates: draft.templates.filter(item => item.id === id),
      modelConnections: draft.modelConnections ?? [],
    }
    if (kind === 'model-connection') return {
      ...EMPTY_INFRASTRUCTURE,
      modelConnections: (draft.modelConnections ?? []).filter(item => item.id === id),
    }
    return draft
  }
  const credentialsForProbe = (
    kind: PactFlowInfrastructureResourceKind, id: string,
  ): readonly [string, string][] => {
    // Single source of truth for per-kind credential refs (registry/git-provider/
    // model-connection/artifact-store all come from here), so a new resource kind
    // can never be missed by the probe credential preparation again.
    const resource = resourceRows(draft, kind).find(row => row.id === id)
    if (resource === undefined) return []
    return resourceCredentialRefs(kind, resource)
      .map(ref => [ref, credentialDrafts[ref] ?? ''] as const)
      .filter((entry): entry is [string, string] => entry[1].trim() !== '')
  }
  const appendDiscoveryFailure = (key: string, name: string, error: unknown): void => {
    const detail = error instanceof Error ? error.message : String(error)
    setTestLogs(current => ({
      ...current,
      [key]: {
        ...current[key]!, running: false, success: false,
        entries: [...current[key]!.entries, { state: 'failed', name, detail }],
      },
    }))
  }
  const probeController: SettingsProbeController = {
    ...credentialController,
    draft,
    credentialDrafts,
    postSaveRef,
    settings,
    probeInfrastructure,
    setCredential,
    listImagePullSecrets,
    listHarborArtifacts,
    setProbingId,
    setTestedFingerprints,
    setTestLogs,
    setExpandedLogs,
    setPullSecrets,
    setHarborArtifacts,
    setDraft,
    setAdvanced,
    setPersisted,
    setSavingId,
    setNotice,
    resourceFingerprint,
    draftForProbe,
    credentialsForProbe,
    appendDiscoveryFailure,
    probeCredentialRef,
    beginCredentialActivity,
    finishCredentialActivity,
  }
  const probe = (kind: PactFlowInfrastructureResourceKind, id: string, saved = false): void => {
    probeImpl(probeController, kind, id, saved)
  }
  const summaryFor = (kind: PactFlowInfrastructureResourceKind, resource: InfrastructureResource): ReactNode => {
    const values: readonly [string, string][] = kind === 'cluster'
      ? [['Namespace', (resource as PactFlowK3sClusterSettings).namespace], ['Context', (resource as PactFlowK3sClusterSettings).context ?? '默认']]
      : kind === 'registry'
        ? [['URL', (resource as PactFlowRegistrySettings).endpoint], ['Project', (resource as PactFlowRegistrySettings).project ?? '—'], ['Harness 仓库', (resource as PactFlowRegistrySettings).harnessRepository ?? 'pactflow-worker'], ['TLS', (resource as PactFlowRegistrySettings).tlsVerify ? '开启' : '关闭']]
        : kind === 'git-provider'
          ? [['URL', (resource as PactFlowGitProviderSettings).baseUrl], ['账号', (resource as PactFlowGitProviderSettings).username ?? '—']]
          : kind === 'harness'
            ? [['Harness', friendlyOption((resource as PactFlowHarnessProfileSettings).harness)], ['镜像', (resource as PactFlowHarnessProfileSettings).repository || '—'], ['资源', `${(resource as PactFlowHarnessProfileSettings).cpuLimit} CPU / ${(resource as PactFlowHarnessProfileSettings).memoryLimit}`]]
            : kind === 'model-connection'
              ? [['协议', friendlyOption((resource as PactFlowModelConnectionSettings).apiMode)], ['模型', (resource as PactFlowModelConnectionSettings).model], ['URL', (resource as PactFlowModelConnectionSettings).baseUrl]]
              : [['K3s 集群', (resource as PactFlowWorkerPoolSettings).clusterId], ['Harness', (resource as PactFlowWorkerPoolSettings).templateIds.join(', ')], ['并发', String((resource as PactFlowWorkerPoolSettings).maxConcurrency)], ['拉取凭证', (resource as PactFlowWorkerPoolSettings).imagePullSecret ?? '—']]
    return <dl style={summaryGridStyle}>{values.map(([label, value]) => <div key={label} style={summaryItemStyle}>
      <dt style={summaryLabelStyle}>{label}</dt><dd style={summaryValueStyle}>{value}</dd>
    </div>)}</dl>
  }
  return (
    <section style={settingsCardStyle}>
      <h2 style={sectionTitleStyle}>{t('settingsTitle')}</h2>
      <p>{t('settingsDescription')}</p>
      <p style={hintStyle}>{t('settingsRestart')}</p>
      <EditableResourceCards title="K3s 集群" description="连接集群并选择 Worker 运行的 Namespace。"
        rows={draft.clusters} disabled={actionDisabled}
        columns={clusterColumns} create={() => newCluster(draft.clusters)} onChange={rows => changeRows('cluster', 'clusters', rows)}
        onAdd={row => beginAdd('cluster', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('cluster', row.id)} summaryFor={row => summaryFor('cluster', row)}
        canSave={row => canSaveResource('cluster', row.id)} savingId={savingId}
        onEdit={row => beginEdit('cluster', row)} onSave={row => saveResource('cluster', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('cluster', row)}
        optionsFor={(row, column) => column.key === 'context'
          ? contextOptions[row.id] ?? (row.context === undefined ? [] : [row.context])
          : undefined}
        renderField={(row, index, column) => column.kind === 'file' ? (
          <div style={filePickerStyle}>
            <input value={row.kubeconfig ?? ''} readOnly style={readOnlyInputStyle} />
            <button type="button" onClick={() => pickKubeconfig(index)} style={secondaryButtonStyle}>选择文件</button>
          </div>
        ) : undefined}
        probeKind="cluster" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`cluster:${row.id}`]}
        showLogFor={row => expandedLogs.has(`cluster:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `cluster:${row.id}`))}
        onViewProbe={row => probe('cluster', row.id, true)} />
      <EditableResourceCards title="Harbor 镜像仓库" description="配置镜像服务、项目、TLS 策略和拉取密钥引用。"
        rows={draft.registries} disabled={actionDisabled}
        columns={registryColumns} create={() => newRegistry(draft.registries)} onChange={rows => changeRows('registry', 'registries', rows)}
        onAdd={row => beginAdd('registry', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('registry', row.id)} summaryFor={row => summaryFor('registry', row)}
        canSave={row => canSaveResource('registry', row.id)} savingId={savingId}
        onEdit={row => beginEdit('registry', row)} onSave={row => saveResource('registry', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('registry', row)}
        renderExtraFields={row => <CredentialInput
          label="密码 / Token" hint="留空保留已配置的凭证；新值仅写入 DSH Credentials。"
          value={credentialDrafts[row.passwordCredentialRef ?? ''] ?? ''}
          disabled={actionDisabled || row.passwordCredentialRef === undefined}
          onChange={value => { if (row.passwordCredentialRef !== undefined) updateSecret(row.passwordCredentialRef, value) }}
        />}
        probeKind="registry" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`registry:${row.id}`]}
        showLogFor={row => expandedLogs.has(`registry:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `registry:${row.id}`))}
        onViewProbe={row => probe('registry', row.id, true)} />
      <EditableResourceCards title="Gitea Git Provider" description="根据项目本地 Git remote 自动匹配代码仓库。"
        rows={draft.gitProviders} disabled={actionDisabled}
        columns={gitProviderColumns} create={() => newGitProvider(draft.gitProviders)} onChange={rows => changeRows('git-provider', 'gitProviders', rows)}
        onAdd={row => beginAdd('git-provider', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('git-provider', row.id)} summaryFor={row => summaryFor('git-provider', row)}
        canSave={row => canSaveResource('git-provider', row.id)} savingId={savingId}
        onEdit={row => beginEdit('git-provider', row)} onSave={row => saveResource('git-provider', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('git-provider', row)}
        renderExtraFields={row => <CredentialInput
          label="密码 / Token" hint="用于 Gitea API，原值不写入 Settings。"
          value={credentialDrafts[row.tokenCredentialRef] ?? ''} disabled={actionDisabled}
          onChange={value => updateSecret(row.tokenCredentialRef, value)}
        />}
        probeKind="git-provider" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`git-provider:${row.id}`]}
        showLogFor={row => expandedLogs.has(`git-provider:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `git-provider:${row.id}`))}
        onViewProbe={row => probe('git-provider', row.id, true)} />
      {/* Capability levels per Harness, derived from the same registered templates
          shown above. Derived rather than fetched: a second source would let the
          panel show a verdict for a template the list no longer has. */}
      <PactFlowHarnessCapabilities
        views={draft.templates.filter(isHarnessProfile).map(row => harnessCapabilityViewOf(row.id, row.harness))} />
      <EditableResourceCards title="Harness 模板" description="只定义开发工具、Worker 镜像与 CPU/内存规格；不绑定模型。"
        rows={draft.templates.filter(isHarnessProfile)} disabled={actionDisabled}
        columns={templateColumns}
        create={() => newTemplate(draft.templates, draft.registries[0]?.id ?? '')}
        onChange={rows => changeRows('harness', 'templates', rows.map(row => {
          if (row.harness === 'dsh' && row.interactionProtocol) return row
          const { interactionProtocol, ...plain } = row; void interactionProtocol; return plain
        }))}
        onAdd={row => beginAdd('harness', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('harness', row.id)} summaryFor={row => summaryFor('harness', row)}
        canSave={row => canSaveResource('harness', row.id)} savingId={savingId}
        onEdit={row => beginEdit('harness', row)} onSave={row => saveResource('harness', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('harness', row)}
        optionsFor={(_row, column) => column.key === 'registryId' ? draft.registries.map(item => item.id) : undefined}
        labelForOption={(_row, column, value) => column.key === 'registryId'
          ? draft.registries.find(registry => registry.id === value)?.displayName ?? value
          : friendlyOption(value)}
        renderExtraFields={(row, _index, update) => <><HarborArtifactField
          artifacts={harborArtifacts[row.registryId] ?? []}
          value={`${row.repository}\u0000${row.artifactDigest}`}
          onChange={(value) => {
            const [repository, artifactDigest] = value.split('\u0000')
            update('repository', repository ?? '')
            update('artifactDigest', artifactDigest ?? '')
          }}
        />{row.harness === 'dsh' && <label style={{ display: 'grid', gap: 6 }}>
          <span><input type="checkbox" disabled={actionDisabled} checked={row.interactionProtocol === 'dsh-worker-interactions/v1'}
            onChange={event => update('interactionProtocol', event.currentTarget.checked ? 'dsh-worker-interactions/v1' : '')} /> 启用远程审批与提问</span>
          <small>仅用于已适配零脉交互协议的 DSH 专用镜像；不支持的镜像会明确失败。</small>
        </label>}</>}
        probeKind="harness" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`harness:${row.id}`]}
        showLogFor={row => expandedLogs.has(`harness:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `harness:${row.id}`))}
        onViewProbe={row => probe('harness', row.id, true)} />
      <EditableResourceCards title="模型连接" description="模型与 Harness 独立配置，运行任务时再选择兼容组合。"
        rows={draft.modelConnections ?? []} disabled={actionDisabled}
        columns={modelColumns} create={() => newModel(draft.modelConnections ?? [])}
        onChange={rows => changeRows('model-connection', 'modelConnections', rows)}
        onAdd={row => beginAdd('model-connection', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('model-connection', row.id)} summaryFor={row => summaryFor('model-connection', row)}
        canSave={row => canSaveResource('model-connection', row.id)} savingId={savingId}
        onEdit={row => beginEdit('model-connection', row)} onSave={row => saveResource('model-connection', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('model-connection', row)}
        renderExtraFields={(row, _index, update) => <>
          <CredentialInput
            label="API Key" hint="原值只写入 DSH Credentials，不进入 Settings 或日志。"
            value={credentialDrafts[row.apiKeyCredentialRef] ?? ''} disabled={actionDisabled}
            onChange={value => updateSecret(row.apiKeyCredentialRef, value)}
          />
          <ModelDiscoveryField
            models={modelOptions[row.id] ?? []} value={row.model}
            busy={modelDiscovery[row.id]?.busy === true}
            disabled={actionDisabled}
            failure={modelDiscovery[row.id]?.failure}
            manual={modelDiscovery[row.id]?.manual === true}
            onLoad={() => loadModels(row)}
            onManual={() => setModelDiscovery(current => {
              const failure = current[row.id]?.failure
              return {
                ...current, [row.id]: {
                  busy: false, manual: true, ...(failure === undefined ? {} : { failure }),
                },
              }
            })}
            onChange={value => update('model', value)}
          />
        </>}
        probeKind="model-connection" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`model-connection:${row.id}`]}
        showLogFor={row => expandedLogs.has(`model-connection:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `model-connection:${row.id}`))}
        onViewProbe={row => probe('model-connection', row.id, true)} />
      <EditableResourceCards title="Worker 并发与调度" description="选择运行集群和允许使用的 Harness；并发上限是池级总量（不分 Harness），由所有使用该池的项目共享，超出的任务自动排队。"
        rows={draft.workerPools} disabled={actionDisabled}
        columns={workerPoolColumns}
        create={() => newWorkerPool(
          draft.workerPools, draft.clusters[0]?.id ?? '', draft.registries[0]?.id ?? '',
          compatibleHarnessTemplateIds(draft.templates.filter(isHarnessProfile), draft.modelConnections ?? []),
        )}
        onChange={rows => changeRows('worker-pool', 'workerPools', rows)}
        onAdd={row => beginAdd('worker-pool', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('worker-pool', row.id)} summaryFor={row => summaryFor('worker-pool', row)}
        canSave={row => canSaveResource('worker-pool', row.id)} savingId={savingId}
        onEdit={row => beginEdit('worker-pool', row)} onSave={row => saveResource('worker-pool', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('worker-pool', row)}
        renderField={(row, _index, column, update) => {
          if (column.key === 'clusterId') return <select
            value={row.clusterId} style={inputStyle}
            onChange={event => {
              const clusterId = event.currentTarget.value
              update('clusterId', clusterId)
              const { imagePullSecret: _previousSecret, ...withoutSecret } = row
              refreshPoolPullSecrets({ ...withoutSecret, clusterId })
            }}
          ><option value="">请选择运行集群</option>{draft.clusters.map(cluster => <option
            key={cluster.id} value={cluster.id}
          >{cluster.displayName}</option>)}</select>
          if (column.key === 'templateIds') return <HarnessSelectionField
            templates={draft.templates.filter(isHarnessProfile)} models={draft.modelConnections ?? []} value={row.templateIds}
            onChange={value => update('templateIds', value.join(','))}
          />
          if (column.key === 'imagePullSecret') {
            const secrets = pullSecrets[row.clusterId] ?? []
            return <select value={row.imagePullSecret ?? ''} style={inputStyle}
              onChange={event => update('imagePullSecret', event.currentTarget.value)}
            ><option value="">{secrets.length === 0 ? '未发现 Harbor 拉取密钥' : '请选择 Harbor 拉取密钥'}</option>
              {secrets.map(secret => <option key={secret} value={secret}>{secret}</option>)}
            </select>
          }
          return undefined
        }}
        probeKind="worker-pool" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`worker-pool:${row.id}`]}
        showLogFor={row => expandedLogs.has(`worker-pool:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `worker-pool:${row.id}`))}
        onViewProbe={row => probe('worker-pool', row.id, true)} />
      <EditableResourceCards title="对象存储（大内容外置）" description="S3 兼容存储（如 RustFS）。绑定后 Worker 与宿主把超长内容外置为 artifactRef 地址，有界通道只传地址与摘要；删除被项目引用的存储会失败关闭。"
        rows={draft.artifactStores ?? []} disabled={actionDisabled}
        columns={artifactStoreColumns} create={() => newArtifactStore(draft.artifactStores ?? [])}
        onChange={rows => changeRows('artifact-store', 'artifactStores', rows)}
        onAdd={row => beginAdd('artifact-store', row)} addDisabled={activeEditor !== null}
        modeFor={row => modeFor('artifact-store', row.id)} summaryFor={row => summaryFor('artifact-store', row)}
        canSave={row => canSaveResource('artifact-store', row.id)} savingId={savingId}
        onEdit={row => beginEdit('artifact-store', row)} onSave={row => saveResource('artifact-store', row)}
        onCancel={cancelEdit} onRequestDelete={row => requestDelete('artifact-store', row)}
        renderExtraFields={(row) => <>
          <CredentialInput
            label="Access Key ID" hint="原值只写入 DSH Credentials，不进入 Settings 或日志。"
            value={credentialDrafts[row.accessKeyCredentialRef] ?? ''} disabled={actionDisabled}
            onChange={value => updateSecret(row.accessKeyCredentialRef, value)}
          />
          <CredentialInput
            label="Secret Access Key" hint="原值只写入 DSH Credentials，不进入 Settings 或日志。"
            value={credentialDrafts[row.secretKeyCredentialRef] ?? ''} disabled={actionDisabled}
            onChange={value => updateSecret(row.secretKeyCredentialRef, value)}
          />
        </>}
        probeKind="artifact-store" probingId={probingId} onProbe={probe}
        testLogFor={row => testLogs[`artifact-store:${row.id}`]}
        showLogFor={row => expandedLogs.has(`artifact-store:${row.id}`)}
        onToggleLog={row => setExpandedLogs(current => toggleSet(current, `artifact-store:${row.id}`))}
        onViewProbe={row => probe('artifact-store', row.id, true)} />
      <details><summary>高级 JSON（只读排障）</summary><textarea
        aria-label="PactFlow infrastructure JSON"
        value={advanced}
        readOnly
        rows={20}
        style={settingsEditorStyle}
      /></details>
      {notice === '' ? null : <p role="status" style={noticeStyle}>{notice}</p>}
      <ActionFeedbackToast feedback={feedback} onDone={clearFeedback} />
      {deleteDialog === null ? null : <DeleteResourceDialog
        state={deleteDialog}
        busy={savingId !== null}
        onCancel={() => setDeleteDialog(null)}
        onConfirm={confirmDelete}
      />}
    </section>
  )
}

/** Services required before the native entry, overlay, locale, and Remote can activate. */
