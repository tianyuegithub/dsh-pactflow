import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { PACTFLOW_ARTIFACT_OVERSIZE_CODE, PACTFLOW_CHANNEL_LIMITS } from '../artifact-store.ts'

import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PactFlowAttachment,
  PactFlowDiscussionEntry,
  PactFlowDocument,
  PactFlowNode,
  PactFlowReview,
  PactFlowRun,
  PactFlowSnapshot,
  PactFlowValidationEvidence,
} from '../types.ts'
import { nodeStateLabel, phaseLabel } from './workbench-labels.ts'

/** The attachment channel threshold, taken from the single source that defines it. */
const PACTFLOW_ATTACHMENT_MAX_BYTES = PACTFLOW_CHANNEL_LIMITS.attachment

export interface WorkbenchEvidenceViewProps {
  readonly snapshot: PactFlowSnapshot
  readonly needId: string
  readonly tab: 'progress' | 'runs' | 'delivery'
  readonly onResume: (nodeId: string, revision: number) => void
  readonly resumingNodeId: string | null
  /** artifact-ref-handoff: fetch an externalized execution log through the Host. */
  readonly onLoadArtifactLog?: (runId: string, signal?: AbortSignal) => Promise<{
    readonly uri: string; readonly summary: string; readonly bytes: number; readonly content: string
  }>
  /** need-comment-threads: durable discussion on this Need. */
  readonly onAddComment?: (body: string) => Promise<void>
  readonly onVoidComment?: (commentId: string) => Promise<void>
  /** gitea-review-gate: the closing wait state for this Need, when there is one. */
  readonly reviewGate?: {
    readonly pullRequestNumber: number
    readonly pullRequestUrl: string
    readonly missingApprovals: number
    readonly checks: readonly { readonly context: string; readonly state: string }[]
    readonly autoRecheckExhausted: boolean
    readonly externallyMerged?: boolean | undefined
  } | undefined
  readonly onRecheckReviewGate?: () => Promise<void>
  /** need-attachments: upload one attachment, and read one back verified. */
  readonly onLinkAttachment?: (input: {
    readonly fileName: string; readonly mediaType: string; readonly contentBase64: string
  }) => Promise<void>
  readonly onReadAttachment?: (attachmentId: string) => Promise<void>
  /** Absent when the project has no artifact store bound; the entry says so. */
  readonly attachmentStoreBound?: boolean
  /** node-rerun-authorization: preview and authorize re-running a succeeded node. */
  readonly onPreviewRerun?: (nodeId: string) => Promise<{
    readonly staleInputs: readonly { readonly dependency: string; readonly branch: string; readonly recorded: string; readonly latest: string }[]
    readonly unresolved: readonly string[]
    readonly refusal?: string
  }>
  readonly onRerun?: (nodeId: string, revision: number) => Promise<void>
  /** Paged history, including voided entries the live tail leaves out. */
  readonly onLoadComments?: (signal?: AbortSignal) => Promise<{
    readonly total: number
    readonly comments: readonly {
      readonly id: string; readonly author: 'human' | 'agent'
      readonly body: string; readonly createdAt: number; readonly voided: boolean
    }[]
  }>
}

const PHASES = [
  'backlog', 'discussion', 'confirmed', 'design', 'planning',
  'executing', 'code_review', 'verification', 'closing', 'deployed',
] as const

const rootStyle: CSSProperties = {
  minWidth: 0,
  color: 'var(--dsw-alias-label-primary)',
  fontSize: 14,
  lineHeight: 1.55,
}
const stackStyle: CSSProperties = { display: 'grid', gap: 12, minWidth: 0 }
const sectionStyle: CSSProperties = {
  minWidth: 0,
  padding: 14,
  border: '1px solid var(--dsw-alias-border-l2)',
  borderRadius: 12,
  background: 'var(--dsw-alias-bg-layer-2)',
}
const headingStyle: CSSProperties = { margin: '0 0 8px', fontSize: 16, lineHeight: 1.35 }
const subheadingStyle: CSSProperties = { margin: '0 0 7px', fontSize: 14, lineHeight: 1.4 }
const copyStyle: CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }
const mutedStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-secondary)',
  overflowWrap: 'anywhere',
}
const detailStyle: CSSProperties = {
  margin: 0,
  color: 'var(--dsw-alias-label-tertiary)',
  fontSize: 13,
  overflowWrap: 'anywhere',
}
const disclosureSummaryStyle: CSSProperties = {
  color: 'var(--dsw-alias-label-secondary)',
  cursor: 'pointer',
  fontSize: 13,
}
const longTextStyle: CSSProperties = { display: 'grid', gap: 5, minWidth: 0 }
const listStyle: CSSProperties = { display: 'grid', gap: 8, margin: 0, padding: 0, listStyle: 'none' }
const rowStyle: CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  justifyContent: 'space-between',
  flexWrap: 'wrap',
  gap: 8,
  minWidth: 0,
  paddingTop: 8,
  borderTop: '1px solid var(--dsw-alias-border-l2)',
}
const rowCopyStyle: CSSProperties = { display: 'grid', gap: 2, minWidth: 0, flex: '1 1 260px' }
const tableViewportStyle: CSSProperties = { maxWidth: '100%', overflowX: 'auto' }
const tableStyle: CSSProperties = {
  width: '100%',
  minWidth: 690,
  tableLayout: 'fixed',
  borderCollapse: 'collapse',
  fontSize: 13,
}
const headCellStyle: CSSProperties = {
  padding: '7px 9px',
  textAlign: 'left',
  color: 'var(--dsw-alias-label-secondary)',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
}
const cellStyle: CSSProperties = {
  padding: '9px',
  textAlign: 'left',
  verticalAlign: 'top',
  borderBottom: '1px solid var(--dsw-alias-border-l2)',
  whiteSpace: 'normal',
  overflowWrap: 'anywhere',
}
const linkStyle: CSSProperties = { color: 'var(--dsw-alias-label-primary)', overflowWrap: 'anywhere' }

function runStateLabel(value: string): string {
  return ({
    claimed: '已领取', running: '运行中', blocked: '已阻塞',
    succeeded: '已成功', failed: '已失败', cancelled: '已取消',
  } as Readonly<Record<string, string>>)[value] ?? `未知状态（${value}）`
}

function reviewKindLabel(value: PactFlowReview['kind']): string {
  return ({ requirement: '需求', design: '设计', plan: '计划', verification: '验证', code: '代码' })[value]
}

function reviewDecisionLabel(value: PactFlowReview['decision']): string {
  return ({ approved: '已批准', rejected: '已拒绝', 'changes-requested': '需要修改' })[value]
}

function reviewSourceLabel(value: PactFlowReview['source']): string {
  if (value === 'dsh-approval') return '人工'
  if (value === 'autopilot-policy') return '预授权策略'
  return '未记录'
}

function safeWebUri(value: string): boolean {
  try {
    const uri = new URL(value)
    return uri.protocol === 'http:' || uri.protocol === 'https:'
  } catch {
    return false
  }
}

function commitFor(run: PactFlowRun): string | null {
  return run.gitResult?.commit ?? run.k3sResult?.commit ?? null
}

function validationsFor(run: PactFlowRun): readonly PactFlowValidationEvidence[] {
  return run.gitResult?.validations ?? []
}

function LongText({ text, summary, style }: {
  readonly text: string
  readonly summary: string
  readonly style: CSSProperties
}) {
  if (text.length <= 180) return <p style={style}>{text}</p>
  return <div style={longTextStyle}>
    <p style={style}>{text.slice(0, 180)}…</p>
    <details>
      <summary style={disclosureSummaryStyle}>{summary}</summary>
      <div style={{ ...style, marginTop: 6, whiteSpace: 'pre-wrap' }}>{text}</div>
    </details>
  </div>
}

function Section({ title, children }: { readonly title: string; readonly children: ReactNode }) {
  return <section style={sectionStyle}>
    <h3 style={headingStyle}>{title}</h3>
    {children}
  </section>
}

function ProgressView({
  need,
  nodes,
  runs,
  onResume,
  resumingNodeId,
}: {
  readonly need: NonNullable<PactFlowSnapshot['needs']['byId'][string]>
  readonly nodes: readonly PactFlowNode[]
  readonly runs: readonly PactFlowRun[]
  readonly onResume: WorkbenchEvidenceViewProps['onResume']
  readonly resumingNodeId: string | null
}) {
  const phaseIndex = PHASES.indexOf(need.phase)
  const blocked = nodes.filter(node => node.state === 'blocked' || node.state === 'failed' || node.state === 'paused')
  const byId = new Map(nodes.map(node => [node.id as string, node]))
  const latestRunByNode = new Map<string, PactFlowRun>()
  for (const run of runs) {
    const previous = latestRunByNode.get(run.nodeId as string)
    if (previous === undefined || run.updatedAt > previous.updatedAt) latestRunByNode.set(run.nodeId as string, run)
  }

  return <div style={stackStyle}>
    <Section title="当前进展">
      <p style={copyStyle}><strong>{phaseIndex < 0 ? '阶段位置未知' : `第 ${phaseIndex + 1} / ${PHASES.length} 阶段`}</strong>：{phaseLabel(need.phase)}</p>
      <div style={{ marginTop: 7 }}>
        <LongText
          text={need.description.trim().length === 0 ? '该需求没有填写描述。' : need.description}
          summary="完整需求说明"
          style={mutedStyle}
        />
      </div>
    </Section>

    <Section title="节点状态">
      {nodes.length === 0
        ? <p style={mutedStyle}>该需求尚未创建执行节点。</p>
        : <ul style={listStyle}>{nodes.map(node => {
            const dependencies = node.dependencies.map(id => byId.get(id as string)?.title ?? id)
            return <li key={node.id} style={rowStyle}>
              <div style={rowCopyStyle}>
                <strong>{node.title}</strong>
                {nodes.length > 1
                  ? <span style={detailStyle}>{dependencies.length === 0 ? '无前置依赖' : `依赖：${dependencies.join('、')}`}</span>
                  : null}
              </div>
              <span>{nodeStateLabel(node.state)}</span>
            </li>
          })}</ul>}
    </Section>

    {blocked.length === 0
      ? <p style={mutedStyle}>当前没有阻塞、失败或暂停节点。</p>
      : <Section title="阻塞与恢复">
          <ul style={listStyle}>{blocked.map(node => {
            const latestRun = latestRunByNode.get(node.id as string)
            return <li key={node.id} style={rowStyle}>
            <div style={rowCopyStyle}>
              <strong>{node.title}</strong>
              <span style={detailStyle}>{nodeStateLabel(node.state)}</span>
              <span style={detailStyle}>最近运行：</span>
              <LongText
                text={latestRun?.outcome !== undefined && latestRun.outcome.trim().length > 0 ? latestRun.outcome : '未记录原因'}
                summary="完整运行说明"
                style={detailStyle}
              />
            </div>
            {node.state === 'paused'
              ? <Button
                  variant="outline"
                  size="sm"
                  disabled={resumingNodeId !== null}
                  onClick={() => { onResume(node.id, node.revision) }}
                >{resumingNodeId === node.id ? '恢复中…' : '恢复节点'}</Button>
              : null}
          </li>
          })}</ul>
        </Section>}
  </div>
}

function ArtifactLogCell({ run, onLoadArtifactLog }: {
  readonly run: PactFlowRun
  readonly onLoadArtifactLog: ((runId: string, signal?: AbortSignal) => Promise<{
    readonly uri: string; readonly summary: string; readonly bytes: number; readonly content: string
  }>) | undefined
}) {
  const ref = run.k3sResult?.logArtifact
  const [state, setState] = useState<{ busy: boolean; content?: string; error?: string }>({ busy: false })
  if (ref === undefined) return null
  return <details style={{ minWidth: 0 }} onKeyDown={undefined}>
    <summary style={disclosureSummaryStyle}>执行日志已外置（{String(ref.bytes)} 字节）</summary>
    <div style={longTextStyle}>
      <span style={detailStyle}>{ref.uri}</span>
      <span style={detailStyle}>摘要：{ref.summary}</span>
      <span style={detailStyle}>sha256 已绑定，读取时宿主按绑定凭据校验</span>
      {onLoadArtifactLog === undefined ? null : <Button variant="outline" size="sm" type="button"
        disabled={state.busy}
        onClick={() => {
          setState({ busy: true })
          onLoadArtifactLog(run.id)
            .then(log => setState({ busy: false, content: log.content }))
            .catch(error => setState({ busy: false, error: error instanceof Error ? error.message : String(error) }))
        }}
      >{state.busy ? '读取中…' : '读取完整日志'}</Button>}
      {state.error !== undefined ? <span style={detailStyle}>读取失败：{state.error}</span> : null}
      {state.content !== undefined ? <span style={copyStyle}>{state.content}</span> : null}
    </div>
  </details>
}

function RunsView({ nodes, runs, onLoadArtifactLog }: {
  readonly nodes: readonly PactFlowNode[]
  readonly runs: readonly PactFlowRun[]
  readonly onLoadArtifactLog?: WorkbenchEvidenceViewProps['onLoadArtifactLog']
}) {
  const byId = new Map(nodes.map(node => [node.id as string, node]))
  if (runs.length === 0) {
    return <Section title="执行记录"><p style={mutedStyle}>该需求的节点尚未产生运行记录。</p></Section>
  }
  return <Section title="执行记录">
    <div style={tableViewportStyle}>
      <table style={tableStyle}>
        <thead><tr>
          <th scope="col" style={{ ...headCellStyle, width: '25%' }}>节点</th>
          <th scope="col" style={{ ...headCellStyle, width: '14%' }}>状态</th>
          <th scope="col" style={{ ...headCellStyle, width: '10%' }}>尝试</th>
          <th scope="col" style={{ ...headCellStyle, width: '27%' }}>提交</th>
          <th scope="col" style={{ ...headCellStyle, width: '24%' }}>真实验证</th>
        </tr></thead>
        <tbody>{runs.map(run => {
          const validations = validationsFor(run)
          return <tr key={run.id}>
            <td style={cellStyle}>{byId.get(run.nodeId as string)?.title ?? run.nodeId}</td>
            <td style={cellStyle}>{runStateLabel(run.state)}</td>
            <td style={cellStyle}>{run.attempt}</td>
            <td style={cellStyle}>{commitFor(run) ?? '未记录提交'}</td>
            <td style={cellStyle}>{validations.length > 0 ? `${validations.length} 项已通过` : '缺少真实验证记录'}</td>
          </tr>
          {run.k3sResult?.logArtifact === undefined ? null : <tr key={`${run.id}-artifact`}>
            <td colSpan={5} style={cellStyle}><ArtifactLogCell run={run} onLoadArtifactLog={onLoadArtifactLog} /></td>
          </tr>}
        })}</tbody>
      </table>
    </div>
  </Section>
}

function Documents({ documents }: { readonly documents: readonly PactFlowDocument[] }) {
  if (documents.length === 0) return <p style={mutedStyle}>该需求尚未关联交付文档。</p>
  return <ul style={listStyle}>{documents.map(document => <li key={document.id} style={rowStyle}>
    <div style={rowCopyStyle}>
      <strong>{document.title}</strong>
      {safeWebUri(document.uri)
        ? <a href={document.uri} target="_blank" rel="noreferrer" style={linkStyle}>{document.uri}</a>
        : <span style={detailStyle}>{document.uri}</span>}
    </div>
  </li>)}</ul>
}

const AUTHOR_LABEL = { human: '人', agent: '执行代理' } as const

function Discussion({
  entries,
  onAddComment,
  onVoidComment,
  onLoadComments,
}: {
  readonly entries: readonly PactFlowDiscussionEntry[]
  readonly onAddComment?: WorkbenchEvidenceViewProps['onAddComment']
  readonly onVoidComment?: WorkbenchEvidenceViewProps['onVoidComment']
  readonly onLoadComments?: WorkbenchEvidenceViewProps['onLoadComments']
}) {
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [history, setHistory] = useState<Awaited<ReturnType<NonNullable<typeof onLoadComments>>> | null>(null)

  // The live tail carries excerpts of the ACTIVE comments only. Voided entries
  // are kept out of it on purpose (a model must never read a retracted note),
  // so seeing them means paging the history, which returns full bodies.
  const run = async (action: () => Promise<void>) => {
    setBusy(true); setError(null)
    try { await action(); setHistory(null) } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally { setBusy(false) }
  }

  return <Section title="讨论">
    {entries.length === 0 && history === null
      ? <p style={mutedStyle}>该需求尚无讨论。讨论随需求持久保留，换一个会话也读得到。</p>
      : <ul style={listStyle}>{(history?.comments ?? entries).map(entry => {
        const voided = 'voided' in entry && entry.voided
        const text = 'body' in entry ? entry.body : entry.excerpt
        return <li key={entry.id} style={rowStyle}>
          <div style={rowCopyStyle}>
            <span style={detailStyle}>
              {AUTHOR_LABEL[entry.author]} · {new Date(entry.createdAt).toLocaleString()}
              {voided ? ' · 已作废' : ''}
            </span>
            <span style={voided ? { ...detailStyle, textDecoration: 'line-through' } : undefined}>{text}</span>
          </div>
          {voided || onVoidComment === undefined ? null : <Button size="sm" variant="outline" disabled={busy}
            onClick={() => { void run(() => onVoidComment(entry.id)) }}>作废</Button>}
        </li>
      })}</ul>}

    {onLoadComments === undefined ? null : <Button size="sm" variant="outline" disabled={busy}
      onClick={() => {
        if (history !== null) { setHistory(null); return }
        void run(async () => { setHistory(await onLoadComments()) })
      }}>{history === null ? '查看全部（含已作废）' : '收起'}</Button>}

    {onAddComment === undefined ? null : <div style={stackStyle}>
      <textarea
        aria-label="发表讨论"
        value={draft}
        disabled={busy}
        rows={3}
        onChange={changed => { setDraft(changed.target.value) }}
        style={{ ...rowCopyStyle, resize: 'vertical', font: 'inherit' }} />
      <Button size="sm" disabled={busy || draft.trim().length === 0}
        onClick={() => { void run(async () => { await onAddComment(draft.trim()); setDraft('') }) }}>发表</Button>
    </div>}

    {error === null ? null : <p role="alert" style={mutedStyle}>{error}</p>}
  </Section>
}

const CHECK_STATE_LABEL: Readonly<Record<string, string>> = {
  pending: '未开始',
  running: '进行中',
  success: '成功',
  failure: '失败',
  unknown: '状态不明',
}

const shortCommit = (value: string) => value.slice(0, 12)

function RerunAuthorization({
  nodes,
  onPreview,
  onRerun,
}: {
  readonly nodes: readonly PactFlowNode[]
  readonly onPreview: NonNullable<WorkbenchEvidenceViewProps['onPreviewRerun']>
  readonly onRerun: NonNullable<WorkbenchEvidenceViewProps['onRerun']>
}) {
  const [selected, setSelected] = useState<string | null>(null)
  const [preview, setPreview] = useState<Awaited<ReturnType<typeof onPreview>> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const succeeded = nodes.filter(node => node.state === 'succeeded')
  if (succeeded.length === 0) return null

  const open = (nodeId: string) => {
    setSelected(nodeId); setPreview(null); setError(null); setBusy(true)
    void onPreview(nodeId)
      .then(setPreview)
      .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
      .finally(() => { setBusy(false) })
  }

  return <Section title="重跑已成功节点">
    <p style={mutedStyle}>
      上游改动后可以让已成功的节点按新输入重做。这是所有者的决定——先看清哪些依赖变了，再显式授权；
      下游只会被标记，不会自动跟着重跑。
    </p>
    <ul style={listStyle}>{succeeded.map(node => <li key={node.id} style={rowStyle}>
      <div style={rowCopyStyle}>
        <strong>{node.title}</strong>
        {(node.staleCodeInputs?.length ?? 0) > 0
          ? <span style={detailStyle}>输入已过期：{node.staleCodeInputs!.map(input => input.dependency).join('、')}</span>
          : <span style={detailStyle}>输入未发现变化</span>}
      </div>
      <Button size="sm" variant="outline" disabled={busy}
        onClick={() => { open(node.id) }}>查看重跑影响</Button>
    </li>)}</ul>

    {selected === null ? null : <div style={stackStyle}>
      {busy ? <p style={mutedStyle}>正在重新解析依赖的当前提交…</p> : null}
      {preview?.refusal !== undefined
        ? <p role="alert" style={mutedStyle}>无法重跑：{preview.refusal}</p>
        : preview === null ? null : <>
          {preview.staleInputs.length === 0
            ? <p style={mutedStyle}>依赖的提交都没有变化，重跑不会引入新的上游输入。</p>
            : <ul style={listStyle}>{preview.staleInputs.map(input => <li key={input.dependency} style={rowStyle}>
              <div style={rowCopyStyle}>
                <strong>{input.dependency}</strong>
                <span style={detailStyle}>{input.branch}</span>
                <span>{shortCommit(input.recorded)} → {shortCommit(input.latest)}</span>
              </div>
            </li>)}</ul>}
          {preview.unresolved.length === 0 ? null : <p role="alert" style={mutedStyle}>
            以下依赖的当前提交解析不出来，未按「未过期」处理：{preview.unresolved.join('、')}
          </p>}
          <Button size="sm" disabled={busy}
            onClick={() => {
              const target = nodes.find(node => node.id === selected)
              if (target === undefined) return
              setBusy(true); setError(null)
              void onRerun(target.id, target.revision)
                .then(() => { setSelected(null); setPreview(null) })
                .catch((cause: unknown) => { setError(cause instanceof Error ? cause.message : String(cause)) })
                .finally(() => { setBusy(false) })
            }}>授权重跑</Button>
        </>}
      {error === null ? null : <p role="alert" style={mutedStyle}>{error}</p>}
    </div>}
  </Section>
}

function ReviewGate({
  gate,
  onRecheck,
}: {
  readonly gate: NonNullable<WorkbenchEvidenceViewProps['reviewGate']>
  readonly onRecheck?: WorkbenchEvidenceViewProps['onRecheckReviewGate']
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Say what is being waited on and what the reader can do about it. "Not ready"
  // tells someone nothing they can act on.
  return <Section title="等待外部评审">
    {gate.externallyMerged === true
      ? <p style={mutedStyle}>
        PR #{gate.pullRequestNumber} 已在平台外被合并。宿主没有核验过这次合并，因此尚未产生交付终态；
        需要再次请求收口，由宿主核验合并提交、祖先链与任务集合后才记录交付。
      </p>
      : <p style={mutedStyle}>
        收口已创建 PR 并在等待仓库要求的批准与检查。需求仍停在收口阶段，宿主保留收口责任——
        不需要你到网页上手工合并。
      </p>}
    <ul style={listStyle}>
      <li style={rowStyle}>
        <div style={rowCopyStyle}>
          <strong>PR #{gate.pullRequestNumber}</strong>
          <a href={gate.pullRequestUrl} target="_blank" rel="noreferrer" style={linkStyle}>{gate.pullRequestUrl}</a>
        </div>
      </li>
      {gate.missingApprovals > 0 ? <li style={rowStyle}>
        <div style={rowCopyStyle}><span style={detailStyle}>批准</span><span>尚缺 {gate.missingApprovals} 个</span></div>
      </li> : null}
      {gate.checks.map(check => <li key={check.context} style={rowStyle}>
        <div style={rowCopyStyle}>
          <span style={detailStyle}>检查 {check.context}</span>
          <span>{CHECK_STATE_LABEL[check.state] ?? check.state}</span>
        </div>
      </li>)}
    </ul>
    {gate.autoRecheckExhausted
      ? <p style={mutedStyle}>自动复查次数已用完（授权和等待态都还在），可以手动复查。</p>
      : null}
    {onRecheck === undefined ? null : <Button size="sm" variant="outline" disabled={busy}
      onClick={() => {
        setBusy(true); setError(null)
        void onRecheck().catch((cause: unknown) => {
          setError(cause instanceof Error ? cause.message : String(cause))
        }).finally(() => { setBusy(false) })
      }}>{busy ? '复查中…' : '复查'}</Button>}
    {error === null ? null : <p role="alert" style={mutedStyle}>{error}</p>}
  </Section>
}

/**
 * Attachments on this Need: link one, and read one back.
 *
 * The size check happens HERE, before a single byte is sent. The contract asks
 * for a local pre-send refusal carrying an oversize code and guidance, and the
 * reason it asks is that the alternative is uploading tens of megabytes only to
 * be told no — or worse, uploading part of them. The Host refuses again on its
 * own side; this is not a substitute for that check, it is the one that saves the
 * transfer.
 *
 * With no artifact store bound the entry states that and stays disabled. There is
 * deliberately no inline fallback: an attachment that cannot be externalized is
 * not an attachment that gets stored somewhere else instead.
 */
function Attachments({ attachments, storeBound, onLink, onRead }: {
  readonly attachments: readonly PactFlowAttachment[]
  readonly storeBound?: boolean | undefined
  readonly onLink?: ((input: {
    readonly fileName: string; readonly mediaType: string; readonly contentBase64: string
  }) => Promise<void>) | undefined
  readonly onRead?: ((attachmentId: string) => Promise<void>) | undefined
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pick = async (file: File): Promise<void> => {
    setError(null)
    if (file.size > PACTFLOW_ATTACHMENT_MAX_BYTES) {
      // The same code the Host would return, stated before anything is sent.
      setError(`${PACTFLOW_ARTIFACT_OVERSIZE_CODE}：附件 ${formatBytes(file.size)} 超过 ${formatBytes(PACTFLOW_ATTACHMENT_MAX_BYTES)} 上限，未发送任何内容。请改为上传更小的文件，或把大内容放进对象存储后以地址引用。`)
      return
    }
    if (onLink === undefined) return
    setBusy(true)
    try {
      const bytes = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      for (const byte of bytes) binary += String.fromCharCode(byte)
      await onLink({
        fileName: file.name,
        mediaType: file.type === '' ? 'application/octet-stream' : file.type,
        contentBase64: btoa(binary),
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally { setBusy(false) }
  }

  return <Section title="附件">
    {storeBound === false
      ? <p style={mutedStyle}>本项目未绑定对象存储，附件入口不可用。附件内容必须外置存放，因此不会退回为内联大文本，也不会写入任何替代位置。请先在项目设置里绑定对象存储。</p>
      : <div style={{ display: 'grid', gap: 8 }}>
        <input type="file" disabled={busy || onLink === undefined}
          onChange={event => {
            const file = event.currentTarget.files?.[0]
            if (file !== undefined) void pick(file)
          }} />
        {error === null ? null : <p style={{ ...mutedStyle, color: '#b42318' }}>{error}</p>}
      </div>}
    {attachments.length === 0
      ? <p style={mutedStyle}>暂无附件。</p>
      : <ul style={{ margin: 0, paddingLeft: 18, display: 'grid', gap: 6 }}>
        {attachments.map(attachment => <li key={attachment.id}>
          <span>{attachment.fileName}</span>
          <span style={mutedStyle}>　{attachment.mediaType}　{formatBytes(attachment.ref.bytes)}</span>
          {/* The digest is shown because reading verifies against it: a mismatch
              is a refusal, not a silent substitution. */}
          <span style={mutedStyle}>　sha256 {attachment.ref.hash.slice(0, 12)}…</span>
          {onRead === undefined ? null
            : <Button size="sm" variant="ghost" onClick={() => { void onRead(attachment.id) }}>读取并校验</Button>}
        </li>)}
      </ul>}
  </Section>
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${String(bytes)} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`
}

function DeliveryView({
  reviews,
  documents,
  runs,
  releases,
}: {
  readonly reviews: readonly PactFlowReview[]
  readonly documents: readonly PactFlowDocument[]
  readonly runs: readonly PactFlowRun[]
  readonly releases: readonly PactFlowSnapshot['delivery']['releases'][string][]
}) {
  const successfulValidations = runs.flatMap(run => validationsFor(run).map(validation => ({ run, validation })))
  const failedRuns = runs.filter(run => run.state === 'failed')

  return <div style={stackStyle}>
    <Section title="评审决定">
      {reviews.length === 0
        ? <p style={mutedStyle}>该需求尚未记录评审决定。</p>
        : <ul style={listStyle}>{reviews.map(review => <li key={review.id} style={rowStyle}>
            <div style={rowCopyStyle}>
              <strong>{reviewKindLabel(review.kind)}：{reviewDecisionLabel(review.decision)}</strong>
              <span style={detailStyle}>来源：{reviewSourceLabel(review.source)}</span>
              <LongText
                text={review.note.trim().length === 0 ? '未填写说明。' : review.note}
                summary="完整评审说明"
                style={copyStyle}
              />
            </div>
          </li>)}</ul>}
    </Section>

    <Section title="验收与交付">
      <div style={stackStyle}>
        <div>
          <h4 style={subheadingStyle}>命令验证</h4>
          {successfulValidations.length === 0 && failedRuns.length === 0
            ? <p style={mutedStyle}>未记录成功的命令验证或失败运行证据。</p>
            : <ul style={listStyle}>
                {successfulValidations.map(({ run, validation }, index) => <li key={`${run.id}-${index}`} style={rowStyle}>
                  <div style={rowCopyStyle}>
                    <strong>成功：{[validation.command, ...validation.args].join(' ')}</strong>
                    <span style={detailStyle}>运行 {run.id}；退出码 0；用时 {validation.durationMs} 毫秒</span>
                  </div>
                </li>)}
                {failedRuns.map(run => <li key={run.id} style={rowStyle}>
                  <div style={rowCopyStyle}>
                    <strong>失败：{run.id}</strong>
                    <LongText
                      text={run.outcome !== undefined && run.outcome.trim().length > 0 ? run.outcome : '运行失败，未记录结果说明。'}
                      summary="完整运行说明"
                      style={detailStyle}
                    />
                  </div>
                </li>)}
              </ul>}
        </div>
        <div>
          <h4 style={subheadingStyle}>交付文档</h4>
          <Documents documents={documents} />
        </div>
        <div>
          <h4 style={subheadingStyle}>代码交付 / 宿主交付记录</h4>
          {releases.length === 0
            ? <p style={mutedStyle}>没有宿主交付记录；当前阶段不代表代码已交付或应用已部署。</p>
            : <ul style={listStyle}>{releases.map((release, index) => <li key={`${release.needId}-${release.recordedAt}-${index}`} style={rowStyle}>
                <div style={rowCopyStyle}>
                  <strong>提交：{release.commit}</strong>
                  <span style={detailStyle}>分支：{release.branch}</span>
                </div>
              </li>)}</ul>}
          {releases.length > 0 ? <p style={{ ...mutedStyle, marginTop: 7 }}>宿主交付记录仅证明代码交付，不代表应用已部署。</p> : null}
        </div>
      </div>
    </Section>
  </div>
}

export function WorkbenchEvidenceView({
  snapshot,
  needId,
  tab,
  onResume,
  resumingNodeId, onLoadArtifactLog, onAddComment, onVoidComment, onLoadComments,
  reviewGate, onRecheckReviewGate, onPreviewRerun, onRerun,
  onLinkAttachment, onReadAttachment, attachmentStoreBound }: WorkbenchEvidenceViewProps) {
  const need = snapshot.needs.byId[needId]
  if (need === undefined) {
    return <div style={rootStyle}><Section title="需求内容"><p style={mutedStyle}>所选需求已不在当前会话快照中，请重新选择需求。</p></Section></div>
  }

  const nodes = Object.values(snapshot.dag.byId).filter(node => node.needId === needId)
  const nodeIds = new Set(nodes.map(node => node.id as string))
  const runs = Object.values(snapshot.runs.byId).filter(run => nodeIds.has(run.nodeId as string))
  const reviews = Object.values(snapshot.delivery.reviews).filter(review => review.needId === needId)
  const documents = Object.values(snapshot.delivery.documents).filter(document => document.needId === needId)
  const releases = Object.values(snapshot.delivery.releases).filter(release => release.needId === needId)
  const attachments = Object.values(snapshot.delivery.attachments ?? {}).filter(attachment => attachment.needId === needId)

  return <div style={rootStyle}>
    {tab === 'progress'
      ? <><ProgressView need={need} nodes={nodes} runs={runs} onResume={onResume} resumingNodeId={resumingNodeId} />
        {onPreviewRerun === undefined || onRerun === undefined ? null
          : <RerunAuthorization nodes={nodes} onPreview={onPreviewRerun} onRerun={onRerun} />}
        <Discussion entries={snapshot.discussion?.recent[needId] ?? []}
          onAddComment={onAddComment} onVoidComment={onVoidComment} onLoadComments={onLoadComments} /></>
      : tab === 'runs'
        ? <RunsView nodes={nodes} runs={runs} onLoadArtifactLog={onLoadArtifactLog} />
        : <>{reviewGate === undefined ? null : <ReviewGate gate={reviewGate} onRecheck={onRecheckReviewGate} />}
          <DeliveryView reviews={reviews} documents={documents} runs={runs} releases={releases} />
          <Attachments attachments={attachments} storeBound={attachmentStoreBound}
            onLink={onLinkAttachment} onRead={onReadAttachment} /></>}
  </div>
}
