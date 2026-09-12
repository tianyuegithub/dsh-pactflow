const PHASE_LABELS: Readonly<Record<string, string>> = {
  backlog: '需求池',
  discussion: '讨论中',
  confirmed: '已确认',
  design: '设计中',
  planning: '计划中',
  executing: '执行中',
  code_review: '代码评审',
  verification: '验证中',
  closing: '收口中',
  deployed: '交付阶段',
}

const NODE_STATE_LABELS: Readonly<Record<string, string>> = {
  pending: '待准备',
  ready: '等待派发',
  claimed: '已领取',
  running: '运行中',
  blocked: '已阻塞',
  review: '待评审',
  paused: '已暂停',
  succeeded: '已成功',
  failed: '已失败',
  cancelled: '已取消',
  archived: '已归档',
}

export function phaseLabel(value: string): string {
  return PHASE_LABELS[value] ?? `未知状态（${value}）`
}

export function nodeStateLabel(value: string): string {
  return NODE_STATE_LABELS[value] ?? `未知状态（${value}）`
}
