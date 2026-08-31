import type { PactFlowNode, PactFlowNodeState } from '../types.ts'

export interface PactFlowDagNodeCopy {
  readonly label: string
  readonly summary: string
}

export interface PactFlowDagStateCopy {
  readonly label: string
  readonly tone: 'neutral' | 'active' | 'success' | 'warning' | 'danger'
}

export interface PactFlowDagLayoutNode {
  readonly source: PactFlowNode
  readonly copy: PactFlowDagNodeCopy
  readonly rank: number
  readonly row: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface PactFlowDagLayoutEdge {
  readonly id: string
  readonly sourceId: string
  readonly targetId: string
  readonly path: string
}

export interface PactFlowDagLayer {
  readonly rank: number
  readonly y: number
  readonly rows: number
  readonly nodeCount: number
}

export interface PactFlowDagLayout {
  readonly width: number
  readonly height: number
  readonly nodes: readonly PactFlowDagLayoutNode[]
  readonly edges: readonly PactFlowDagLayoutEdge[]
  readonly layers: readonly PactFlowDagLayer[]
}

const NODE_COPY: Readonly<Record<string, PactFlowDagNodeCopy>> = {
  'rerun-verify-linkage': {
    label: '重跑结果联动',
    summary: '回调结果自动进入闭环',
  },
  'auto-create-inflight-dedup': {
    label: '在途问题聚合',
    summary: '重复失败更新原问题单',
  },
  'transition-ownership-guard': {
    label: '流转归属校验',
    summary: '只允许相关责任人操作',
  },
  'resume-sla-extension': {
    label: '挂起时长补偿',
    summary: '恢复时顺延处理期限',
  },
  'merge-carryover-decision': {
    label: '合并数据搬运',
    summary: '累计数据并保留双向记录',
  },
  'cross-node-review-fixes': {
    label: '跨节点评审修复',
    summary: '统一关联、权限与时效语义',
  },
  'closing-integration-ancestry': {
    label: '合并前祖先收口',
    summary: '确保分支无冲突完成合并',
  },
}

const STATE_COPY: Readonly<Record<PactFlowNodeState, PactFlowDagStateCopy>> = {
  pending: { label: '等待前置完成', tone: 'neutral' },
  ready: { label: '等待派发', tone: 'active' },
  claimed: { label: '已领取', tone: 'active' },
  running: { label: '正在执行', tone: 'active' },
  blocked: { label: '暂时阻塞', tone: 'warning' },
  review: { label: '等待评审', tone: 'warning' },
  succeeded: { label: '已完成', tone: 'success' },
  failed: { label: '执行失败', tone: 'danger' },
  cancelled: { label: '已取消', tone: 'neutral' },
  archived: { label: '已归档', tone: 'neutral' },
}

const CHINESE_PHRASE = /[\u3400-\u9fff][\u3400-\u9fff、，；与和及的了在为将把由并到：:\s]{1,}/g

export function pactFlowDagNodeCopy(node: PactFlowNode): PactFlowDagNodeCopy {
  const known = NODE_COPY[String(node.id)]
  if (known !== undefined) return known

  const title = node.title.replace(/^N\d+\s*/u, '').trim()
  const phrases = title.match(CHINESE_PHRASE)?.map(value => value.trim()).filter(Boolean) ?? []
  const label = compactPhrase(phrases[0] ?? '任务节点', 12)
  const summary = compactPhrase(phrases[1] ?? phrases[0] ?? '查看该阶段的执行详情', 20)
  return { label, summary: summary === label ? '查看该阶段的执行详情' : summary }
}

export function pactFlowDagStateCopy(state: PactFlowNodeState): PactFlowDagStateCopy {
  return STATE_COPY[state]
}

export function buildPactFlowDagLayout(
  sourceNodes: readonly PactFlowNode[],
  availableWidth: number,
): PactFlowDagLayout {
  const width = Math.max(280, Math.floor(availableWidth))
  if (sourceNodes.length === 0) return { width, height: 0, nodes: [], edges: [], layers: [] }

  const sourceById = new Map(sourceNodes.map(node => [String(node.id), node]))
  const rankById = assignRanks(sourceNodes, sourceById)
  const nodesByRank = new Map<number, PactFlowNode[]>()
  for (const node of sourceNodes) {
    const rank = rankById.get(String(node.id)) ?? 0
    const layer = nodesByRank.get(rank) ?? []
    layer.push(node)
    nodesByRank.set(rank, layer)
  }

  const paddingX = width < 420 ? 12 : 18
  const paddingTop = 18
  const nodeHeight = 102
  const headingHeight = 28
  const columnGap = width < 520 ? 12 : 16
  const rowGap = 34
  const layerGap = 56
  const minimumNodeWidth = width < 420 ? 228 : 176
  const maximumNodeWidth = 220
  const usableWidth = width - paddingX * 2
  const maximumColumns = Math.max(
    1,
    Math.floor((usableWidth + columnGap) / (minimumNodeWidth + columnGap)),
  )

  const layoutNodes: PactFlowDagLayoutNode[] = []
  const positionedById = new Map<string, PactFlowDagLayoutNode>()
  const layers: PactFlowDagLayer[] = []
  let layerY = paddingTop
  const sortedRanks = [...nodesByRank.keys()].sort((left, right) => left - right)

  for (const rank of sortedRanks) {
    const layerNodes = nodesByRank.get(rank) ?? []
    const columns = Math.min(maximumColumns, layerNodes.length)
    const nodeWidth = Math.min(
      maximumNodeWidth,
      (usableWidth - columnGap * Math.max(0, columns - 1)) / Math.max(1, columns),
    )
    const rows = Math.ceil(layerNodes.length / Math.max(1, columns))
    const rowWidth = columns * nodeWidth + Math.max(0, columns - 1) * columnGap
    const startX = paddingX + Math.max(0, (usableWidth - rowWidth) / 2)
    const nodeY = layerY + headingHeight

    layerNodes.forEach((node, index) => {
      const row = Math.floor(index / columns)
      const column = index % columns
      const nodesInRow = Math.min(columns, layerNodes.length - row * columns)
      const actualRowWidth = nodesInRow * nodeWidth + Math.max(0, nodesInRow - 1) * columnGap
      const rowStartX = paddingX + Math.max(0, (usableWidth - actualRowWidth) / 2)
      const defaultX = row === 0
        ? startX + column * (nodeWidth + columnGap)
        : rowStartX + column * (nodeWidth + columnGap)
      const dependencyPositions = node.dependencies
        .map(dependency => positionedById.get(String(dependency)))
        .filter((item): item is PactFlowDagLayoutNode => item !== undefined)
      const preferredCenter = dependencyPositions.length === 0
        ? null
        : dependencyPositions.reduce((sum, item) => sum + item.x + item.width / 2, 0) / dependencyPositions.length
      const x = layerNodes.length === 1 && preferredCenter !== null
        ? clamp(preferredCenter - nodeWidth / 2, paddingX, width - paddingX - nodeWidth)
        : defaultX
      const positioned: PactFlowDagLayoutNode = {
        source: node,
        copy: pactFlowDagNodeCopy(node),
        rank,
        row,
        x,
        y: nodeY + row * (nodeHeight + rowGap),
        width: nodeWidth,
        height: nodeHeight,
      }
      layoutNodes.push(positioned)
      positionedById.set(String(node.id), positioned)
    })

    layers.push({ rank, y: layerY, rows, nodeCount: layerNodes.length })
    layerY = nodeY + rows * nodeHeight + Math.max(0, rows - 1) * rowGap + layerGap
  }

  const layoutById = new Map(layoutNodes.map(node => [String(node.source.id), node]))
  const allOutgoingById = new Map<string, string[]>()
  for (const node of sourceNodes) {
    for (const dependency of node.dependencies) {
      const sourceId = String(dependency)
      if (!sourceById.has(sourceId)) continue
      const outgoing = allOutgoingById.get(sourceId) ?? []
      outgoing.push(String(node.id))
      allOutgoingById.set(sourceId, outgoing)
    }
  }

  const visiblePairs = new Set<string>()
  const visibleOutgoingById = new Map<string, string[]>()
  for (const target of sourceNodes) {
    for (const dependency of target.dependencies) {
      const sourceId = String(dependency)
      const targetId = String(target.id)
      if (!sourceById.has(sourceId) || hasAlternatePath(sourceId, targetId, allOutgoingById)) continue
      visiblePairs.add(`${sourceId}->${targetId}`)
      const outgoing = visibleOutgoingById.get(sourceId) ?? []
      outgoing.push(targetId)
      visibleOutgoingById.set(sourceId, outgoing)
    }
  }

  const edges: PactFlowDagLayoutEdge[] = []
  for (const target of sourceNodes) {
    const targetLayout = layoutById.get(String(target.id))
    if (targetLayout === undefined) continue
    const dependencies = target.dependencies.filter(id => visiblePairs.has(`${String(id)}->${String(target.id)}`))
    dependencies.forEach((dependency, dependencyIndex) => {
      const sourceId = String(dependency)
      const targetId = String(target.id)
      const sourceLayout = layoutById.get(sourceId)
      if (sourceLayout === undefined) return
      const outgoing = visibleOutgoingById.get(sourceId) ?? [targetId]
      const outgoingIndex = Math.max(0, outgoing.indexOf(targetId))
      const startX = sourceLayout.x + sourceLayout.width * (outgoingIndex + 1) / (outgoing.length + 1)
      const startY = sourceLayout.y + sourceLayout.height
      const endX = targetLayout.x + targetLayout.width * (dependencyIndex + 1) / (dependencies.length + 1)
      const endY = targetLayout.y
      const sourceLayer = layers.find(layer => layer.rank === sourceLayout.rank)
      const crossesNode = crossesIntermediateNode(sourceLayout, targetLayout, startX, startY, endX, endY, layoutNodes)
      const path = (sourceLayer !== undefined && sourceLayer.rows > 1) || crossesNode
        ? routedSidePath(startX, startY, endX, endY, width, edges.length)
        : curvedPath(startX, startY, endX, endY)
      edges.push({ id: `${sourceId}->${targetId}`, sourceId, targetId, path })
    })
  }

  return {
    width,
    height: Math.max(220, layerY - layerGap + 18),
    nodes: layoutNodes,
    edges,
    layers,
  }
}

function assignRanks(
  nodes: readonly PactFlowNode[],
  sourceById: ReadonlyMap<string, PactFlowNode>,
): ReadonlyMap<string, number> {
  const memo = new Map<string, number>()
  const visiting = new Set<string>()

  const rankOf = (id: string): number => {
    const cached = memo.get(id)
    if (cached !== undefined) return cached
    if (visiting.has(id)) return 0
    visiting.add(id)
    const node = sourceById.get(id)
    const dependencyRanks = node?.dependencies
      .map(dependency => String(dependency))
      .filter(dependency => sourceById.has(dependency))
      .map(rankOf) ?? []
    visiting.delete(id)
    const rank = dependencyRanks.length === 0 ? 0 : Math.max(...dependencyRanks) + 1
    memo.set(id, rank)
    return rank
  }

  for (const node of nodes) rankOf(String(node.id))
  return memo
}

function curvedPath(startX: number, startY: number, endX: number, endY: number): string {
  const bend = Math.max(28, (endY - startY) * 0.44)
  return `M ${round(startX)} ${round(startY)} C ${round(startX)} ${round(startY + bend)}, ${round(endX)} ${round(endY - bend)}, ${round(endX)} ${round(endY)}`
}

function routedSidePath(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  width: number,
  laneIndex: number,
): string {
  const useLeftLane = laneIndex % 2 === 0
  const laneOffset = laneIndex % 8 * 3
  const laneX = useLeftLane ? 12 + laneOffset : width - 12 - laneOffset
  const departureY = startY + 38
  const arrivalY = endY - 54
  return `M ${round(startX)} ${round(startY)} C ${round(startX)} ${round(startY + 18)}, ${round(laneX)} ${round(startY + 18)}, ${round(laneX)} ${round(departureY)} C ${round(laneX)} ${round(arrivalY)}, ${round(endX)} ${round(arrivalY)}, ${round(endX)} ${round(endY)}`
}

function crossesIntermediateNode(
  source: PactFlowDagLayoutNode,
  target: PactFlowDagLayoutNode,
  startX: number,
  startY: number,
  endX: number,
  endY: number,
  nodes: readonly PactFlowDagLayoutNode[],
): boolean {
  if (target.rank - source.rank <= 1) return false
  return nodes.some(candidate => {
    if (candidate.rank <= source.rank || candidate.rank >= target.rank) return false
    const middleY = candidate.y + candidate.height / 2
    const progress = (middleY - startY) / Math.max(1, endY - startY)
    const crossingX = startX + (endX - startX) * progress
    return crossingX >= candidate.x - 18 && crossingX <= candidate.x + candidate.width + 18
  })
}

function hasAlternatePath(
  sourceId: string,
  targetId: string,
  outgoingById: ReadonlyMap<string, readonly string[]>,
): boolean {
  const queue = [...(outgoingById.get(sourceId) ?? [])].filter(candidate => candidate !== targetId)
  const visited = new Set<string>([sourceId])
  while (queue.length > 0) {
    const candidate = queue.shift()
    if (candidate === undefined || visited.has(candidate)) continue
    if (candidate === targetId) return true
    visited.add(candidate)
    queue.push(...(outgoingById.get(candidate) ?? []))
  }
  return false
}

function compactPhrase(value: string, maximumLength: number): string {
  const normalized = value
    .replace(/[\s，,；;：:]+$/u, '')
    .replace(/\s+/gu, '')
    .trim()
  if (normalized.length <= maximumLength) return normalized
  return `${normalized.slice(0, maximumLength - 1)}…`
}

function round(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
