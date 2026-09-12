import { useEffect, useState } from 'react'
import { cardDrafts } from './card-drafts.ts'
import { pactFlowValidationProfilesSchema } from '../schema.ts'
import type { PactFlowValidationProfile, PactFlowValidationProfileInput, PactFlowWorkspaceProjectConfig } from '../types.ts'
import {
  resourceCardStyle, resourceListStyle, resourceFieldsStyle, resourceFieldStyle, resourceCardActionsStyle,
  resourceHeaderStyle, resourceTitleStyle, fieldHintStyle, inputStyle, buttonStyle, secondaryButtonStyle, errorTextStyle,
} from './styles.ts'

interface Draft {
  readonly key: string
  readonly id: string
  readonly displayName: string
  readonly command: string
  readonly argsText: string
  readonly timeoutMs: number
  readonly revision?: number
}

const sectionStyle = { ...resourceCardStyle, borderRadius: 12 }

function contents(profiles: readonly PactFlowValidationProfile[]): string {
  return JSON.stringify(profiles.map(profile => [profile.id, profile.displayName, profile.command, profile.args, profile.timeoutMs]))
}

function drafts(profiles: readonly PactFlowValidationProfile[]): readonly Draft[] {
  return profiles.map(profile => ({ key: crypto.randomUUID(), id: profile.id, displayName: profile.displayName,
    command: profile.command, argsText: JSON.stringify(profile.args), timeoutMs: profile.timeoutMs, revision: profile.revision }))
}

/** User-owned registration only: saving this card never runs the configured command. */
export function ValidationProfileEditor({ config, disabled, onSave }: {
  readonly config: PactFlowWorkspaceProjectConfig | undefined
  readonly disabled: boolean
  readonly onSave: (profiles: readonly PactFlowValidationProfileInput[] | undefined, selectedIds: readonly string[]) => void
}) {
  const original = config?.validationProfiles ?? []
  // A8: the unsaved draft lives in the per-card store keyed by card identity, so
  // switching between workspace cards preserves each card's draft independently.
  const draftKey = `validation-profiles:${config?.workspaceId ?? 'none'}`
  const stored = cardDrafts.get(draftKey)
  const restore = (): { rows: readonly Draft[]; selected: readonly string[] } => {
    if (stored !== undefined) {
      try {
        const parsedDraft = JSON.parse(stored) as { rows?: readonly Draft[]; selected?: readonly string[] }
        if (Array.isArray(parsedDraft.rows) && Array.isArray(parsedDraft.selected)) {
          return { rows: parsedDraft.rows, selected: parsedDraft.selected }
        }
      } catch { /* fall through to the persisted state */ }
    }
    return { rows: drafts(original), selected: config?.validationProfileIds ?? [] }
  }
  const restored = restore()
  const [rows, setRows] = useState<readonly Draft[]>(restored.rows)
  const [selected, setSelected] = useState<readonly string[]>(restored.selected)
  const parsed = (() => {
    try {
      return pactFlowValidationProfilesSchema.safeParse(rows.map(row => ({
        id: row.id, displayName: row.displayName, command: row.command, args: JSON.parse(row.argsText),
        timeoutMs: row.timeoutMs, revision: row.revision ?? 1,
      })))
    } catch { return undefined }
  })()
  const profiles = parsed?.success ? parsed.data : undefined
  const profilesChanged = profiles !== undefined && contents(profiles) !== contents(original)
  const dirty = profilesChanged || JSON.stringify(selected) !== JSON.stringify(config?.validationProfileIds ?? [])
  // Persist the draft ONLY when the card is actually dirty: a freshly mounted
  // editor must not mark the card as having unsaved changes.
  useEffect(() => {
    if (dirty) cardDrafts.set(draftKey, JSON.stringify({ rows, selected }))
  }, [draftKey, dirty, rows, selected])
  const update = (row: Draft, patch: Partial<Draft>): void => {
    setRows(current => current.map(item => item.key === row.key ? { ...item, ...patch } : item))
    if (patch.id !== undefined) setSelected(current => current.map(id => id === row.id ? patch.id! : id))
  }
  const add = (): void => {
    let next = 1
    while (rows.some(row => row.id === `validation-${next}`)) next++
    setRows(current => [...current, { key: crypto.randomUUID(), id: `validation-${next}`, displayName: '验证命令',
      command: 'git', argsText: '["diff","--check"]', timeoutMs: 30_000 }])
  }
  return <section aria-label="宿主验证配置" style={sectionStyle}>
    <div style={resourceHeaderStyle}>
      <h3 style={resourceTitleStyle}>宿主验证配置</h3>
      <button type="button" disabled={disabled || rows.length >= 32} onClick={add} style={secondaryButtonStyle}>新增验证配置</button>
    </div>
    <p style={fieldHintStyle}>登记本项目的验证命令（构建、测试、部署检查等），作为收口证据的来源：任务运行时模型按编号执行，成功后留档为「验证证据」，供下方收口最小验证策略核对。保存仅登记、不执行命令；不要登记不可信脚本或明文凭证；修改会使旧绑定需要重新核验。</p>
    <div style={resourceListStyle}>{rows.map((row, index) => <fieldset key={row.key} aria-label={`验证配置 ${index + 1}`} disabled={disabled} style={resourceCardStyle}>
      <legend>{row.displayName || `验证配置 ${index + 1}`}</legend>
      <div style={resourceFieldsStyle}>
        <label style={resourceFieldStyle}>配置编号<input value={row.id} disabled={row.revision !== undefined} onChange={event => update(row, { id: event.currentTarget.value })} style={inputStyle} /></label>
        <label style={resourceFieldStyle}>显示名称<input value={row.displayName} onChange={event => update(row, { displayName: event.currentTarget.value })} style={inputStyle} /></label>
        <label style={resourceFieldStyle}>可执行命令<input value={row.command} onChange={event => update(row, { command: event.currentTarget.value })} style={inputStyle} /></label>
        <label style={resourceFieldStyle}>超时（毫秒）<input type="number" min={1000} max={3_600_000} value={row.timeoutMs} onChange={event => update(row, { timeoutMs: Number(event.currentTarget.value) })} style={inputStyle} /></label>
      </div>
      <label style={resourceFieldStyle}>参数数组<textarea aria-label="参数数组" value={row.argsText} onChange={event => update(row, { argsText: event.currentTarget.value })} rows={2} style={inputStyle} /></label>
      <span style={fieldHintStyle}>使用 JSON（结构化数据）字符串数组，例如 ["diff","--check"]；不按命令行拆分。</span>
      <label><input type="checkbox" checked={selected.includes(row.id)} onChange={event => {
        const checked = event.currentTarget.checked
        setSelected(current => checked ? [...current, row.id] : current.filter(id => id !== row.id))
      }} />默认收口验证</label>
      <button type="button" onClick={() => {
        setRows(current => current.filter(item => item.key !== row.key))
        setSelected(current => current.filter(id => id !== row.id))
      }} style={secondaryButtonStyle}>移除此配置</button>
    </fieldset>)}</div>
    {rows.length === 0 ? <p style={fieldHintStyle}>尚未登记验证配置。</p> : null}
    {profiles === undefined ? <p role="alert" style={errorTextStyle}>请检查编号、命令、参数数组与超时；禁止命令解释器包装。</p> : null}
    <p style={fieldHintStyle}>默认执行顺序：{selected.join(' → ') || '未选择'}</p>
    <div style={resourceCardActionsStyle}><button type="button" disabled={disabled || profiles === undefined || !dirty} onClick={() => {
      if (profiles !== undefined) { cardDrafts.clear(draftKey); onSave(profilesChanged ? profiles : undefined, selected) }
    }} style={buttonStyle}>保存验证配置</button>
    <button type="button" disabled={disabled} onClick={() => {
      cardDrafts.clear(draftKey)
      setRows(drafts(original)); setSelected(config?.validationProfileIds ?? [])
    }} style={secondaryButtonStyle}>撤销未保存更改</button></div>
  </section>
}
