import type { ReactNode } from 'react'
import { PACTFLOW_HARNESS_PROTOCOL } from '../harness-discovery.ts'
import { friendlyOption } from './resource-model.ts'
import { HealthStatus, InfrastructureTestLogView } from './infrastructure-status.tsx'
import type { InfrastructureTestLog, DeleteResourceDialogState } from './settings-contract.ts'
import type { PactFlowHarnessProfileSettings, PactFlowHarborArtifactOption, PactFlowInfrastructureResourceKind, PactFlowDiscoveredModel, PactFlowModelConnectionSettings } from '../types.ts'
import { buttonStyle, hintStyle, resourceSectionStyle, resourceHeaderStyle, resourceHeadingCopyStyle, resourceTitleStyle, resourceDescriptionStyle, resourceListStyle, resourceCardStyle, resourceCardHeadingStyle, resourceIndexStyle, resourceFieldsStyle, resourceFieldStyle, resourceFieldLabelStyle, fieldHintStyle, resourceCardActionsStyle, resourceSummaryStyle, inputStyle, secondaryButtonStyle, filePickerStyle, choiceGridStyle, choiceStyle, selectedChoiceStyle, disabledChoiceStyle, dangerButtonStyle, dangerPrimaryButtonStyle, confirmBackdropStyle, confirmDialogStyle, confirmTitleStyle, confirmActionsStyle, errorTextStyle } from './styles.ts'

export interface EditorColumn<T extends object> {
  readonly key: keyof T
  readonly label: string
  readonly kind?: 'text' | 'number' | 'boolean' | 'list' | 'file'
  readonly options?: readonly string[]
  readonly hint?: string
  readonly hidden?: boolean
  readonly advanced?: boolean
}

export function EditableResourceCards<T extends { readonly id: string }>({
  title, description, rows, columns, disabled, create, onChange, probeKind, probingId, onProbe,
  optionsFor, renderField, renderExtraFields,
  labelForOption,
  testLogFor,
  showLogFor, onToggleLog, onViewProbe,
  modeFor, summaryFor, canSave, savingId, onEdit, onSave, onCancel, onRequestDelete,
  onAdd,
  addDisabled,
}: {
  readonly title: string
  readonly description: string
  readonly rows: readonly T[]
  readonly columns: readonly EditorColumn<T>[]
  readonly disabled: boolean
  readonly create: () => T
  readonly onChange: (rows: readonly T[]) => void
  readonly probeKind?: PactFlowInfrastructureResourceKind
  readonly probingId?: string | null
  readonly onProbe?: (kind: PactFlowInfrastructureResourceKind, id: string) => void
  readonly optionsFor?: (row: T, column: EditorColumn<T>) => readonly string[] | undefined
  readonly labelForOption?: (row: T, column: EditorColumn<T>, value: string) => string
  readonly testLogFor?: (row: T) => InfrastructureTestLog | undefined
  readonly showLogFor?: (row: T) => boolean
  readonly onToggleLog?: (row: T) => void
  readonly onViewProbe?: (row: T) => void
  readonly modeFor?: (row: T) => 'view' | 'edit' | 'new'
  readonly summaryFor?: (row: T) => ReactNode
  readonly canSave?: (row: T) => boolean
  readonly savingId?: string | null
  readonly onEdit?: (row: T) => void
  readonly onSave?: (row: T) => void
  readonly onCancel?: (row: T) => void
  readonly onRequestDelete?: (row: T) => void
  readonly onAdd?: (row: T) => void
  readonly addDisabled?: boolean
  readonly renderField?: (
    row: T, index: number, column: EditorColumn<T>, update: (key: keyof T, value: string | boolean) => void,
  ) => ReactNode | undefined
  readonly renderExtraFields?: (
    row: T, index: number, update: (key: keyof T, value: string | boolean) => void,
  ) => ReactNode
}) {
  const update = (index: number, key: keyof T, raw: string | boolean): void => {
    const column = columns.find(candidate => candidate.key === key)
    let value: unknown = raw
    if (column?.kind === 'number') value = Number(raw)
    if (column?.kind === 'list') value = String(raw).split(',').map(item => item.trim()).filter(Boolean)
    onChange(rows.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  }
  return (
    <section style={resourceSectionStyle}>
      <div style={resourceHeaderStyle}>
        <div style={resourceHeadingCopyStyle}>
          <h3 style={resourceTitleStyle}>{title}</h3>
          <p style={resourceDescriptionStyle}>{description}</p>
        </div>
        <button type="button" disabled={disabled || addDisabled === true} onClick={() => {
          const row = create()
          // New fill-in cards lead the list so the form is visible without scrolling.
          if (onAdd === undefined) onChange([row, ...rows])
          else onAdd(row)
        }} style={buttonStyle}>
          + 新增
        </button>
      </div>
      {rows.length === 0 ? <p style={hintStyle}>尚未配置</p> : (
        <div style={resourceListStyle}>
          {rows.map((row, index) => (
            <article key={`${row.id}-${String(index)}`} style={resourceCardStyle}>
              <div style={resourceCardHeadingStyle}>
                <strong>{'displayName' in row && typeof row.displayName === 'string' && row.displayName !== ''
                  ? row.displayName
                  : `${title} ${String(index + 1)}`}</strong>
                {modeFor?.(row) === 'view' ? <HealthStatus
                  log={testLogFor?.(row)} onClick={() => onToggleLog?.(row)}
                /> : <span style={resourceIndexStyle}>{modeFor?.(row) === 'new' ? '未保存' : '编辑中'}</span>}
              </div>
              {modeFor?.(row) === 'view' ? <div style={resourceSummaryStyle}>{summaryFor?.(row)}</div> : <div style={resourceFieldsStyle}>
                {columns.filter(column => column.hidden !== true && column.advanced !== true).map((column) => {
                  const value = row[column.key] as unknown
                  const updateField = (key: keyof T, next: string | boolean): void => update(index, key, next)
                  const custom = renderField?.(row, index, column, updateField)
                  const options = optionsFor?.(row, column) ?? column.options
                  return <label key={String(column.key)} style={resourceFieldStyle}>
                    <span style={resourceFieldLabelStyle}>{column.label}</span>
                    {custom ?? (column.kind === 'boolean' ? (
                      <select
                        value={String(Boolean(value))}
                        disabled={disabled}
                        onChange={event => update(index, column.key, event.currentTarget.value === 'true')}
                        style={inputStyle}
                      ><option value="true">true</option><option value="false">false</option></select>
                    ) : options !== undefined ? (
                      <select
                        {...column.kind === 'list'
                          ? { multiple: true, value: Array.isArray(value) ? value.map(String) : [] }
                          : { value: String(value ?? '') }}
                        disabled={disabled}
                        onChange={event => update(
                          index,
                          column.key,
                          column.kind === 'list'
                            ? [...event.currentTarget.selectedOptions].map(option => option.value).join(',')
                            : event.currentTarget.value,
                        )}
                        style={inputStyle}
                      >{column.kind === 'list' ? null : <option value="">请选择</option>}{options.map(option => <option key={option} value={option}>{labelForOption?.(row, column, option) ?? friendlyOption(option)}</option>)}</select>
                    ) : (
                      <input
                        type={column.kind === 'number' ? 'number' : 'text'}
                        value={Array.isArray(value) ? value.join(', ') : String(value ?? '')}
                        disabled={disabled}
                        onChange={event => update(index, column.key, event.currentTarget.value)}
                        style={inputStyle}
                      />
                    ))}
                    {column.hint === undefined ? null : <span style={fieldHintStyle}>{column.hint}</span>}
                  </label>
                })}
                {renderExtraFields?.(row, index, (key, value) => update(index, key, value))}
              </div>}
              <div style={resourceCardActionsStyle}>
                  {modeFor?.(row) === 'view' ? <>
                    {probeKind !== undefined && onViewProbe !== undefined && <button
                      type="button" disabled={disabled || probingId !== null}
                      onClick={() => onViewProbe(row)} style={secondaryButtonStyle}
                    >{probingId === row.id ? '测试中…' : '可用性测试'}</button>}
                    <button type="button" onClick={() => onEdit?.(row)} style={secondaryButtonStyle}>编辑</button>
                    <button type="button" onClick={() => onRequestDelete?.(row)} style={dangerButtonStyle}>删除</button>
                  </> : <>
                  {probeKind !== undefined && onProbe !== undefined && <button
                    type="button" disabled={disabled || probingId !== null}
                    onClick={() => onProbe(probeKind, row.id)} style={buttonStyle}
                  >{probingId === row.id ? '测试中…' : '测试'}</button>}
                  <button type="button" disabled={disabled || canSave?.(row) !== true || savingId !== null}
                    onClick={() => onSave?.(row)} style={buttonStyle}
                  >{savingId === row.id ? '保存中…' : '保存'}</button>
                  <button type="button" disabled={disabled || savingId !== null}
                    onClick={() => onCancel?.(row)} style={secondaryButtonStyle}>取消</button>
                  </>}
              </div>
              {testLogFor?.(row) === undefined || (modeFor?.(row) === 'view' && showLogFor?.(row) !== true)
                ? null : <InfrastructureTestLogView log={testLogFor(row)!} />}
            </article>
          ))}
        </div>
      )}
    </section>
  )
}

export function DeleteResourceDialog({ state, busy, onCancel, onConfirm }: {
  readonly state: DeleteResourceDialogState
  readonly busy: boolean
  readonly onCancel: () => void
  readonly onConfirm: () => void
}) {
  const loading = state.impact === null && state.error === null
  const blocked = (state.impact?.blockers.length ?? 0) > 0
  return <div role="presentation" style={confirmBackdropStyle}>
    <section role="alertdialog" aria-modal="true" aria-label={`删除${state.name}`} style={confirmDialogStyle}>
      <h3 style={confirmTitleStyle}>删除「{state.name}」？</h3>
      {loading ? <p>正在检查项目和资源引用…</p> : null}
      {state.error === null ? null : <p style={errorTextStyle}>{state.error}</p>}
      {blocked ? <>
        <p>该资源仍被引用，不能删除：</p>
        <ul>{state.impact!.blockers.map(blocker => <li key={blocker}>{blocker}</li>)}</ul>
      </> : null}
      {!loading && !blocked && state.error === null ? <p>
        将删除资源配置，并清理 {String(state.impact?.credentialRefs.length ?? 0)} 个专用凭证。此操作不可撤销。
      </p> : null}
      <div style={confirmActionsStyle}>
        <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>取消</button>
        <button
          type="button" onClick={onConfirm}
          disabled={busy || loading || blocked || state.error !== null}
          style={dangerPrimaryButtonStyle}
        >{busy ? '删除中…' : '确认删除'}</button>
      </div>
    </section>
  </div>
}

export function CredentialInput({ label, hint, value, disabled, onChange }: {
  readonly label: string
  readonly hint: string
  readonly value: string
  readonly disabled: boolean
  readonly onChange: (value: string) => void
}) {
  return <label style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>{label}</span>
    <input
      type="password" autoComplete="off" value={value} disabled={disabled}
      placeholder="留空保持现有凭证"
      onChange={event => onChange(event.currentTarget.value)} style={inputStyle}
    />
    <span style={fieldHintStyle}>{hint}</span>
  </label>
}

export function HarborArtifactField({ artifacts, value, onChange }: {
  readonly artifacts: readonly PactFlowHarborArtifactOption[]
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  return <label style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>Worker 镜像</span>
    <select value={value} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}>
      <option value="">请先保存并测试 Harbor</option>
      {artifacts.map(artifact => <option
        key={`${artifact.repository}@${artifact.digest}`}
        value={`${artifact.repository}\u0000${artifact.digest}`}
      >{artifact.label}</option>)}
    </select>
    <span style={fieldHintStyle}>Harbor 返回的 digest 作为不可变运行镜像。</span>
  </label>
}

export function ModelDiscoveryField({ models, value, busy, disabled, failure, manual, onLoad, onManual, onChange }: {
  readonly models: readonly PactFlowDiscoveredModel[]
  readonly value: string
  readonly busy: boolean
  readonly disabled: boolean
  readonly failure: string | undefined
  readonly manual: boolean
  readonly onLoad: () => void
  readonly onManual: () => void
  readonly onChange: (value: string) => void
}) {
  return <div style={resourceFieldStyle}>
    <span style={resourceFieldLabelStyle}>模型</span>
    <div style={filePickerStyle}>
      <button type="button" onClick={onLoad} disabled={busy || disabled} style={secondaryButtonStyle}>
        {busy ? '加载中…' : '加载模型列表'}
      </button>
      {failure === undefined || manual ? null : <button type="button" onClick={onManual} disabled={disabled} style={secondaryButtonStyle}>
        手动填写模型 ID
      </button>}
    </div>
    {models.length > 0 && !manual ? <select value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}>
      <option value="">请选择模型</option>
      {value !== '' && !models.some(model => model.id === value)
        ? <option value={value}>{value}（当前配置，模型列表未返回）</option>
        : null}
      {models.map(model => <option key={model.id} value={model.id}>{
        model.name === undefined || model.name === model.id ? model.id : `${model.name} (${model.id})`
      }</option>)}
    </select> : manual ? <input
      aria-label="手动模型 ID" value={value} disabled={disabled} onChange={event => onChange(event.currentTarget.value)} style={inputStyle}
    /> : <span style={fieldHintStyle}>填写 URL 和 API Key 后加载服务端模型列表。</span>}
    {failure === undefined ? null : <span style={errorTextStyle}>{failure}</span>}
    {manual ? <span style={fieldHintStyle}>模型列表未验证；保存前仍会发送真实消息测试。</span> : null}
  </div>
}

export function HarnessSelectionField({ templates, models, value, onChange }: {
  readonly templates: readonly PactFlowHarnessProfileSettings[]
  readonly models: readonly PactFlowModelConnectionSettings[]
  readonly value: readonly string[]
  readonly onChange: (value: readonly string[]) => void
}) {
  return <div role="group" aria-label="允许调度的 Harness" style={choiceGridStyle}>
    {templates.map(template => {
      const selected = value.includes(template.id)
      const compatible = models.some(model => model.apiMode === PACTFLOW_HARNESS_PROTOCOL[template.harness])
      return <button
        key={template.id} type="button" aria-pressed={selected} disabled={!compatible}
        title={compatible ? undefined : `缺少 ${friendlyOption(PACTFLOW_HARNESS_PROTOCOL[template.harness])} 模型连接`}
        onClick={() => onChange(selected ? value.filter(id => id !== template.id) : [...value, template.id])}
        style={compatible ? selected ? selectedChoiceStyle : choiceStyle : disabledChoiceStyle}
      >{template.displayName}{compatible ? '' : '（缺少兼容模型）'}</button>
    })}
  </div>
}
