import { useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  PactFlowAutopilotPreview,
  PactFlowAutopilotRecord,
  PactFlowStartAutopilotRequest,
} from '../types.ts'
import {
  cardStyle,
  errorTextStyle,
  hintStyle,
  inputStyle,
  sectionTitleStyle,
} from './styles.ts'

export interface PactFlowAutopilotControlsProps {
  readonly sessionId: string
  readonly hideNeedSelector?: boolean
  readonly needs: readonly {
    readonly id: string
    readonly title: string
    readonly description: string
    readonly revision: number
    readonly phase: string
  }[]
  readonly records: Readonly<Record<string, PactFlowAutopilotRecord>>
  readonly preview: (needId: string) => Promise<PactFlowAutopilotPreview>
  readonly start: (request: PactFlowStartAutopilotRequest) => Promise<PactFlowAutopilotRecord>
  readonly control: (
    needId: string,
    expectedRevision: number,
    action: 'pause' | 'resume' | 'stop',
  ) => Promise<PactFlowAutopilotRecord>
}

const DEFAULT_DURATION_HOURS = '4'
const DEFAULT_MODEL_STEPS = '60'
const DEFAULT_WORKER_STARTS = '10'
const DEFAULT_CONCURRENCY = '1'

const sectionStyle: CSSProperties = {
  ...cardStyle,
  display: 'grid',
  gap: 14,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
}
const fieldGridStyle: CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 150px), 1fr))',
  gap: 12,
}
const fieldStyle: CSSProperties = { display: 'grid', gap: 6, fontSize: 13 }
const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const detailListStyle: CSSProperties = { display: 'grid', gap: 6, margin: 0, paddingLeft: 20 }
const compactTextStyle: CSSProperties = { margin: 0, overflowWrap: 'anywhere' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function executionLabel(option: PactFlowAutopilotPreview['executionOptions'][number]): string {
  if (option.kind === 'git') return `代码仓库执行 · 提供方：${option.provider}`
  const details = [
    `模板：${option.templateId}`,
    option.agentProfileId === undefined ? undefined : `代理配置：${option.agentProfileId}`,
    option.modelConnectionId === undefined ? undefined : `模型连接：${option.modelConnectionId}`,
    option.workerPoolId === undefined ? undefined : `执行池：${option.workerPoolId}`,
  ].filter((value): value is string => value !== undefined)
  return `K3s（容器执行） · ${details.join(' · ')}`
}

function stateLabel(state: PactFlowAutopilotRecord['state']): string {
  switch (state) {
    case 'running': return '运行中'
    case 'paused': return '已暂停'
    case 'blocked': return '已阻塞'
    case 'stopped': return '已停止'
    case 'completed': return '已完成'
  }
}

export function PactFlowAutopilotControls({
  sessionId,
  hideNeedSelector = false,
  needs,
  records,
  preview,
  start,
  control,
}: PactFlowAutopilotControlsProps) {
  const [storedNeedId, setStoredNeedId] = useState(needs[0]?.id ?? '')
  const selectedNeedId = needs.some(need => need.id === storedNeedId) ? storedNeedId : (needs[0]?.id ?? '')
  const selectedNeed = needs.find(need => need.id === selectedNeedId)
  const [preparedState, setPreparedState] = useState<{
    readonly key: string
    readonly preview: PactFlowAutopilotPreview
  } | null>(null)
  const [localRecord, setLocalRecord] = useState<{ readonly key: string; readonly record: PactFlowAutopilotRecord } | null>(null)
  const [durationHours, setDurationHours] = useState(DEFAULT_DURATION_HOURS)
  const [modelSteps, setModelSteps] = useState(DEFAULT_MODEL_STEPS)
  const [workerStarts, setWorkerStarts] = useState(DEFAULT_WORKER_STARTS)
  const [concurrency, setConcurrency] = useState(DEFAULT_CONCURRENCY)
  const [pendingKey, setPendingKey] = useState<string | null>(null)
  const [errorState, setErrorState] = useState<{ readonly key: string; readonly text: string } | null>(null)
  const operationSequence = useRef(0)

  const selectedKey = `${sessionId}\u0000${selectedNeedId}\u0000${selectedNeed?.revision ?? ''}`
  const selectedKeyRef = useRef(selectedKey)
  selectedKeyRef.current = selectedKey
  const pending = pendingKey === selectedKey
  const preparedPreview = preparedState?.key === selectedKey ? preparedState.preview : null
  const error = errorState?.key === selectedKey ? errorState.text : null
  const projectedRecord = selectedNeedId === '' ? undefined : records[selectedNeedId]
  const immediateRecord = localRecord?.key === selectedKey ? localRecord.record : undefined
  const record = immediateRecord !== undefined
    && (projectedRecord === undefined
      || immediateRecord.revision > projectedRecord.revision
      || (immediateRecord.revision === projectedRecord.revision && immediateRecord.updatedAt >= projectedRecord.updatedAt))
    ? immediateRecord
    : projectedRecord

  const parsedDurationHours = Number(durationHours)
  const parsedModelSteps = Number(modelSteps)
  const parsedWorkerStarts = Number(workerStarts)
  const parsedConcurrency = Number(concurrency)
  const limitsValid = Number.isFinite(parsedDurationHours)
    && parsedDurationHours >= 1 / 60
    && parsedDurationHours <= 24
    && Number.isInteger(parsedModelSteps)
    && parsedModelSteps >= 1
    && parsedModelSteps <= 1000
    && Number.isInteger(parsedWorkerStarts)
    && parsedWorkerStarts >= 1
    && parsedWorkerStarts <= 100
    && Number.isInteger(parsedConcurrency)
    && parsedConcurrency >= 1
    && parsedConcurrency <= 12

  function selectNeed(needId: string): void {
    operationSequence.current += 1
    setStoredNeedId(needId)
    setPreparedState(null)
    setLocalRecord(null)
    setPendingKey(null)
    setErrorState(null)
  }

  async function prepare(): Promise<void> {
    if (pending || selectedNeedId === '') return
    const requestKey = selectedKey
    const requestedNeedId = selectedNeedId
    const requestedNeedRevision = selectedNeed?.revision
    const requestSequence = operationSequence.current + 1
    operationSequence.current = requestSequence
    setPendingKey(requestKey)
    setPreparedState(null)
    setErrorState(null)
    try {
      const result = await preview(requestedNeedId)
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      if (requestedNeedRevision === undefined
        || result.needId !== requestedNeedId
        || result.needRevision !== requestedNeedRevision) {
        setErrorState({ key: requestKey, text: '挂机预览与当前需求不匹配，请刷新后重试' })
        return
      }
      setPreparedState({ key: requestKey, preview: result })
    } catch (caught) {
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      setErrorState({ key: requestKey, text: errorMessage(caught) })
    } finally {
      if (operationSequence.current === requestSequence) {
        setPendingKey(current => current === requestKey ? null : current)
      }
    }
  }

  async function authorize(): Promise<void> {
    if (pending || preparedPreview === null || !limitsValid || preparedPreview.executionOptions.length === 0) return
    const requestKey = selectedKey
    if (selectedNeed === undefined
      || preparedPreview.needId !== selectedNeed.id
      || preparedPreview.needRevision !== selectedNeed.revision) {
      setPreparedState(null)
      setErrorState({ key: requestKey, text: '挂机预览已不属于当前需求，请重新准备授权' })
      return
    }
    const requestSequence = operationSequence.current + 1
    operationSequence.current = requestSequence
    setPendingKey(requestKey)
    setErrorState(null)
    try {
      const result = await start({
        needId: preparedPreview.needId,
        expectedNeedRevision: preparedPreview.needRevision,
        expectedScopeDigest: preparedPreview.scopeDigest,
        limits: {
          maxDurationMs: Math.round(parsedDurationHours * 3_600_000),
          maxModelSteps: parsedModelSteps,
          maxWorkerStarts: parsedWorkerStarts,
          maxConcurrency: parsedConcurrency,
          maxStalledTurns: 3,
        },
        confirm: 'start-scoped-autopilot',
      })
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      setLocalRecord({ key: requestKey, record: result })
      setPreparedState(null)
    } catch (caught) {
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      setErrorState({ key: requestKey, text: errorMessage(caught) })
    } finally {
      if (operationSequence.current === requestSequence) {
        setPendingKey(current => current === requestKey ? null : current)
      }
    }
  }

  async function applyControl(action: 'pause' | 'resume' | 'stop'): Promise<void> {
    if (pending || record === undefined) return
    const requestKey = selectedKey
    const requestSequence = operationSequence.current + 1
    operationSequence.current = requestSequence
    setPendingKey(requestKey)
    setErrorState(null)
    try {
      const result = await control(record.needId, record.revision, action)
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      setLocalRecord({ key: requestKey, record: result })
    } catch (caught) {
      if (operationSequence.current !== requestSequence || selectedKeyRef.current !== requestKey) return
      setErrorState({ key: requestKey, text: errorMessage(caught) })
    } finally {
      if (operationSequence.current === requestSequence) {
        setPendingKey(current => current === requestKey ? null : current)
      }
    }
  }

  const canPrepare = record === undefined || record.state === 'completed' || record.state === 'stopped'

  if (needs.length === 0) {
    return <section aria-label="按需求挂机控制" style={sectionStyle}>
      <p style={compactTextStyle}>暂无可挂机需求，请先创建或选择需求。</p>
    </section>
  }

  return <section aria-label="按需求挂机控制" style={sectionStyle}>
    <div>
      <h3 style={sectionTitleStyle}>按需求挂机</h3>
      <p style={hintStyle}>挂机终点是已验证的代码合并，不包含部署，也不会改变文件权限或全局授权。</p>
    </div>

    {!hideNeedSelector && <label style={fieldStyle}>
      <span>选择需求</span>
      <select
        value={selectedNeedId}
        onChange={event => { selectNeed(event.currentTarget.value) }}
        disabled={pending || needs.length === 0}
        style={inputStyle}
      >
        {needs.length === 0 && <option value="">暂无可用需求</option>}
        {needs.map(need => <option key={need.id} value={need.id}>{need.title} · {need.phase}</option>)}
      </select>
    </label>}

    {selectedNeed !== undefined && <div>
      <strong>{selectedNeed.title}</strong>
      <p style={compactTextStyle}>{selectedNeed.description}</p>
      <small>需求修订：{selectedNeed.revision}</small>
    </div>}

    {record !== undefined && <div style={sectionStyle} aria-label="挂机状态">
      <strong>状态：{stateLabel(record.state)}</strong>
      <div style={fieldGridStyle}>
        <span>编排模型调用：{record.modelSteps} / {record.limits.maxModelSteps}</span>
        <span>唤醒次数：{record.wakeCount}</span>
      </div>
      <p style={compactTextStyle}>原因：{record.reason}</p>
      <div style={actionsStyle}>
        {record.state === 'running' && <Button
          variant="outline"
          disabled={pending}
          onClick={() => { void applyControl('pause') }}
        >暂停后续推进</Button>}
        {(record.state === 'paused' || record.state === 'blocked') && <Button
          variant="primary"
          disabled={pending}
          onClick={() => { void applyControl('resume') }}
        >恢复挂机</Button>}
        {(record.state === 'running' || record.state === 'paused' || record.state === 'blocked') && <Button
          variant="outline"
          disabled={pending}
          onClick={() => { void applyControl('stop') }}
        >停止并转人工</Button>}
      </div>
    </div>}

    {canPrepare && <>
      <p style={compactTextStyle}>推荐额度：4 小时 · 编排模型调用 60 次 · 执行 10 次 · 最大并发 1</p>
      <details>
        <summary>调整预算</summary>
        <div style={{ ...fieldGridStyle, marginTop: 12 }}>
          <label style={fieldStyle}>时长（小时，最多 24 小时）
            <Input type="number" min={1 / 60} max={24} step="any" value={durationHours}
              onChange={event => { setDurationHours(event.currentTarget.value) }} disabled={pending} />
          </label>
          <label style={fieldStyle}>编排模型调用次数（1—1000）
            <Input type="number" min={1} max={1000} step={1} value={modelSteps}
              onChange={event => { setModelSteps(event.currentTarget.value) }} disabled={pending} />
          </label>
          <label style={fieldStyle}>执行次数（1—100）
            <Input type="number" min={1} max={100} step={1} value={workerStarts}
              onChange={event => { setWorkerStarts(event.currentTarget.value) }} disabled={pending} />
          </label>
          <label style={fieldStyle}>最大并发（1—12）
            <Input type="number" min={1} max={12} step={1} value={concurrency}
              onChange={event => { setConcurrency(event.currentTarget.value) }} disabled={pending} />
          </label>
        </div>
      </details>
      <p style={hintStyle}>连续 3 轮没有有效进展时自动阻塞，等待人工处理。</p>
      {!limitsValid && <p role="alert" style={errorTextStyle}>请按标注范围填写有效预算。</p>}
      <div style={actionsStyle}>
        <Button variant="outline" disabled={pending || selectedNeedId === ''}
          onClick={() => { void prepare() }}>{pending
            ? '处理中…'
            : record?.state === 'completed' || record?.state === 'stopped' ? '准备新授权' : '准备挂机'}</Button>
      </div>
    </>}

    {preparedPreview !== null && <div style={sectionStyle} aria-label="挂机授权预览">
      <div>
        <strong>{preparedPreview.title}</strong>
        <p style={compactTextStyle}>{preparedPreview.description}</p>
      </div>
      <p style={compactTextStyle}>仓库：{preparedPreview.repository}</p>
      <p style={compactTextStyle}>目标分支：{preparedPreview.branch}</p>
      <p style={compactTextStyle}>授权范围摘要：{preparedPreview.scopeDigest}</p>
      <div>
        <strong>本次预算</strong>
        <ul style={detailListStyle}>
          <li>时长：{durationHours} 小时</li>
          <li>编排模型调用：{modelSteps} 次</li>
          <li>执行：{workerStarts} 次</li>
          <li>最大并发：{concurrency}</li>
        </ul>
      </div>
      <div>
        <strong>可用执行资源</strong>
        {preparedPreview.executionOptions.length === 0
          ? <p role="alert" style={errorTextStyle}>没有可用执行资源，不能开启挂机。</p>
          : <ul style={detailListStyle}>{preparedPreview.executionOptions.map((option, index) => <li
            key={`${option.kind}-${String(index)}`}
          >{executionLabel(option)}</li>)}</ul>}
      </div>
      <div>
        <strong>验证约束</strong>
        {preparedPreview.validationProfiles.length === 0
          ? <p style={hintStyle}>未配置验证方案</p>
          : <ul style={detailListStyle}>{preparedPreview.validationProfiles.map(profile => <li key={profile}>{profile}</li>)}</ul>}
      </div>
      <p style={hintStyle}>本次授权只适用于当前需求及以上范围摘要，不会授予完整访问权限或自动部署。</p>
      <Button variant="primary"
        disabled={pending || !limitsValid || preparedPreview.executionOptions.length === 0}
        onClick={() => { void authorize() }}>{pending ? '正在授权…' : '授权并开始挂机'}</Button>
    </div>}

    {error !== null && <p role="alert" style={errorTextStyle}>{error}</p>}
  </section>
}
