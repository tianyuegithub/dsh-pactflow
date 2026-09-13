import { Button } from '@deepseek-ai/dsh-client-ui-primitives'
import { useState } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import type {
  PactFlowDocument,
  PactFlowNode,
  PactFlowReview,
  PactFlowRun,
  PactFlowSnapshot,
  PactFlowValidationEvidence,
} from '../types.ts'
import { nodeStateLabel, phaseLabel } from './workbench-labels.ts'

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
  resumingNodeId, onLoadArtifactLog }: WorkbenchEvidenceViewProps) {
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

  return <div style={rootStyle}>
    {tab === 'progress'
      ? <ProgressView need={need} nodes={nodes} runs={runs} onResume={onResume} resumingNodeId={resumingNodeId} />
      : tab === 'runs'
        ? <RunsView nodes={nodes} runs={runs} onLoadArtifactLog={onLoadArtifactLog} />
        : <DeliveryView reviews={reviews} documents={documents} runs={runs} releases={releases} />}
  </div>
}
