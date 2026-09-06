import { describe, expect, it } from 'vitest'
import { buildPactFlowDagLayout, pactFlowDagNodeCopy, pactFlowDagStateCopy } from '../src/client/dag-graph-model.ts'
import type { PactFlowNode } from '../src/types.ts'

describe('PactFlow DAG graph', () => {
  it('assigns stable layers from dependencies and keeps every node inside the canvas', () => {
    const nodes = [
      node('root-a', []),
      node('root-b', []),
      node('child', ['root-a']),
      node('review', ['root-a', 'root-b', 'child']),
    ]

    const layout = buildPactFlowDagLayout(nodes, 760)
    const byId = new Map(layout.nodes.map(item => [String(item.source.id), item]))

    expect(byId.get('root-a')?.rank).toBe(0)
    expect(byId.get('root-b')?.rank).toBe(0)
    expect(byId.get('child')?.rank).toBe(1)
    expect(byId.get('review')?.rank).toBe(2)
    expect(layout.edges.map(edge => edge.id)).toEqual([
      'root-a->child',
      'root-b->review',
      'child->review',
    ])
    for (const item of layout.nodes) {
      expect(item.x).toBeGreaterThanOrEqual(0)
      expect(item.x + item.width).toBeLessThanOrEqual(layout.width)
      expect(item.y + item.height).toBeLessThanOrEqual(layout.height)
    }
  })

  it('reflows a wide first layer into readable rows on a narrow surface', () => {
    const nodes = [node('a', []), node('b', []), node('c', []), node('d', []), node('end', ['a', 'b', 'c', 'd'])]

    const layout = buildPactFlowDagLayout(nodes, 360)

    expect(layout.layers[0]?.rows).toBe(4)
    expect(layout.nodes.every(item => item.width >= 220)).toBe(true)
    expect(layout.height).toBeGreaterThan(650)
  })

  it('preserves task titles independently of business-specific identifiers or language', () => {
    const known = node('rerun-verify-linkage', [], '迁移索引')
    const unknown = node('custom-english-node', [], 'Run tests')

    expect(pactFlowDagNodeCopy(known)).toEqual({
      label: '迁移索引',
      summary: '查看该任务的执行详情',
    })
    expect(pactFlowDagNodeCopy(unknown)).toEqual({
      label: 'Run tests',
      summary: '查看该任务的执行详情',
    })
    expect(pactFlowDagStateCopy('succeeded')).toEqual({ label: '已完成', tone: 'success' })
    expect(pactFlowDagStateCopy('failed')).toEqual({ label: '执行失败', tone: 'danger' })
  })

  it('bounds long labels without discarding mixed-language meaning', () => {
    const copy = pactFlowDagNodeCopy(node('custom', [], 'API gateway 配置与验证'))
    expect(copy.label).toContain('API gateway')
    expect(copy.label.length).toBeLessThanOrEqual(13)
    expect(copy.summary).toContain('配置与验证')
  })
})

function node(id: string, dependencies: readonly string[], title = id): PactFlowNode {
  return {
    id,
    needId: 'need',
    title,
    state: 'succeeded',
    revision: 1,
    dependencies,
    updatedAt: 1_725_000_000_000,
  }
}
