import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type {
  AnswerWorkerInteractionRequest,
  WorkerInteractionAnswer,
  WorkerInteractionRecord,
  WorkerQuestion,
  WorkerQuestionAnswer,
} from '../worker-interaction-types.ts'
import {
  cardStyle,
  errorTextStyle,
  hintStyle,
  noticeStyle,
  sectionTitleStyle,
} from './styles.ts'

export interface WorkerInteractionsProps {
  readonly sessionId: string
  readonly title?: string
  readonly showEmpty?: boolean
  readonly records: Readonly<Record<string, WorkerInteractionRecord>>
  readonly answer: (request: AnswerWorkerInteractionRequest) => Promise<WorkerInteractionRecord>
}

type QuestionDraft = Readonly<Record<string, { readonly selected: readonly string[]; readonly custom: string }>>

const listStyle: CSSProperties = { display: 'grid', gap: 12, color: 'var(--dsw-alias-label-primary)' }
const interactionStyle: CSSProperties = {
  ...cardStyle,
  display: 'grid',
  gap: 12,
  border: '1px solid var(--dsw-alias-border-l2)',
  background: 'var(--dsw-alias-bg-layer-3)',
  color: 'var(--dsw-alias-label-primary)',
}
const compactTextStyle: CSSProperties = { margin: 0, overflowWrap: 'anywhere', whiteSpace: 'pre-wrap' }
const sourceStyle: CSSProperties = {
  display: 'flex', flexWrap: 'wrap', gap: '6px 16px', fontSize: 12,
  color: 'var(--dsw-alias-label-tertiary)',
}
const questionStyle: CSSProperties = {
  display: 'grid', gap: 8, minWidth: 0, margin: 0, padding: 12,
  border: '1px solid var(--dsw-alias-border-l2)', borderRadius: 8,
}
const optionStyle: CSSProperties = { display: 'flex', alignItems: 'flex-start', gap: 8, color: 'var(--dsw-alias-label-primary)' }
const fieldStyle: CSSProperties = { display: 'grid', gap: 6 }
const actionsStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 }
const nativeChoiceStyle: CSSProperties = { accentColor: 'var(--dsw-alias-brand-primary)' }

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function initialDraft(questions: readonly WorkerQuestion[]): QuestionDraft {
  return Object.fromEntries(questions.map(question => [question.id, { selected: [], custom: '' }]))
}

function settledMessage(record: WorkerInteractionRecord): string {
  switch (record.state) {
    case 'pending': return '等待确认'
    case 'answered': return '答案已保存，等待执行器收讫'
    case 'delivered': return '已送达'
    case 'cancelled': return `已取消${record.reason.length === 0 ? '' : `：${record.reason}`}`
    case 'expired': return `已过期${record.reason.length === 0 ? '' : `：${record.reason}`}`
  }
}

function QuestionEditor({
  question,
  groupName,
  draft,
  disabled,
  onChange,
}: {
  readonly question: WorkerQuestion
  readonly groupName: string
  readonly draft: { readonly selected: readonly string[]; readonly custom: string }
  readonly disabled: boolean
  readonly onChange: (draft: { readonly selected: readonly string[]; readonly custom: string }) => void
}) {
  const options = question.options ?? []
  return <fieldset style={questionStyle} disabled={disabled}>
    <legend>{question.header ?? question.question}</legend>
    {question.header !== undefined && <p style={compactTextStyle}>{question.question}</p>}
    {question.detail !== undefined && <p style={hintStyle}>{question.detail}</p>}
    {options.map(option => {
        const checked = draft.selected.includes(option.label)
        return <label key={option.label} style={optionStyle}>
          <input
            type={question.multiSelect === true ? 'checkbox' : 'radio'}
            name={question.multiSelect === true ? undefined : groupName}
            checked={checked}
            style={nativeChoiceStyle}
            onChange={event => {
              if (question.multiSelect === true) {
                const selected = event.currentTarget.checked
                  ? [...draft.selected, option.label]
                  : draft.selected.filter(label => label !== option.label)
                onChange({ selected, custom: draft.custom })
              } else {
                onChange({ selected: [option.label], custom: draft.custom })
              }
            }}
          />
          <span>
            <span>{option.label}</span>
            {option.description !== undefined && <small style={{ display: 'block', opacity: 0.72 }}>{option.description}</small>}
          </span>
        </label>
      })}
    {question.allowCustom !== false && <label style={fieldStyle}>
      <span>{options.length === 0 ? '回答' : '其它补充'}</span>
      <Input
        aria-label={`${question.question}的自由文本回答`}
        value={draft.custom}
        onChange={event => { onChange({ selected: draft.selected, custom: event.currentTarget.value }) }}
      />
    </label>}
    {options.length === 0 && question.allowCustom === false
      && <p role="alert" style={errorTextStyle}>此问题没有可用选项。</p>}
  </fieldset>
}

function InteractionCard({
  sessionId,
  record,
  answer,
}: {
  readonly sessionId: string
  readonly record: WorkerInteractionRecord
  readonly answer: WorkerInteractionsProps['answer']
}) {
  const questions = record.request.questions ?? []
  const [draft, setDraft] = useState<QuestionDraft>(() => initialDraft(questions))
  const [localRecord, setLocalRecord] = useState<WorkerInteractionRecord | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [clockNow, setClockNow] = useState(() => Date.now())
  const active = useRef(true)
  const interactionKey = `${sessionId}\u0000${record.id}\u0000${record.revision}\u0000${record.digest}`

  useEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [interactionKey])

  const shownRecord = localRecord !== null
    && (localRecord.revision > record.revision
      || (localRecord.revision === record.revision && localRecord.updatedAt >= record.updatedAt))
    ? localRecord
    : record
  const isPending = shownRecord.state === 'pending'
  const isExpired = isPending && clockNow >= shownRecord.expiresAt
  const isActionable = isPending && !isExpired

  useEffect(() => {
    const now = Date.now()
    setClockNow(now)
    if (shownRecord.state !== 'pending' || now >= shownRecord.expiresAt) return
    const timer = setTimeout(() => { setClockNow(Date.now()) }, shownRecord.expiresAt - now + 1)
    return () => { clearTimeout(timer) }
  }, [interactionKey, shownRecord.state, shownRecord.expiresAt])

  const questionAnswers: WorkerQuestionAnswer[] = questions.map(question => ({
    id: question.id,
    selected: [...(draft[question.id]?.selected ?? [])],
    ...(question.allowCustom !== false && (draft[question.id]?.custom.trim().length ?? 0) > 0
      ? { custom: draft[question.id]!.custom.trim() }
      : {}),
  }))
  const questionsComplete = questions.length > 0 && questions.every(question => {
    const value = draft[question.id]
    return (value?.selected.length ?? 0) > 0
      || (question.allowCustom !== false && (value?.custom.trim().length ?? 0) > 0)
  })

  async function submit(interactionAnswer: WorkerInteractionAnswer): Promise<void> {
    if (!isActionable || submitting) return
    const submittedAt = Date.now()
    if (submittedAt >= shownRecord.expiresAt) {
      setClockNow(submittedAt)
      setError('该确认已过期，请刷新状态')
      return
    }
    const submittedRecord = shownRecord
    setSubmitting(true)
    setError(null)
    try {
      const result = await answer({
        id: submittedRecord.id,
        expectedRevision: submittedRecord.revision,
        expectedDigest: submittedRecord.digest,
        answer: interactionAnswer,
      })
      if (!active.current) return
      if (result.id !== submittedRecord.id || result.sessionId !== sessionId) {
        setError('返回的确认记录与当前会话不匹配')
        return
      }
      setLocalRecord(result)
    } catch (caught) {
      if (active.current) setError(errorMessage(caught))
    } finally {
      if (active.current) setSubmitting(false)
    }
  }

  return <article style={interactionStyle}>
    <div>
      <strong>{shownRecord.request.title}</strong>
      <p style={compactTextStyle}>{shownRecord.request.detail}</p>
    </div>
    <div style={sourceStyle}>
      <span>需求：{shownRecord.needId}</span>
      <span>执行：{shownRecord.runId}</span>
      {shownRecord.request.toolName !== undefined && <span>工具：{shownRecord.request.toolName}</span>}
    </div>

    {!isPending && <p style={noticeStyle}>{settledMessage(shownRecord)}</p>}
    {isExpired && <p role="status" style={noticeStyle}>已过期：等待人工处理已达到期限</p>}

    {isActionable && <p style={hintStyle}>请勿在回答中填写密码或密钥；需要时提供已配置的凭证引用。</p>}

    {isPending && shownRecord.request.kind === 'approval' && <div style={actionsStyle}>
      <Button variant="primary" disabled={submitting || isExpired}
        onClick={() => { void submit({ decision: 'approve' }) }}>批准</Button>
      <Button variant="outline" disabled={submitting || isExpired}
        onClick={() => { void submit({ decision: 'reject' }) }}>拒绝</Button>
    </div>}

    {isPending && shownRecord.request.kind === 'question' && <>
      {questions.length === 0
        ? <p role="alert" style={errorTextStyle}>请求中没有可回答的问题。</p>
        : questions.map(question => <QuestionEditor
          key={question.id}
          question={question}
          groupName={`${record.id}-${question.id}`}
          draft={draft[question.id] ?? { selected: [], custom: '' }}
          disabled={submitting || isExpired}
          onChange={value => { setDraft(current => ({ ...current, [question.id]: value })) }}
        />)}
      <Button variant="primary" disabled={submitting || isExpired || !questionsComplete}
        onClick={() => { void submit({ answers: questionAnswers }) }}>提交答案</Button>
    </>}

    {submitting && <p style={hintStyle}>正在提交…</p>}
    {error !== null && <p role="alert" style={errorTextStyle}>提交失败：{error}。请重试。</p>}
  </article>
}

export function WorkerInteractions({
  sessionId,
  title = '执行代理待确认',
  showEmpty = true,
  records,
  answer,
}: WorkerInteractionsProps) {
  const visibleRecords = Object.values(records)
    .filter(record => record.sessionId === sessionId)
    .sort((left, right) => {
      const pendingOrder = Number(right.state === 'pending') - Number(left.state === 'pending')
      return pendingOrder === 0 ? right.updatedAt - left.updatedAt : pendingOrder
    })

  if (visibleRecords.length === 0 && !showEmpty) return null

  return <section aria-label={title} style={listStyle}>
    <h3 style={sectionTitleStyle}>{title}</h3>
    {visibleRecords.length === 0
      ? <p style={hintStyle}>无待确认事项</p>
      : visibleRecords.map(record => <InteractionCard
        key={`${sessionId}-${record.id}-${record.revision}-${record.digest}`}
        sessionId={sessionId}
        record={record}
        answer={answer}
      />)}
  </section>
}
