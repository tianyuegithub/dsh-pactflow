import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import {
  IconAgentPresetOutline16, IconCheckOutline14, IconCodeOutline16, IconEditOutline16, IconPlusOutline16,
  IconQueueOutline14, IconSparkle16, IconTrashOutline16,
} from '@deepseek-ai/dsh-client-ui-primitives/src/icons/index.tsx'
import type {
  PactFlowAgentProfile,
  PactFlowConfirmWorkspaceRemoteRequest,
  PactFlowHarnessProfileSettings,
  PactFlowModelConnectionSettings,
  PactFlowProjectWorkerPolicy,
  PactFlowRemoteReconciliation,
  PactFlowWorkerPoolStatus,
  PactFlowWorkspaceProjectConfig,
  PactFlowWorkspaceProjectView,
} from '../types.ts'
import { ActionFeedbackToast, useActionFeedback } from './action-feedback.tsx'
import { createRequestGate } from './request-gate.ts'
import { cardDrafts } from './card-drafts.ts'
import { ValidationProfileEditor } from './validation-profile-editor.tsx'
import type { PactFlowValidationProfileInput } from '../types.ts'

export interface PactFlowProjectPanelFace {
  list(): Promise<readonly PactFlowWorkspaceProjectView[]>
  catalogs(): Promise<{
    readonly clusters: readonly { readonly id: string; readonly displayName: string }[]
    readonly pools: readonly PactFlowWorkerPoolStatus[]
    readonly templates: readonly PactFlowHarnessProfileSettings[]
    readonly models: readonly PactFlowModelConnectionSettings[]
    readonly giteaProviders: readonly { readonly id: string; readonly name: string; readonly username?: string }[]
  }>
  initializeGit(workspaceId: string, expectedPath: string): Promise<PactFlowWorkspaceProjectView>
  adoptGit(workspaceId: string, expectedRevision: number): Promise<PactFlowWorkspaceProjectConfig>
  gitSecrets(clusterId: string): Promise<readonly string[]>
  saveWorker(workspaceId: string, expectedRevision: number, k3sGitSecretName: string, worker: PactFlowProjectWorkerPolicy): Promise<PactFlowWorkspaceProjectConfig>
  saveValidation(workspaceId: string, expectedRevision: number, profiles: readonly PactFlowValidationProfileInput[] | undefined, selectedIds: readonly string[]): Promise<PactFlowWorkspaceProjectConfig>
  savePolicy(workspaceId: string, expectedRevision: number, groups: readonly { readonly id: string; readonly profileIds: readonly string[] }[]): Promise<PactFlowWorkspaceProjectConfig>
  saveHostBaseline(workspaceId: string, expectedRevision: number, commands: readonly { readonly command: string; readonly args: readonly string[]; readonly timeoutMs: number }[]): Promise<PactFlowWorkspaceProjectConfig>
  createRemote(request: {
    readonly workspaceId: string
    readonly expectedRevision: number
    readonly providerId: string
    readonly owner: string
    readonly repo: string
    readonly private: boolean
    readonly defaultBranch: string
  }): Promise<PactFlowWorkspaceProjectConfig>
  remoteCandidates(workspaceId: string): Promise<PactFlowRemoteReconciliation>
  confirmRemote(request: PactFlowConfirmWorkspaceRemoteRequest): Promise<PactFlowWorkspaceProjectConfig>
  migrate(workspaceId: string, sessionId: string, expectedRevision: number): Promise<PactFlowWorkspaceProjectConfig>
}

type ProjectPanelProps = PropsRuntime<'sidebar.footer.action'> & InjectFace<PactFlowProjectPanelFace>

const protocol = {
  claude: 'anthropic-messages', codex: 'openai-responses',
  opencode: 'openai-chat-completions', dsh: 'openai-chat-completions',
} as const

function slug(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/g, '-').replace(/^-+|-+$/g, '') || 'project'
}

function uniqueProfileId(base: string, profiles: readonly PactFlowAgentProfile[]): string {
  if (!profiles.some(profile => profile.id === base)) return base
  let suffix = 2
  while (profiles.some(profile => profile.id === `${base}-${String(suffix)}`)) suffix += 1
  return `${base}-${String(suffix)}`
}

function friendlyProtocol(value: string): string {
  return ({
    'anthropic-messages': 'Anthropic Messages',
    'openai-responses': 'OpenAI Responses',
    'openai-chat-completions': 'OpenAI Chat Completions',
  } as Readonly<Record<string, string>>)[value] ?? value
}

export function PactFlowProjectPanel({ wide, list, catalogs, initializeGit, adoptGit, gitSecrets, saveWorker, saveValidation, savePolicy, saveHostBaseline, createRemote, remoteCandidates, confirmRemote, migrate }: ProjectPanelProps) {
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<readonly PactFlowWorkspaceProjectView[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [catalog, setCatalog] = useState<Awaited<ReturnType<typeof catalogs>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [savingAction, setSavingAction] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { feedback, showFeedback, clearFeedback } = useActionFeedback()
  const [confirmInit, setConfirmInit] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const [remotePreview, setRemotePreview] = useState(false)
  const [reconcile, setReconcile] = useState<PactFlowRemoteReconciliation | null>(null)
  const [confirmRepoId, setConfirmRepoId] = useState('')
  const [providerId, setProviderId] = useState('')
  const [owner, setOwner] = useState('')
  const [repo, setRepo] = useState('')
  const [isPrivate, setPrivate] = useState(true)
  const [defaultBranch, setDefaultBranch] = useState('main')
  const [poolId, setPoolId] = useState('')
  const [clusterId, setClusterId] = useState('')
  const [gitSecretOptions, setGitSecretOptions] = useState<readonly string[]>([])
  const [gitSecretName, setGitSecretName] = useState('')
  const [agentProfiles, setAgentProfiles] = useState<readonly PactFlowAgentProfile[]>([])
  const [draftHarnessId, setDraftHarnessId] = useState('')
  const [draftModelId, setDraftModelId] = useState('')
  const [draftConcurrency, setDraftConcurrency] = useState(1)
  const [draftName, setDraftName] = useState('')
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null)
  const [migrationPreview, setMigrationPreview] = useState<string | null>(null)
  const selected = rows.find(row => row.workspaceId === selectedId) ?? rows[0]
  // Rapid workspace/cluster switches must not let a slow earlier response land on
  // the newer selection.
  const refreshGate = useRef(createRequestGate())
  const gitSecretsGate = useRef(createRequestGate())

  const refresh = (): void => {
    setBusy(true); setError(null)
    refreshGate.current.invalidate()
    const token = refreshGate.current.next()
    void Promise.all([list(), catalogs()]).then(([nextRows, nextCatalog]) => {
      if (!refreshGate.current.isLatest(token)) return
      setRows(nextRows); setCatalog(nextCatalog)
      setSelectedId(current => current !== null && nextRows.some(row => row.workspaceId === current)
        ? current : nextRows[0]?.workspaceId ?? null)
      setBusy(false)
    }, failure => {
      if (!refreshGate.current.isLatest(token)) return
      setBusy(false); setError(message(failure))
    })
  }

  useEffect(() => { if (open) refresh() }, [open])
  useEffect(() => {
    if (selected === undefined || catalog === null) return
    const config = selected.config
    const firstCluster = config?.worker?.clusterId ?? catalog.clusters[0]?.id ?? ''
    const clusterPools = catalog.pools.filter(item => item.clusterId === firstCluster)
    const firstPool = config?.worker?.workerPoolId ?? clusterPools[0]?.id ?? ''
    setClusterId(firstCluster)
    setPoolId(firstPool)
    setAgentProfiles(config?.worker?.agentProfiles ?? [])
    setGitSecretName(config?.git?.k3sGitSecretName ?? '')
    setDraftHarnessId(''); setDraftModelId(''); setDraftConcurrency(1); setDraftName(''); setEditingProfileId(null)
    const provider = catalog.giteaProviders[0]
    setProviderId(config?.git?.giteaProviderId ?? provider?.id ?? '')
    setOwner(config?.git?.owner ?? provider?.username ?? '')
    setRepo(config?.git?.repo ?? slug(selected.title))
    setDefaultBranch(config?.git?.defaultBranch ?? selected.gitStatus.branch ?? 'main')
    setPrivate(true); setConfirmInit(false); setRemotePreview(false); setMigrationPreview(null); setError(null)
  }, [selected?.workspaceId, selected?.config?.revision, catalog])

  useEffect(() => {
    if (!open || clusterId === '' || selected === undefined) return
    // A cluster switch supersedes any in-flight secret lookup.
    gitSecretsGate.current.invalidate()
    const token = gitSecretsGate.current.next()
    void gitSecrets(clusterId).then(values => {
      if (!gitSecretsGate.current.isLatest(token)) return
      setGitSecretOptions(values)
      setGitSecretName(current => {
        if (current !== '' && values.includes(current)) return current
        const expected = `pactflow-git-${slug(selected.title)}`
        return values.includes(expected) ? expected : values.length === 1 ? values[0]! : ''
      })
    }, failure => {
      if (!gitSecretsGate.current.isLatest(token)) return
      setError(message(failure))
    })
  }, [open, clusterId, selected?.workspaceId, gitSecrets])

  const clusterPools = catalog?.pools.filter(item => item.clusterId === clusterId) ?? []
  const pool = clusterPools.find(item => item.id === poolId)
  const poolTemplates = useMemo(() => new Set(pool?.templateIds ?? []), [pool])

  const act = (operation: () => Promise<unknown>, save?: { readonly id: string; readonly success: string }): void => {
    setBusy(true); setError(null)
    if (save !== undefined) setSavingAction(save.id)
    void operation().then(() => {
      setSavingAction(null)
      if (save !== undefined) showFeedback('success', save.success)
      refresh()
    }, failure => {
      const detail = message(failure)
      setBusy(false); setSavingAction(null); setError(detail)
      if (save !== undefined) showFeedback('error', `保存失败：${detail}`)
    })
  }

  const draftTemplate = catalog?.templates.find(item => item.id === draftHarnessId)
  const compatibleModels = draftTemplate === undefined
    ? [] : catalog?.models.filter(model => model.apiMode === protocol[draftTemplate.harness]) ?? []
  const draftModel = compatibleModels.find(model => model.id === draftModelId)
  const totalWorkers = agentProfiles.reduce((total, profile) => total + profile.maxConcurrency, 0)

  const resetProfileDraft = (): void => {
    setDraftHarnessId(''); setDraftModelId(''); setDraftConcurrency(1); setDraftName(''); setEditingProfileId(null)
  }

  const editProfile = (profile: PactFlowAgentProfile): void => {
    setEditingProfileId(profile.id); setDraftHarnessId(profile.templateId)
    setDraftModelId(profile.modelConnectionId); setDraftConcurrency(profile.maxConcurrency)
    setDraftName(profile.displayName)
  }

  const upsertProfile = (): void => {
    if (draftTemplate === undefined) { setError('请选择 Harness'); return }
    if (draftModel === undefined) { setError('请选择兼容模型'); return }
    if (!Number.isSafeInteger(draftConcurrency) || draftConcurrency < 1 || draftConcurrency > 12) {
      setError('Worker 数量必须是 1-12 的整数'); return
    }
    const duplicate = agentProfiles.some(profile => profile.id !== editingProfileId
      && profile.templateId === draftTemplate.id && profile.modelConnectionId === draftModel.id)
    if (duplicate) { setError('相同 Harness 与模型组合已经存在'); return }
    const base = slug(`${draftTemplate.id}-${draftModel.id}`).slice(0, 56)
    const id = editingProfileId ?? uniqueProfileId(base, agentProfiles)
    const profile: PactFlowAgentProfile = {
      id, displayName: draftName.trim() || `${draftTemplate.displayName} · ${draftModel.displayName}`,
      templateId: draftTemplate.id, modelConnectionId: draftModel.id,
      maxConcurrency: draftConcurrency,
    }
    setAgentProfiles(current => editingProfileId === null
      ? [...current, profile]
      : current.map(item => item.id === editingProfileId ? profile : item))
    setError(null); resetProfileDraft()
  }

  return <div style={wide ? footerRootStyle : footerRailRootStyle}>
    <button type="button" aria-label="零脉项目" onClick={() => { setConfirmDiscard(false); setOpen(true) }} style={wide ? footerButtonStyle : footerRailButtonStyle}>
      <IconAgentPresetOutline16 size={wide ? 16 : 18} />{wide ? <span>零脉项目</span> : null}
    </button>
    {!open ? null : <div role="presentation" style={backdropStyle}>
      <section role="dialog" aria-modal="true" aria-label="零脉项目" style={panelStyle}>
        <header style={headerStyle}>
          <div><h2 style={titleStyle}>零脉项目</h2><p style={mutedStyle}>工作区级 Git、验证配置与执行策略</p></div>
          <button type="button" onClick={() => {
            // A8: closing with unsaved editor drafts asks before discarding.
            const dirtyKey = selected === undefined ? null : `validation-profiles:${selected.workspaceId}`
            if (dirtyKey !== null && cardDrafts.has(dirtyKey) && !confirmDiscard) {
              setConfirmDiscard(true)
              return
            }
            if (dirtyKey !== null) cardDrafts.clear(dirtyKey)
            setConfirmDiscard(false)
            setOpen(false)
          }} style={secondaryButtonStyle}>{confirmDiscard ? '未保存更改将丢失，确认关闭？' : '关闭'}</button>
        </header>
        <div style={bodyStyle}>
          <nav aria-label="工作区项目" style={workspaceListStyle}>
            {rows.map(row => <button key={row.workspaceId} type="button"
              onClick={() => setSelectedId(row.workspaceId)}
              style={row.workspaceId === selected?.workspaceId ? selectedWorkspaceStyle : workspaceStyle}
            ><strong>{row.title}</strong><span style={mutedStyle}>{row.path}</span></button>)}
          </nav>
          <main style={contentStyle}>
            {selected === undefined ? <p>尚无工作区。</p> : <>
              <section style={cardStyle}>
                <div style={cardHeaderStyle}><h3 style={cardTitleStyle}>Git 仓库</h3><span>修订 {String(selected.config?.revision ?? 0)}</span></div>
                <dl style={factsStyle}>
                  <div><dt>状态</dt><dd>{selected.gitStatus.initialized ? '已初始化' : '未初始化'}</dd></div>
                  <div><dt>分支</dt><dd>{selected.gitStatus.branch ?? '—'}</dd></div>
                  <div><dt>远程</dt><dd>{selected.gitStatus.remoteUrl ?? '—'}</dd></div>
                  <div><dt>工作树</dt><dd>{selected.gitStatus.clean ? '干净' : `${String(selected.gitStatus.changedFiles)} 个修改，${String(selected.gitStatus.untrackedFiles)} 个未跟踪`}</dd></div>
                </dl>
                {!selected.gitStatus.initialized ? <div style={actionsStyle}>
                  {!confirmInit ? <button type="button" onClick={() => setConfirmInit(true)} style={primaryButtonStyle}>初始化 Git 项目</button> : <>
                    <p style={warningStyle}>只执行 git init，不会暂存或提交任何文件。</p>
                    <button type="button" disabled={busy} onClick={() => act(() => initializeGit(selected.workspaceId, selected.path))} style={primaryButtonStyle}>确认初始化</button>
                    <button type="button" onClick={() => setConfirmInit(false)} style={secondaryButtonStyle}>取消</button>
                  </>}
                </div> : !selected.gitStatus.hasCommit ? <p style={warningStyle}>请先检查 .gitignore、未跟踪文件并完成初始提交；零脉不会自动 git add。</p>
                  : selected.gitStatus.remoteUrl !== undefined ? <div style={actionsStyle}>
                    {selected.config?.git === undefined ? <button type="button" disabled={busy} onClick={() => act(() => adoptGit(selected.workspaceId, selected.config?.revision ?? 0))} style={primaryButtonStyle}>绑定现有远程仓库</button> : <span style={okStyle}>项目仓库已绑定</span>}
                  </div> : selected.config?.remoteCreation?.state === 'creating' ? <div style={actionsStyle}>
                    <p style={warningStyle}>上一次创建远程仓库的结果未知（操作编号 {selected.config.remoteCreation.id.slice(0, 8)}…）。请查询候选并人工确认精确仓库编号后接续推送；描述与编号只是线索，不是所有权证明。</p>
                    {reconcile === null ? <button type="button" disabled={busy} onClick={() => act(() => remoteCandidates(selected.workspaceId).then(result => { setReconcile(result); return result }))} style={primaryButtonStyle}>查询候选仓库</button> : <>
                      {reconcile.candidates.map(candidate => <p key={String(candidate.id)} style={mutedStyle}>
                        编号 {String(candidate.id)} · {candidate.fullName} · {candidate.defaultBranch} · {candidate.private ? '私有' : '公开'}{candidate.empty ? ' · 空仓库' : ''}
                        · {['exactName', 'defaultBranch', 'private', 'descriptionClue'].filter(key => candidate.matches[key as keyof typeof candidate.matches]).length}/4 项匹配
                      </p>)}
                      {reconcile.candidates.length === 0 ? <p style={warningStyle}>未发现候选仓库；请核对该 Gitea 实例与所有者。</p> : null}
                      <Field label="精确仓库编号"><input value={confirmRepoId} onChange={event => setConfirmRepoId(event.currentTarget.value)} style={inputStyle} /></Field>
                      <button type="button" disabled={busy || confirmRepoId.trim() === ''} onClick={() => act(() => confirmRemote({ workspaceId: selected.workspaceId, expectedRevision: selected.config?.revision ?? 0, repoId: Number(confirmRepoId.trim()) }), { id: 'remote-reconcile-confirm', success: '已确认仓库；再次点击“确认创建并推送”完成推送' })} style={primaryButtonStyle}>确认编号</button>
                      <button type="button" onClick={() => { setReconcile(null); setConfirmRepoId('') }} style={secondaryButtonStyle}>取消</button>
                    </>}
                  </div> : <div style={formGridStyle}>
                    <Field label="Gitea 配置"><select value={providerId} onChange={event => setProviderId(event.currentTarget.value)} style={inputStyle}>{catalog?.giteaProviders.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></Field>
                    <Field label="所有者"><input value={owner} onChange={event => setOwner(event.currentTarget.value)} style={inputStyle} /></Field>
                    <Field label="仓库名称"><input value={repo} onChange={event => setRepo(event.currentTarget.value)} style={inputStyle} /></Field>
                    <Field label="默认分支"><input value={defaultBranch} onChange={event => setDefaultBranch(event.currentTarget.value)} style={inputStyle} /></Field>
                    <Field label="可见性"><select value={isPrivate ? 'private' : 'public'} onChange={event => setPrivate(event.currentTarget.value === 'private')} style={inputStyle}><option value="private">私有</option><option value="public">公开</option></select></Field>
                    <div style={actionsStyle}>{!remotePreview ? <button type="button" onClick={() => setRemotePreview(true)} style={primaryButtonStyle}>预览创建远程仓库</button> : <>
                      <p style={warningStyle}>将在全局 Gitea 中创建 {owner}/{repo}（{isPrivate ? '私有' : '公开'}），添加 origin 并推送 {defaultBranch}。</p>
                      <button type="button" disabled={busy} onClick={() => act(() => createRemote({ workspaceId: selected.workspaceId, expectedRevision: selected.config?.revision ?? 0, providerId, owner, repo, private: isPrivate, defaultBranch }))} style={primaryButtonStyle}>确认创建并推送</button>
                      <button type="button" onClick={() => setRemotePreview(false)} style={secondaryButtonStyle}>取消</button>
                    </>}</div>
                  </div>}
              </section>

              <ValidationProfileEditor key={`${selected.workspaceId}:${selected.config?.revision ?? 0}`}
                config={selected.config} disabled={busy}
                onSave={(profiles, ids) => act(() => saveValidation(selected.workspaceId, selected.config?.revision ?? 0, profiles, ids),
                  { id: 'validation-profiles', success: '验证配置保存成功' })} />
              <ValidationPolicySection key={`${selected.workspaceId}:policy:${selected.config?.revision ?? 0}`}
                config={selected.config} disabled={busy}
                onSave={groups => act(() => savePolicy(selected.workspaceId, selected.config?.revision ?? 0, groups),
                  { id: 'validation-policy', success: '收口策略保存成功' })} />
              <HostBaselineSection key={`${selected.workspaceId}:baseline:${selected.config?.revision ?? 0}`}
                config={selected.config} disabled={busy}
                onSave={commands => act(() => saveHostBaseline(selected.workspaceId, selected.config?.revision ?? 0, commands),
                  { id: 'host-baseline', success: '宿主基线保存成功' })} />
              <section style={cardStyle}>
                <div style={cardHeaderStyle}>
                  <div><h3 style={cardTitleStyle}>Agent 组合</h3><p style={mutedStyle}>Agent Profile = Harness × Model × Worker 数量</p></div>
                  <span style={mutedStyle}>只引用全局配置</span>
                </div>

                <div style={targetBarStyle}>
                  <Field label="运行集群"><select value={clusterId} onChange={event => {
                    const nextCluster = event.currentTarget.value
                    const pools = catalog?.pools.filter(item => item.clusterId === nextCluster) ?? []
                    setClusterId(nextCluster); setPoolId(pools.length === 1 ? pools[0]!.id : '')
                    setAgentProfiles([]); resetProfileDraft()
                  }} style={inputStyle}><option value="">请选择 K3s 集群</option>{catalog?.clusters.map(cluster => <option key={cluster.id} value={cluster.id}>{cluster.displayName}</option>)}</select></Field>
                  <Field label="执行资源池"><select value={poolId} onChange={event => { setPoolId(event.currentTarget.value); setAgentProfiles([]); resetProfileDraft() }} style={inputStyle}><option value="">请选择</option>{clusterPools.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></Field>
                  <Field label="Git 拉取密钥"><select value={gitSecretName} onChange={event => setGitSecretName(event.currentTarget.value)} style={inputStyle}><option value="">请选择 K3s Secret</option>{gitSecretOptions.map(secret => <option key={secret} value={secret}>{secret}</option>)}</select></Field>
                </div>

                <section aria-label="Agent 组合器" style={composerStyle}>
                  <div style={composerHeaderStyle}><div><strong>{editingProfileId === null ? '组合新的 Agent' : '编辑 Agent Profile'}</strong><p style={mutedStyle}>选择兼容模块，生成一个可审计的项目智能体规格。</p></div>
                    <Field label="Agent 名称"><input value={draftName} placeholder="自动生成，可修改" onChange={event => setDraftName(event.currentTarget.value)} style={inputStyle} /></Field>
                  </div>
                  <div style={moduleRowStyle}>
                    <div style={harnessModuleStyle}>
                      <div style={moduleLabelStyle}><IconCodeOutline16 /><span>Harness 执行器</span></div>
                      <select value={draftHarnessId} onChange={event => {
                        const templateId = event.currentTarget.value
                        const template = catalog?.templates.find(item => item.id === templateId)
                        const models = template === undefined ? [] : catalog?.models.filter(model => model.apiMode === protocol[template.harness]) ?? []
                        setDraftHarnessId(templateId); setDraftModelId(models[0]?.id ?? '')
                        setDraftName(template === undefined || models[0] === undefined ? '' : `${template.displayName} · ${models[0].displayName}`)
                      }} style={moduleSelectStyle}><option value="">选择 Harness</option>{catalog?.templates.filter(template => poolTemplates.has(template.id)).map(template => <option key={template.id} value={template.id}>{template.displayName}</option>)}</select>
                      <span style={moduleMetaStyle}>{draftTemplate === undefined ? '等待选择' : friendlyProtocol(protocol[draftTemplate.harness])}</span>
                    </div>
                    <div style={connectorStyle}><IconPlusOutline16 /></div>
                    <div style={modelModuleStyle}>
                      <div style={moduleLabelStyle}><IconSparkle16 /><span>兼容模型</span></div>
                      <select value={draftModelId} disabled={draftTemplate === undefined} onChange={event => {
                        const modelId = event.currentTarget.value
                        const model = compatibleModels.find(item => item.id === modelId)
                        setDraftModelId(modelId)
                        if (draftTemplate !== undefined && model !== undefined) setDraftName(`${draftTemplate.displayName} · ${model.displayName}`)
                      }} style={moduleSelectStyle}><option value="">选择模型</option>{compatibleModels.map(model => <option key={model.id} value={model.id}>{model.displayName} · {model.model}</option>)}</select>
                      <span style={moduleMetaStyle}>{draftModel === undefined ? '仅显示协议兼容项' : friendlyProtocol(draftModel.apiMode)}</span>
                    </div>
                    <div style={connectorStyle}><IconPlusOutline16 /></div>
                    <div style={quotaModuleStyle}>
                      <div style={moduleLabelStyle}><IconQueueOutline14 /><span>Worker 数量</span></div>
                      <input type="number" min={1} max={12} value={draftConcurrency} onChange={event => { setDraftConcurrency(Number(event.currentTarget.value)); setError(null) }} style={moduleSelectStyle} />
                      <span style={moduleMetaStyle}>本项目的并发上限（非预留）· 池全局上限 {String(pool?.maxConcurrency ?? 0)}，超出部分自动排队</span>
                    </div>
                  </div>
                  <div style={composerActionsStyle}>
                    {editingProfileId === null ? null : <button type="button" onClick={resetProfileDraft} style={secondaryButtonStyle}>取消编辑</button>}
                    <button type="button" disabled={draftTemplate === undefined || draftModel === undefined} onClick={upsertProfile} style={primaryButtonStyle}><IconSparkle16 /> {editingProfileId === null ? '生成 Agent Profile' : '更新 Agent Profile'}</button>
                  </div>
                </section>

                <div style={savedHeadingStyle}><strong>已保存的 Agent</strong><span>{String(agentProfiles.length)} 个规格 · 合计 {String(totalWorkers)} 个 Worker</span></div>
                {agentProfiles.length === 0 ? <button type="button" onClick={() => document.querySelector<HTMLElement>('[aria-label="Agent 组合器"] select')?.focus()} style={emptyProfileStyle}><IconPlusOutline16 /> 添加第一个 Agent 组合</button> : <div style={profileGridStyle}>{agentProfiles.map((profile, profileIndex) => {
                  const template = catalog?.templates.find(item => item.id === profile.templateId)
                  const model = catalog?.models.find(item => item.id === profile.modelConnectionId)
                  return <article key={profile.id} style={{ ...profileCardStyle, ...profileAccentStyles[profileIndex % profileAccentStyles.length] }}>
                    <div style={profileTopStyle}><div style={{ ...profileIconStyle, ...profileIconAccentStyles[profileIndex % profileIconAccentStyles.length] }}><IconAgentPresetOutline16 /></div><div><strong>{profile.displayName}</strong><p style={mutedStyle}>{friendlyProtocol(model?.apiMode ?? '')}</p></div></div>
                    <dl style={profileFactsStyle}><div style={profileFactRowStyle}><dt style={profileFactLabelStyle}>Harness</dt><dd style={profileFactValueStyle}>{template?.displayName ?? profile.templateId}</dd></div><div style={profileFactRowStyle}><dt style={profileFactLabelStyle}>模型</dt><dd style={profileFactValueStyle}>{model?.displayName ?? profile.modelConnectionId}</dd></div><div style={profileFactRowStyle}><dt style={profileFactLabelStyle}>数量</dt><dd style={profileFactValueStyle}><span style={capacityDotsStyle}>{Array.from({ length: Math.min(profile.maxConcurrency, 6) }, (_, index) => <IconCheckOutline14 key={index} />)}</span> × {String(profile.maxConcurrency)}</dd></div></dl>
                    <div style={profileFooterStyle}><span style={enabledStyle}><IconCheckOutline14 /> 已启用</span><div style={actionsStyle}><button type="button" aria-label={`编辑 ${profile.displayName}`} onClick={() => editProfile(profile)} style={iconButtonStyle}><IconEditOutline16 /></button><button type="button" aria-label={`删除 ${profile.displayName}`} onClick={() => setAgentProfiles(items => items.filter(item => item.id !== profile.id))} style={iconButtonStyle}><IconTrashOutline16 /></button></div></div>
                  </article>
                })}</div>}
                <div style={actionsStyle}><button type="button" disabled={busy || clusterId === '' || poolId === '' || gitSecretName === '' || agentProfiles.length === 0} onClick={() => act(() => saveWorker(selected.workspaceId, selected.config?.revision ?? 0, gitSecretName, { clusterId, workerPoolId: poolId, maxConcurrency: totalWorkers, agentProfiles }), { id: 'agent-strategy', success: 'Agent 策略保存成功' })} style={primaryButtonStyle}>{savingAction === 'agent-strategy' ? '保存中…' : '保存 Agent 策略'}</button></div>
              </section>

              {selected.migrationCandidates.length === 0 ? null : <section style={cardStyle}><h3 style={cardTitleStyle}>会话配置迁移候选</h3>{selected.migrationCandidates.map(candidate => <div key={candidate.sessionId} style={actionsStyle}>
                <span>{candidate.projectName} · 会话 {candidate.sessionId} · r{String(candidate.revision)}</span>
                {migrationPreview !== candidate.sessionId ? <button type="button" onClick={() => setMigrationPreview(candidate.sessionId)} style={secondaryButtonStyle}>迁移到工作区</button> : <>
                  <span style={warningStyle}>只复制 Git、验证命令和 Secret 引用；历史会话事件保持不变。</span>
                  <button type="button" disabled={busy} onClick={() => act(() => migrate(selected.workspaceId, candidate.sessionId, selected.config?.revision ?? 0))} style={primaryButtonStyle}>确认迁移</button>
                  <button type="button" onClick={() => setMigrationPreview(null)} style={secondaryButtonStyle}>取消</button>
                </>}
              </div>)}</section>}
            </>}
            {error === null ? null : <p role="alert" style={errorStyle}>{error}</p>}
            {busy ? <p role="status">处理中…</p> : null}
          </main>
        </div>
      </section>
    </div>}
    <ActionFeedbackToast feedback={feedback} onDone={clearFeedback} />
  </div>
}

function Field({ label, children }: { readonly label: string; readonly children: ReactNode }) {
  return <label style={fieldStyle}><span>{label}</span>{children}</label>
}

function message(error: unknown): string { return error instanceof Error ? error.message : String(error) }

const footerRootStyle: CSSProperties = { position: 'relative', flex: 'none', width: 'calc(100% + 4px)', margin: '4px -2px' }
const footerRailRootStyle: CSSProperties = { position: 'relative', flex: 'none', width: 36, margin: '8px 0 10px' }
const footerButtonStyle: CSSProperties = {
  width: '100%', height: 42, display: 'flex', alignItems: 'center', gap: 8,
  boxSizing: 'border-box', border: 0, borderRadius: 12, background: 'transparent',
  padding: '0 10px 0 8px', cursor: 'pointer', overflow: 'hidden', color: 'inherit',
  fontFamily: 'inherit', fontSize: 14, lineHeight: '22px',
}
const footerRailButtonStyle: CSSProperties = {
  ...footerButtonStyle, width: 36, height: 36, justifyContent: 'center', gap: 0,
  padding: 0, borderRadius: '50%',
}
const backdropStyle: CSSProperties = { position: 'fixed', inset: 0, zIndex: 900, background: 'rgba(0,0,0,.4)', display: 'grid', placeItems: 'center', padding: 24 }
const panelStyle: CSSProperties = { width: 'min(1080px,100%)', height: 'min(960px,calc(100vh - 48px))', background: 'var(--dsw-alias-bg-layer-2)', color: 'var(--dsw-alias-label-primary)', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 16, display: 'grid', gridTemplateRows: 'auto 1fr', overflow: 'hidden', boxShadow: '0 28px 80px rgba(0,0,0,.28)' }
const headerStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '18px 22px', borderBottom: '1px solid var(--dsw-alias-border-l2)' }
const titleStyle: CSSProperties = { margin: 0, fontSize: 22 }
const bodyStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '250px minmax(0,1fr)', minHeight: 0 }
const workspaceListStyle: CSSProperties = { overflowY: 'auto', padding: 12, borderRight: '1px solid var(--dsw-alias-border-l2)', display: 'grid', alignContent: 'start', gap: 8 }
const workspaceStyle: CSSProperties = { display: 'grid', textAlign: 'left', gap: 4, padding: 12, borderWidth: 1, borderStyle: 'solid', borderColor: 'transparent', borderRadius: 9, background: 'none', color: 'inherit', cursor: 'pointer' }
const selectedWorkspaceStyle: CSSProperties = { ...workspaceStyle, background: 'var(--dsw-alias-bg-layer-3)', borderColor: 'var(--dsw-alias-border-l2)' }
const contentStyle: CSSProperties = { overflowY: 'auto', padding: 18, display: 'grid', alignContent: 'start', gap: 14 }
const cardStyle: CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, padding: 16, display: 'grid', gap: 14 }
const cardHeaderStyle: CSSProperties = { display: 'flex', justifyContent: 'space-between', alignItems: 'center' }
const cardTitleStyle: CSSProperties = { margin: 0, fontSize: 17 }
const factsStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: 10, margin: 0 }
const formGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: 12 }
const fieldStyle: CSSProperties = { display: 'grid', gap: 6, fontSize: 13 }
const inputStyle: CSSProperties = { width: '100%', minHeight: 36, boxSizing: 'border-box', border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'var(--dsw-alias-bg-layer-3)', color: 'inherit', padding: '7px 10px' }
const actionsStyle: CSSProperties = { display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 8 }
const primaryButtonStyle: CSSProperties = { border: 0, borderRadius: 8, background: 'var(--dsw-alias-label-primary)', color: 'var(--dsw-alias-bg-layer-3)', padding: '8px 12px', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 7 }
const secondaryButtonStyle: CSSProperties = { border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8, background: 'none', color: 'inherit', padding: '8px 12px', cursor: 'pointer' }
const targetBarStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: 12, padding: 12, borderRadius: 10, background: 'var(--dsw-alias-bg-layer-3)' }
const composerStyle: CSSProperties = { display: 'grid', gap: 16, padding: 16, border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3)' }
const composerHeaderStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) minmax(220px,320px)', gap: 18, alignItems: 'end' }
const moduleRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'minmax(190px,1fr) 36px minmax(220px,1.2fr) 36px minmax(150px,.7fr)', alignItems: 'center', gap: 8 }
const moduleBaseStyle: CSSProperties = { minWidth: 0, minHeight: 126, display: 'grid', alignContent: 'space-between', gap: 12, padding: 14, borderRadius: 12, background: 'var(--dsw-alias-bg-layer-2)', boxShadow: '0 8px 20px rgba(23,41,38,.06)' }
const harnessModuleStyle: CSSProperties = { ...moduleBaseStyle, border: '1px solid rgba(65,157,102,.32)' }
const modelModuleStyle: CSSProperties = { ...moduleBaseStyle, border: '1px solid rgba(111,91,211,.28)' }
const quotaModuleStyle: CSSProperties = { ...moduleBaseStyle, border: '1px solid rgba(76,126,198,.28)' }
const moduleLabelStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }
const moduleSelectStyle: CSSProperties = { ...inputStyle, background: 'var(--dsw-alias-bg-layer-1)' }
const moduleMetaStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 11 }
const connectorStyle: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', justifySelf: 'center', border: '1px solid rgba(78,169,187,.42)', borderRadius: 15, color: 'rgb(43,145,165)', background: 'var(--dsw-alias-bg-layer-2)', boxShadow: '0 0 12px rgba(78,169,187,.22)' }
const composerActionsStyle: CSSProperties = { display: 'flex', justifyContent: 'flex-end', gap: 8 }
const savedHeadingStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }
const emptyProfileStyle: CSSProperties = { minHeight: 64, border: '1px dashed var(--dsw-alias-border-l2)', borderRadius: 10, background: 'none', color: 'var(--dsw-alias-label-secondary)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, cursor: 'pointer' }
const profileGridStyle: CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: 12 }
const profileCardStyle: CSSProperties = { minWidth: 0, display: 'grid', gap: 14, padding: 14, border: '1px solid rgba(74,139,113,.28)', borderRadius: 12, background: 'var(--dsw-alias-bg-layer-3)', boxShadow: '0 8px 18px rgba(31,57,51,.05)' }
const profileAccentStyles: readonly CSSProperties[] = [
  { borderColor: 'rgba(74,139,113,.3)' },
  { borderColor: 'rgba(112,92,194,.26)' },
  { borderColor: 'rgba(68,119,184,.26)' },
]
const profileTopStyle: CSSProperties = { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }
const profileIconStyle: CSSProperties = { width: 34, height: 34, flex: '0 0 auto', display: 'grid', placeItems: 'center', borderRadius: 9, background: 'rgba(72,157,102,.12)', color: 'rgb(43,128,78)' }
const profileIconAccentStyles: readonly CSSProperties[] = [
  { background: 'rgba(72,157,102,.12)', color: 'rgb(43,128,78)' },
  { background: 'rgba(112,92,194,.11)', color: 'rgb(93,71,176)' },
  { background: 'rgba(68,119,184,.11)', color: 'rgb(51,99,160)' },
]
const profileFactsStyle: CSSProperties = { display: 'grid', gap: 8, margin: 0 }
const profileFactRowStyle: CSSProperties = { display: 'grid', gridTemplateColumns: '64px minmax(0,1fr)', gap: 8, alignItems: 'start' }
const profileFactLabelStyle: CSSProperties = { color: 'var(--dsw-alias-label-tertiary)', fontSize: 12 }
const profileFactValueStyle: CSSProperties = { margin: 0, minWidth: 0, overflowWrap: 'anywhere' }
const profileFooterStyle: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, paddingTop: 10, borderTop: '1px solid var(--dsw-alias-border-l2)' }
const enabledStyle: CSSProperties = { color: 'rgb(35,143,75)', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }
const iconButtonStyle: CSSProperties = { width: 30, height: 30, display: 'grid', placeItems: 'center', border: 0, background: 'none', color: 'inherit', cursor: 'pointer', borderRadius: 7 }
const capacityDotsStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 1, color: 'var(--dsw-alias-label-primary)' }
const mutedStyle: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-tertiary)', fontSize: 12, overflowWrap: 'anywhere' }
const warningStyle: CSSProperties = { margin: 0, color: 'var(--dsw-alias-label-warning)', fontSize: 12 }
const okStyle: CSSProperties = { color: 'var(--dsw-alias-label-success)' }
const errorStyle: CSSProperties = { color: 'var(--dsw-alias-label-error)', margin: 0 }


/** A03-b: per-profile "closing-required" policy, written via the owner-only Remote. */
function ValidationPolicySection({ config, disabled, onSave }: {
  readonly config: PactFlowWorkspaceProjectConfig | null | undefined
  readonly disabled: boolean
  readonly onSave: (groups: readonly { readonly id: string; readonly profileIds: readonly string[] }[]) => void
}) {
  const profiles = config?.validationProfiles ?? []
  const current = config?.validationPolicy?.find(group => group.id === 'closing')?.profileIds ?? []
  const [draft, setDraft] = useState<readonly string[] | null>(null)
  const selected = draft ?? current
  return (
    <section style={cardStyle} aria-label="收口最小验证策略">
      <div style={cardHeaderStyle}>
        <div><h3 style={cardTitleStyle}>收口最小验证策略</h3><p style={mutedStyle}>收口＝把需求成果固化成提交并推送的时刻。这里勾选的验证是收口硬门槛：宿主逐个交付物核对「成功证据」，缺失即阻断收口；由宿主强制执行，模型不可修改或绕过。</p></div>
      </div>
      {profiles.length === 0 ? <p style={mutedStyle}>暂无验证配置；请先在上方添加验证配置。</p> : (
        <div style={targetBarStyle}>
          {profiles.map(profile => (
            <label key={profile.id} style={mutedStyle}>
              <input type="checkbox" checked={selected.includes(profile.id)} disabled={disabled}
                onChange={event => setDraft(event.currentTarget.checked
                  ? [...selected, profile.id]
                  : selected.filter(id => id !== profile.id))} />
              {' '}<strong>{profile.displayName}</strong>
            </label>
          ))}
        </div>
      )}
      <div style={actionsStyle}>
        <button type="button" disabled={disabled || draft === null} style={primaryButtonStyle}
          onClick={() => {
            onSave(selected.length > 0 ? [{ id: 'closing', profileIds: [...selected] }] : [])
            setDraft(null)
          }}>保存收口策略</button>
      </div>
    </section>
  )
}


/** A03-c: host-owned closing baseline commands (owner-only, JSON edited). */
function HostBaselineSection({ config, disabled, onSave }: {
  readonly config: PactFlowWorkspaceProjectConfig | null | undefined
  readonly disabled: boolean
  readonly onSave: (commands: readonly { readonly command: string; readonly args: readonly string[]; readonly timeoutMs: number }[]) => void
}) {
  const commands = config?.hostBaselineCommands ?? []
  const [draft, setDraft] = useState<string | null>(null)
  const text = draft ?? (commands.length === 0 ? '[]' : JSON.stringify(commands, null, 2))
  const parsed = (() => {
    if ((draft ?? '').trim() === '') return []
    let value: unknown
    try { value = JSON.parse(draft!) } catch { return null }
    if (!Array.isArray(value)) return null
    const parsedCommands: { command: string; args: string[]; timeoutMs: number }[] = []
    for (const item of value) {
      const entry = item as { command?: unknown; args?: unknown; timeoutMs?: unknown }
      if (typeof entry?.command !== 'string' || entry.command.trim() === ''
        || !Array.isArray(entry.args) || entry.args.some(arg => typeof arg !== 'string')
        || !Number.isSafeInteger(entry?.timeoutMs)) return null
      parsedCommands.push({ command: entry.command.trim(), args: entry.args as string[], timeoutMs: entry.timeoutMs as number })
    }
    return parsedCommands
  })()
  return (
    <section style={cardStyle} aria-label="宿主基线">
      <div style={cardHeaderStyle}>
        <div><h3 style={cardTitleStyle}>宿主基线</h3><p style={mutedStyle}>宿主自己的兜底检查（如禁止提交敏感或超大文件），存在任务仓库之外，Worker 和模型都改不了；收口时在候选提交上先于任务验证执行，失败即阻断收口。owner-only 高级配置（JSON 数组：[{"{"}command, args, timeoutMs{"}"}]）。</p></div>
      </div>
      <textarea aria-label="宿主基线命令 JSON" value={text} disabled={disabled}
        onChange={event => setDraft(event.currentTarget.value)}
        style={{ ...inputStyle, minHeight: 96, fontFamily: 'monospace' }} />
      <div style={actionsStyle}>
        <button type="button" disabled={disabled || draft === null || parsed === null} style={primaryButtonStyle}
          onClick={() => {
            onSave(parsed!)
            setDraft(null)
          }}>保存宿主基线</button>
        {draft !== null && parsed === null && <span style={warningStyle}>JSON 格式无效</span>}
      </div>
    </section>
  )
}
