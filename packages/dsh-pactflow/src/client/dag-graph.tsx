import { useEffect, useId, useMemo, useRef, useState } from 'react'
import type { CSSProperties, KeyboardEvent } from 'react'
import type { PactFlowNode } from '../types.ts'
import {
  buildPactFlowDagLayout,
  pactFlowDagStateCopy,
  type PactFlowDagLayoutEdge,
  type PactFlowDagLayoutNode,
} from './dag-graph-model.ts'

interface PactFlowDagGraphProps {
  readonly nodes: readonly PactFlowNode[]
  readonly empty: string
}

type Selection =
  | { readonly kind: 'node'; readonly id: string }
  | { readonly kind: 'edge'; readonly id: string }
  | null

const stageNames = ['第一阶段', '第二阶段', '第三阶段', '第四阶段', '第五阶段', '第六阶段'] as const

export function PactFlowDagGraph({ nodes, empty }: PactFlowDagGraphProps) {
  const graphRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(760)
  const [selection, setSelection] = useState<Selection>(null)
  const [hoveredEdgeId, setHoveredEdgeId] = useState<string | null>(null)
  const markerPrefix = useId().replace(/:/gu, '')

  useEffect(() => {
    const element = graphRef.current
    if (element === null) return
    const measure = () => {
      const nextWidth = Math.round(element.getBoundingClientRect().width)
      if (nextWidth > 0) setWidth(current => current === nextWidth ? current : nextWidth)
    }
    measure()
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', measure)
      return () => { window.removeEventListener('resize', measure) }
    }
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => { observer.disconnect() }
  }, [])

  const layout = useMemo(() => buildPactFlowDagLayout(nodes, width), [nodes, width])
  const layoutById = useMemo(
    () => new Map(layout.nodes.map(node => [String(node.source.id), node])),
    [layout.nodes],
  )
  const selectedNodeId = selection?.kind === 'node' ? selection.id : null
  const selectedEdgeId = selection?.kind === 'edge' ? selection.id : null
  const directEdgeCount = nodes.reduce((sum, node) => sum + node.dependencies.length, 0)
  const foldedEdgeCount = Math.max(0, directEdgeCount - layout.edges.length)
  const relatedNodeIds = useMemo(() => {
    if (selectedNodeId === null) return new Set<string>()
    const related = new Set<string>([selectedNodeId])
    for (const edge of layout.edges) {
      if (edge.sourceId === selectedNodeId) related.add(edge.targetId)
      if (edge.targetId === selectedNodeId) related.add(edge.sourceId)
    }
    return related
  }, [layout.edges, selectedNodeId])

  return (
    <section style={sectionStyle} aria-labelledby="pactflow-dag-title">
      <header style={headerStyle}>
        <div>
          <h2 id="pactflow-dag-title" style={titleStyle}>任务推进图</h2>
          <p style={subtitleStyle}>从上到下依次推进；同一阶段可以并行处理。</p>
          {foldedEdgeCount > 0 ? (
            <p style={foldedHintStyle}>已合并 {String(foldedEdgeCount)} 条可由路径推导的重复连线；完整约束可在节点明细中查看。</p>
          ) : null}
        </div>
        <div style={legendStyle} aria-label="状态说明">
          <LegendDot color="#35c878" label="已完成" />
          <LegendDot color="#55a7ff" label="进行中" />
          <LegendDot color="#ef5f67" label="失败" />
        </div>
      </header>

      {nodes.length === 0 ? <p>{empty}</p> : (
        <>
          <div ref={graphRef} style={graphViewportStyle}>
            <svg
              width="100%"
              height={Math.ceil(layout.height * Math.min(1, width / layout.width))}
              viewBox={`0 0 ${String(layout.width)} ${String(layout.height)}`}
              preserveAspectRatio="xMidYMin meet"
              role="group"
              aria-label={`任务推进图，共 ${String(nodes.length)} 个阶段。点击阶段或连线可查看说明。`}
              style={svgStyle}
              onClick={(event) => {
                if (event.target === event.currentTarget) setSelection(null)
              }}
            >
              <defs>
                <marker id={`${markerPrefix}-arrow`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#66807c" />
                </marker>
                <marker id={`${markerPrefix}-arrow-active`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#62dcc8" />
                </marker>
              </defs>

              {layout.edges.map(edge => {
                const active = isEdgeActive(edge, selectedNodeId, selectedEdgeId, hoveredEdgeId)
                return (
                  <g key={edge.id}>
                    <path
                      d={edge.path}
                      fill="none"
                      stroke={active ? '#62dcc8' : '#66807c'}
                      strokeWidth={active ? 3 : 1.7}
                      opacity={active ? 1 : 0.72}
                      markerEnd={`url(#${markerPrefix}-${active ? 'arrow-active' : 'arrow'})`}
                      vectorEffect="non-scaling-stroke"
                      style={{ transition: 'stroke 160ms ease, opacity 160ms ease' }}
                    />
                    <path
                      d={edge.path}
                      fill="none"
                      stroke="transparent"
                      strokeWidth="18"
                      pointerEvents="stroke"
                      role="button"
                      tabIndex={0}
                      aria-label={edgeAriaLabel(edge, layoutById)}
                      style={{ cursor: 'pointer', outline: 'none' }}
                      onPointerEnter={() => { setHoveredEdgeId(edge.id) }}
                      onPointerLeave={() => { setHoveredEdgeId(null) }}
                      onFocus={() => { setHoveredEdgeId(edge.id) }}
                      onBlur={() => { setHoveredEdgeId(null) }}
                      onClick={(event) => {
                        event.stopPropagation()
                        setSelection({ kind: 'edge', id: edge.id })
                      }}
                      onKeyDown={(event) => {
                        activateWithKeyboard(event, () => { setSelection({ kind: 'edge', id: edge.id }) })
                      }}
                    />
                  </g>
                )
              })}

              {layout.layers.map(layer => (
                <g key={layer.rank}>
                  <rect x="12" y={layer.y - 2} width="158" height="22" rx="6" fill="#071c1a" opacity="0.96" />
                  <text x="18" y={layer.y + 14} fill="#93a6a2" fontSize="12" fontWeight="600">
                    {stageName(layer.rank)}{layer.nodeCount > 1 ? ` · ${String(layer.nodeCount)} 项可并行` : ''}
                  </text>
                  <line
                    x1="18" y1={layer.y + 24} x2={Math.max(18, layout.width - 18)} y2={layer.y + 24}
                    stroke="#36504c" strokeDasharray="3 7" opacity="0.7"
                  />
                </g>
              ))}

              {layout.nodes.map(node => (
                <foreignObject
                  key={String(node.source.id)}
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                >
                  <DagNodeButton
                    node={node}
                    selected={selectedNodeId === String(node.source.id)}
                    related={selectedNodeId !== null && relatedNodeIds.has(String(node.source.id))}
                    onSelect={() => { setSelection({ kind: 'node', id: String(node.source.id) }) }}
                  />
                </foreignObject>
              ))}
            </svg>
          </div>

          <DagSelectionDetails selection={selection} layout={layout.nodes} edges={layout.edges} />

          <details style={outlineStyle}>
            <summary style={outlineSummaryStyle}>查看文字清单</summary>
            <ol style={outlineListStyle}>
              {layout.nodes.map(node => {
                const state = pactFlowDagStateCopy(node.source.state)
                const dependencies = node.source.dependencies
                  .map(id => layoutById.get(String(id))?.copy.label)
                  .filter((label): label is string => label !== undefined)
                return (
                  <li key={String(node.source.id)}>
                    <button
                      type="button"
                      style={outlineButtonStyle}
                      onClick={() => { setSelection({ kind: 'node', id: String(node.source.id) }) }}
                    >
                      <strong>{node.copy.label}</strong>
                      <span>{state.label}；{dependencies.length === 0 ? '无前置阶段' : `前置：${dependencies.join('、')}`}</span>
                    </button>
                  </li>
                )
              })}
            </ol>
          </details>
        </>
      )}
    </section>
  )
}

function DagNodeButton({ node, selected, related, onSelect }: {
  readonly node: PactFlowDagLayoutNode
  readonly selected: boolean
  readonly related: boolean
  readonly onSelect: () => void
}) {
  const state = pactFlowDagStateCopy(node.source.state)
  const color = toneColor[state.tone]
  return (
    <button
      type="button"
      aria-label={`${node.copy.label}，${state.label}。${node.copy.summary}`}
      aria-pressed={selected}
      onClick={onSelect}
      style={{
        ...nodeButtonStyle,
        borderColor: selected ? '#62dcc8' : `${color}88`,
        boxShadow: selected
          ? '0 0 0 2px rgba(98,220,200,.22), 0 12px 32px rgba(0,0,0,.24)'
          : related
            ? `0 0 0 1px ${color}55`
            : `0 8px 22px rgba(0,0,0,.16)`,
        opacity: related || !selected ? 1 : 0.9,
      }}
    >
      <span style={nodeStatusStyle}>
        <span style={{ ...statusDotStyle, background: color, boxShadow: `0 0 10px ${color}` }} />
        {state.label}
      </span>
      <strong style={nodeTitleStyle}>{node.copy.label}</strong>
      <span style={nodeSummaryStyle}>{node.copy.summary}</span>
    </button>
  )
}

function DagSelectionDetails({ selection, layout, edges }: {
  readonly selection: Selection
  readonly layout: readonly PactFlowDagLayoutNode[]
  readonly edges: readonly PactFlowDagLayoutEdge[]
}) {
  if (selection === null) {
    return <p style={selectionHintStyle}>点击任一阶段或连线，可在这里查看完整说明。</p>
  }
  const layoutById = new Map(layout.map(node => [String(node.source.id), node]))
  if (selection.kind === 'edge') {
    const edge = edges.find(candidate => candidate.id === selection.id)
    const source = edge === undefined ? undefined : layoutById.get(edge.sourceId)
    const target = edge === undefined ? undefined : layoutById.get(edge.targetId)
    if (edge === undefined || source === undefined || target === undefined) return null
    const satisfied = source.source.state === 'succeeded' || source.source.state === 'archived'
    return (
      <aside style={detailsStyle} aria-live="polite">
        <div style={detailsHeadingStyle}>
          <div>
            <span style={eyebrowStyle}>阶段依赖</span>
            <h3 style={detailsTitleStyle}>{source.copy.label} → {target.copy.label}</h3>
          </div>
          <StatusPill label={satisfied ? '前置条件已满足' : '仍在等待上游'} tone={satisfied ? 'success' : 'warning'} />
        </div>
        <p style={detailsCopyStyle}>{source.copy.label}完成后，{target.copy.label}才能开始。</p>
        <details style={technicalDetailsStyle}>
          <summary>查看技术信息</summary>
          <dl style={metadataGridStyle}>
            <Metadata label="上游标识" value={edge.sourceId} />
            <Metadata label="下游标识" value={edge.targetId} />
          </dl>
        </details>
      </aside>
    )
  }

  const node = layoutById.get(selection.id)
  if (node === undefined) return null
  const state = pactFlowDagStateCopy(node.source.state)
  const dependencies = node.source.dependencies
    .map(id => layoutById.get(String(id)))
    .filter((item): item is PactFlowDagLayoutNode => item !== undefined)
  const downstream = layout.filter(candidate => candidate.source.dependencies.some(id => String(id) === selection.id))
  return (
    <aside style={detailsStyle} aria-live="polite">
      <div style={detailsHeadingStyle}>
        <div>
          <span style={eyebrowStyle}>{stageName(node.rank)}</span>
          <h3 style={detailsTitleStyle}>{node.copy.label}</h3>
        </div>
        <StatusPill label={state.label} tone={state.tone} />
      </div>
      <p style={detailsCopyStyle}>{node.copy.summary}。</p>
      <dl style={metadataGridStyle}>
        <Metadata label="前置阶段" value={dependencies.length === 0 ? '无，这是起始阶段' : dependencies.map(item => item.copy.label).join('、')} />
        <Metadata label="后续阶段" value={downstream.length === 0 ? '无，这是最终阶段' : downstream.map(item => item.copy.label).join('、')} />
        <Metadata label="最后更新" value={formatUpdatedAt(node.source.updatedAt)} />
      </dl>
      <details style={technicalDetailsStyle}>
        <summary>查看技术信息</summary>
        <dl style={metadataGridStyle}>
          <Metadata label="技术标识" value={String(node.source.id)} />
          <Metadata label="原始任务说明" value={node.source.title} />
          <Metadata label="修订版本" value={`第 ${String(node.source.revision)} 版`} />
        </dl>
      </details>
    </aside>
  )
}

function LegendDot({ color, label }: { readonly color: string; readonly label: string }) {
  return <span style={legendItemStyle}><span style={{ ...legendDotStyle, background: color }} />{label}</span>
}

function StatusPill({ label, tone }: { readonly label: string; readonly tone: keyof typeof toneColor }) {
  const color = toneColor[tone]
  return (
    <span style={{ ...pillStyle, color, borderColor: `${color}66`, background: `${color}14` }}>
      <span style={{ ...statusDotStyle, background: color }} />{label}
    </span>
  )
}

function Metadata({ label, value }: { readonly label: string; readonly value: string }) {
  return <div style={metadataItemStyle}><dt>{label}</dt><dd>{value}</dd></div>
}

function stageName(rank: number): string {
  return stageNames[rank] ?? `第 ${String(rank + 1)} 阶段`
}

function isEdgeActive(
  edge: PactFlowDagLayoutEdge,
  selectedNodeId: string | null,
  selectedEdgeId: string | null,
  hoveredEdgeId: string | null,
): boolean {
  return edge.id === selectedEdgeId
    || edge.id === hoveredEdgeId
    || selectedNodeId === edge.sourceId
    || selectedNodeId === edge.targetId
}

function edgeAriaLabel(
  edge: PactFlowDagLayoutEdge,
  layoutById: ReadonlyMap<string, PactFlowDagLayoutNode>,
): string {
  const source = layoutById.get(edge.sourceId)?.copy.label ?? '上游阶段'
  const target = layoutById.get(edge.targetId)?.copy.label ?? '下游阶段'
  return `依赖关系：${source}完成后，${target}才能开始`
}

function activateWithKeyboard(event: KeyboardEvent<SVGPathElement>, action: () => void): void {
  if (event.key !== 'Enter' && event.key !== ' ') return
  event.preventDefault()
  action()
}

function formatUpdatedAt(value: number): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(value)
}

const toneColor = {
  neutral: '#9aa6a3',
  active: '#55a7ff',
  success: '#35c878',
  warning: '#e9b949',
  danger: '#ef5f67',
} as const

const sectionStyle: CSSProperties = {
  border: '1px solid #36504c',
  borderRadius: 12,
  padding: 16,
  minWidth: 0,
  overflow: 'hidden',
  background: '#071c1a',
  color: '#f4e3c8',
}
const headerStyle: CSSProperties = {
  display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12,
}
const titleStyle: CSSProperties = { margin: 0, fontSize: 17 }
const subtitleStyle: CSSProperties = { margin: '5px 0 0', fontSize: 13, opacity: 0.68 }
const foldedHintStyle: CSSProperties = { margin: '5px 0 0', fontSize: 12, color: '#93a6a2' }
const legendStyle: CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12, opacity: 0.82 }
const legendItemStyle: CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 6 }
const legendDotStyle: CSSProperties = { width: 8, height: 8, borderRadius: '50%' }
const graphViewportStyle: CSSProperties = { width: '100%', minWidth: 0, marginTop: 14, overflow: 'hidden' }
const svgStyle: CSSProperties = { display: 'block', maxWidth: '100%', overflow: 'visible' }
const nodeButtonStyle: CSSProperties = {
  width: '100%', height: '100%', display: 'flex', flexDirection: 'column', alignItems: 'flex-start',
  gap: 7, boxSizing: 'border-box', padding: '12px 13px', textAlign: 'left', cursor: 'pointer',
  border: '1px solid', borderRadius: 13, background: '#0b2522',
  color: '#f4e3c8', font: 'inherit', overflow: 'hidden',
  transition: 'border-color 160ms ease, box-shadow 160ms ease',
}
const nodeStatusStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 11,
  color: '#c5d0cd',
}
const statusDotStyle: CSSProperties = { width: 8, height: 8, borderRadius: '50%', flex: '0 0 auto' }
const nodeTitleStyle: CSSProperties = { fontSize: 15, lineHeight: 1.25 }
const nodeSummaryStyle: CSSProperties = {
  fontSize: 12, lineHeight: 1.42, color: '#b6c2bf', overflow: 'hidden',
}
const selectionHintStyle: CSSProperties = {
  margin: '10px 0 0', padding: '10px 12px', borderRadius: 9,
  color: '#b6c2bf',
  background: '#0b2522', fontSize: 13,
}
const detailsStyle: CSSProperties = {
  marginTop: 10, display: 'grid', gap: 11, padding: 14, minWidth: 0,
  border: '1px solid rgba(98,220,200,.32)', borderRadius: 11,
  background: '#0b2522',
}
const detailsHeadingStyle: CSSProperties = {
  display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 10,
}
const eyebrowStyle: CSSProperties = { fontSize: 11, opacity: 0.6 }
const detailsTitleStyle: CSSProperties = { margin: '3px 0 0', fontSize: 16 }
const detailsCopyStyle: CSSProperties = { margin: 0, lineHeight: 1.6, fontSize: 13 }
const pillStyle: CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid', borderRadius: 999,
  padding: '4px 9px', fontSize: 12, whiteSpace: 'nowrap',
}
const metadataGridStyle: CSSProperties = {
  display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 180px), 1fr))', gap: 10, margin: 0,
}
const metadataItemStyle: CSSProperties = {
  display: 'grid', gap: 3, minWidth: 0, fontSize: 12, overflowWrap: 'anywhere',
}
const technicalDetailsStyle: CSSProperties = {
  borderTop: '1px solid #36504c', paddingTop: 9, fontSize: 12, opacity: 0.88,
}
const outlineStyle: CSSProperties = {
  marginTop: 10, borderTop: '1px solid #36504c', paddingTop: 10,
}
const outlineSummaryStyle: CSSProperties = { cursor: 'pointer', fontSize: 13 }
const outlineListStyle: CSSProperties = { display: 'grid', gap: 7, margin: '10px 0 0', paddingLeft: 20 }
const outlineButtonStyle: CSSProperties = {
  width: '100%', display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 6,
  border: 0, background: 'none', color: 'inherit', cursor: 'pointer', textAlign: 'left', font: 'inherit',
}
