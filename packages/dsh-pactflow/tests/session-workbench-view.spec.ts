import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { WorkbenchEvidenceView } from '../src/client/session-workbench-view.tsx'
import type {
  PactFlowDocumentId,
  PactFlowNeedId,
  PactFlowNodeId,
  PactFlowNodeState,
  PactFlowPhase,
  PactFlowReviewId,
  PactFlowRunId,
  PactFlowSnapshot,
} from '../src/types.ts'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const { createElement: createMockElement } = await import('react')
  return {
    Button: ({ children, variant, size, icon, ...buttonProps }: ButtonHTMLAttributes<HTMLButtonElement> & {
      readonly children?: ReactNode
      readonly variant?: string
      readonly size?: string
      readonly icon?: ReactNode
    }) => {
      void variant
      void size
      void icon
      return createMockElement('button', buttonProps, children)
    },
  }
})

const selectedNeedId = 'selected-need' as PactFlowNeedId
const foreignNeedId = 'foreign-need' as PactFlowNeedId
const selectedNodeId = 'selected-node' as PactFlowNodeId
const foreignNodeId = 'foreign-node' as PactFlowNodeId
const selectedRunId = 'run-11111111-1111-4111-8111-111111111111' as PactFlowRunId
const foreignRunId = 'run-22222222-2222-4222-8222-222222222222' as PactFlowRunId

function snapshot({
  phase = 'deployed',
  nodeState = 'failed',
  description = '当前需求描述',
  outcome = '验证命令失败：退出码 1',
  reviewNote = '人工评审说明',
}: {
  readonly phase?: PactFlowPhase
  readonly nodeState?: PactFlowNodeState
  readonly description?: string
  readonly outcome?: string
  readonly reviewNote?: string
} = {}): PactFlowSnapshot {
  return {
    project: { project: null },
    needs: { byId: {
      [selectedNeedId]: {
        id: selectedNeedId,
        title: '当前需求',
        description,
        phase,
        revision: 7,
        createdAt: 1,
        updatedAt: 2,
      },
      [foreignNeedId]: {
        id: foreignNeedId,
        title: '另一需求',
        description: '另一需求描述',
        phase: 'executing',
        revision: 2,
        createdAt: 1,
        updatedAt: 2,
      },
    } },
    dag: { byId: {
      [selectedNodeId]: {
        id: selectedNodeId,
        needId: selectedNeedId,
        title: '当前需求节点',
        state: nodeState,
        revision: 4,
        dependencies: [],
        updatedAt: 3,
      },
      [foreignNodeId]: {
        id: foreignNodeId,
        needId: foreignNeedId,
        title: '另一需求节点',
        state: 'succeeded',
        revision: 3,
        dependencies: [],
        updatedAt: 3,
      },
    } },
    runs: { byId: {
      [selectedRunId]: {
        id: selectedRunId,
        nodeId: selectedNodeId,
        nodeRevision: 3,
        attempt: 2,
        provider: 'local',
        claimId: 'selected-claim',
        state: 'failed',
        leaseDeadline: 10,
        updatedAt: 9,
        outcome,
      },
      [foreignRunId]: {
        id: foreignRunId,
        nodeId: foreignNodeId,
        nodeRevision: 2,
        attempt: 1,
        provider: 'k3s',
        claimId: 'foreign-claim',
        state: 'succeeded',
        leaseDeadline: 10,
        updatedAt: 8,
        k3sResult: {
          podName: 'foreign-pod',
          exitCode: 0,
          commit: 'foreign-commit-should-not-render',
          branch: 'foreign-branch',
          harnessVersion: '1.0.0',
          finishedAt: 8,
        },
      },
    } },
    delivery: {
      reviews: {
        human: {
          id: 'human-review' as PactFlowReviewId,
          needId: selectedNeedId,
          kind: 'verification',
          decision: 'approved',
          note: reviewNote,
          recordedAt: 4,
          source: 'dsh-approval',
        },
        policy: {
          id: 'policy-review' as PactFlowReviewId,
          needId: selectedNeedId,
          kind: 'plan',
          decision: 'approved',
          note: '策略评审说明',
          recordedAt: 5,
          source: 'autopilot-policy',
        },
        foreign: {
          id: 'foreign-review' as PactFlowReviewId,
          needId: foreignNeedId,
          kind: 'code',
          decision: 'approved',
          note: '另一需求评审说明',
          recordedAt: 5,
        },
      },
      documents: {
        selected: {
          id: 'selected-document' as PactFlowDocumentId,
          needId: selectedNeedId,
          kind: 'verification',
          uri: 'docs/selected-report.md',
          title: '当前需求验证报告',
          linkedAt: 6,
        },
        foreign: {
          id: 'foreign-document' as PactFlowDocumentId,
          needId: foreignNeedId,
          kind: 'release',
          uri: 'https://example.invalid/foreign',
          title: '另一需求文档',
          linkedAt: 6,
        },
      },
      releases: {
        foreign: {
          needId: foreignNeedId,
          commit: 'foreign-release-commit',
          branch: 'foreign-release-branch',
          recordedAt: 7,
        },
      },
      cleanups: {},
    },
  }
}

function render(
  tab: 'progress' | 'runs' | 'delivery',
  value = snapshot(),
  extra: Partial<Parameters<typeof WorkbenchEvidenceView>[0]> = {},
): string {
  return renderToStaticMarkup(createElement(WorkbenchEvidenceView, {
    snapshot: value,
    needId: selectedNeedId,
    tab,
    onResume: vi.fn(),
    resumingNodeId: null,
    ...extra,
  }))
}

/** One discussion tail as the Host would project it for this Need. */
function withDiscussion(
  entries: readonly { id: string; author: 'human' | 'agent'; excerpt: string }[],
): PactFlowSnapshot {
  return {
    ...snapshot(),
    discussion: {
      counters: {},
      recent: {
        [selectedNeedId]: entries.map(entry => ({
          id: entry.id as never,
          needId: selectedNeedId as never,
          author: entry.author,
          excerpt: entry.excerpt,
          createdAt: 1,
          voided: false,
          source: 'pactflow-comment' as const,
        })),
      },
    },
  }
}

const foreignMarkers = [
  '另一需求节点',
  foreignRunId,
  '另一需求评审说明',
  '另一需求文档',
  'foreign-commit-should-not-render',
  'foreign-release-commit',
]

describe('WorkbenchEvidenceView', () => {
  it.each(['progress', 'runs', 'delivery'] as const)('%s 只呈现当前需求的数据', tab => {
    const html = render(tab)
    for (const marker of foreignMarkers) expect(html).not.toContain(marker)
  })

  it('执行记录对空验证显式标记缺失', () => {
    const html = render('runs')
    expect(html).toContain('当前需求节点')
    expect(html).toContain('已失败')
    expect(html).toContain('缺少真实验证记录')
  })

  it('交付页区分失败证据、人工与预授权来源', () => {
    const html = render('delivery')
    expect(html).toContain('验收与交付')
    expect(html).toContain('失败：')
    expect(html).toContain('验证命令失败：退出码 1')
    expect(html).toContain('来源：人工')
    expect(html).toContain('来源：预授权策略')
  })

  it('已到交付阶段但无 release 时不宣称交付成功', () => {
    const html = render('delivery')
    expect(html).toContain('代码交付 / 宿主交付记录')
    expect(html).toContain('没有宿主交付记录')
    expect(html).toContain('当前阶段不代表代码已交付或应用已部署')
    expect(html).not.toContain('交付成功')
  })

  it('缺少验收与交付数据时在一个区域逐项说明', () => {
    const value = snapshot({ nodeState: 'succeeded' })
    const html = render('delivery', {
      ...value,
      runs: { byId: {} },
      delivery: { ...value.delivery, reviews: {}, documents: {}, releases: {} },
    })
    expect(html.match(/<section/g)).toHaveLength(2)
    expect(html).toContain('该需求尚未记录评审决定')
    expect(html).toContain('未记录成功的命令验证或失败运行证据')
    expect(html).toContain('该需求尚未关联交付文档')
    expect(html).toContain('没有宿主交付记录')
  })

  it('进展页为阻塞节点显示最近运行原因', () => {
    const html = render('progress')
    expect(html).toContain('阻塞与恢复')
    expect(html).toContain('最近运行：')
    expect(html).toContain('验证命令失败：退出码 1')
  })

  it('没有阻塞节点时将状态压成一行而不显示空卡标题', () => {
    const html = render('progress', snapshot({ nodeState: 'succeeded' }))
    expect(html).toContain('当前没有阻塞、失败或暂停节点')
    expect(html).not.toContain('阻塞与恢复')
  })

  it('未知阶段与节点状态保留原值', () => {
    const html = render('progress', snapshot({
      phase: 'future-phase' as PactFlowPhase,
      nodeState: 'future-node-state' as PactFlowNodeState,
    }))
    expect(html).toContain('未知状态（future-phase）')
    expect(html).toContain('未知状态（future-node-state）')
  })

  it('长文本默认显示180字预览并在关闭的details中保留完整原文', () => {
    const description = `${'需'.repeat(190)}\n需求原文末尾`
    const outcome = `${'运'.repeat(190)}\n运行原文末尾`
    const reviewNote = `${'评'.repeat(190)}\n评审原文末尾`
    const value = snapshot({ description, outcome, reviewNote })
    const progress = render('progress', value)
    const delivery = render('delivery', value)

    expect(progress).toContain(`${description.slice(0, 180)}…`)
    expect(progress).toContain(description)
    expect(progress).toContain(outcome)
    expect(progress).toContain('完整需求说明')
    expect(progress).toContain('完整运行说明')
    expect(delivery).toContain(reviewNote)
    expect(delivery).toContain(outcome)
    expect(delivery).toContain('完整评审说明')
    expect(progress).toContain('<details>')
    expect(progress).toMatch(/<details>[\s\S]*?<div style="[^"]*white-space:pre-wrap/)
    expect(delivery).toContain('<details>')
    expect(progress).not.toContain('<details open')
    expect(delivery).not.toContain('<details open')
  })

  it('短文本完整显示且不增加折叠', () => {
    expect(render('progress')).not.toContain('<details')
    expect(render('delivery')).not.toContain('<details')
  })
})

describe('WorkbenchEvidenceView 讨论区', () => {
  it('无讨论时说明讨论会随需求持久保留', () => {
    const markup = render('progress')
    expect(markup).toContain('该需求尚无讨论')
  })

  it('逐条标出作者是人还是执行代理', () => {
    // 看讨论的人必须一眼分清哪条是模型自己写的：模型上一轮的结论
    // 若与人的判断混在一起，会被当成独立佐证。
    const markup = render('progress', withDiscussion([
      { id: 'comment-1', author: 'human', excerpt: '这里的取舍我倾向 B' },
      { id: 'comment-2', author: 'agent', excerpt: '调研结论：A 与 B 差异在缓存' },
    ]))
    expect(markup).toContain('这里的取舍我倾向 B')
    expect(markup).toContain('调研结论：A 与 B 差异在缓存')
    expect(markup).toContain('人 ·')
    expect(markup).toContain('执行代理 ·')
  })

  it('只在宿主提供写入入口时呈现发表与作废', () => {
    const entries = withDiscussion([{ id: 'comment-1', author: 'human', excerpt: '一条讨论' }])
    const readOnly = render('progress', entries)
    expect(readOnly).not.toContain('发表讨论')
    expect(readOnly).not.toContain('作废')

    const writable = render('progress', entries, {
      onAddComment: vi.fn(async () => {}),
      onVoidComment: vi.fn(async () => {}),
    })
    expect(writable).toContain('发表讨论')
    expect(writable).toContain('作废')
  })

  it('讨论只出现在进展页', () => {
    const entries = withDiscussion([{ id: 'comment-1', author: 'human', excerpt: '一条讨论' }])
    expect(render('runs', entries)).not.toContain('一条讨论')
    expect(render('delivery', entries)).not.toContain('一条讨论')
  })

  it('旧宿主未提供讨论字段时进展页照常渲染', () => {
    // discussion 是增量字段：升级期间客户端可能配到尚未写过评论的宿主。
    const legacy = { ...snapshot(), discussion: undefined } as PactFlowSnapshot
    expect(() => render('progress', legacy)).not.toThrow()
  })
})
