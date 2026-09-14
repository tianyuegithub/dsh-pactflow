import type { PactFlowGiteaGateState } from './gitea.ts'
import type { PactFlowGiteaCheck, PactFlowReviewGateGap, PactFlowReviewGateRecord } from './types.ts'

export type { PactFlowReviewGateGap, PactFlowReviewGateRecord }

/**
 * Closing against a protected branch that requires external review.
 *
 * Before this, closing simply gave up when the default branch required approvals
 * or status checks — the user had to leave the platform and merge by hand. That
 * is not a convenience gap: a hand-merge produces a delivery terminal state that
 * the Host never verified, so the ancestry check, the exact task-set check
 * against this baseline, and "cleanup responsibility persists before the release
 * record" all silently stopped applying. Since required approvals and CI checks
 * are the ordinary configuration of a protected branch, the strongest guarantee
 * in the system switched itself off precisely where it mattered.
 *
 * So closing now holds its responsibility and waits. Everything here is
 * observation and arithmetic: the Host never submits a review, never edits
 * branch protection, never force-merges and never triggers CI.
 */

export type PactFlowReviewGateRefusal =
  | 'head-drift'
  | 'base-changed'
  | 'subject-drift'
  | 'check-regressed'

export type PactFlowReviewGateVerdict =
  | { readonly kind: 'ready'; readonly gap: PactFlowReviewGateGap }
  | {
    readonly kind: 'waiting'
    readonly gap: PactFlowReviewGateGap
    readonly autoRecheckExhausted: boolean
    readonly detail: string
  }
  | { readonly kind: 'externally-merged'; readonly detail: string }
  | { readonly kind: 'refused'; readonly reason: PactFlowReviewGateRefusal; readonly detail: string }

/**
 * Bounded unattended recheck cadence.
 *
 * There was no existing contract to inherit — `run-time-contracts` governs the
 * K3s ownership lease against the Job wall clock, which is a different question.
 * So this is its own bounded contract, sized against what it waits for: CI runs
 * in minutes, and a reviewer in hours, so a 30s floor with 40 rechecks covers
 * about twenty minutes unattended without hammering the Gitea API. Exhausting it
 * stops the automation, never the user.
 */
export const PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS = 30_000
export const PACTFLOW_REVIEW_GATE_MAX_RECHECKS = 40

/** Whether an unattended recheck is allowed right now. Explicit rechecks ignore this. */
export function reviewGateRecheckDue(record: PactFlowReviewGateRecord, now: number): boolean {
  if (record.recheckCount >= record.maxRechecks) return false
  if (record.lastCheckedAt === undefined) return true
  return now - record.lastCheckedAt >= PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS
}

const CHECK_LABEL: Readonly<Record<PactFlowGiteaCheck['state'], string>> = {
  pending: '未开始',
  running: '进行中',
  success: '成功',
  failure: '失败',
  unknown: '状态不明',
}

/** Render the gap so a person reads what is missing, not just "not ready". */
export function describeReviewGateGap(gap: PactFlowReviewGateGap): string {
  const parts: string[] = []
  if (gap.missingApprovals > 0) parts.push(`尚缺 ${String(gap.missingApprovals)} 个批准`)
  for (const check of gap.checks) {
    if (check.state === 'success') continue
    parts.push(`检查 ${check.context}：${CHECK_LABEL[check.state]}`)
  }
  return parts.length === 0 ? '前置已齐备' : parts.join('；')
}

/**
 * Decide what one observation of the gate means.
 *
 * `currentNeedRevision` is the Need's revision right now: if it moved, what the
 * gate was opened against is no longer what would be merged, and only a person
 * can say whether that is fine.
 */
export function evaluateReviewGate(input: {
  readonly record: PactFlowReviewGateRecord
  readonly observed: PactFlowGiteaGateState
  readonly currentNeedRevision: number
}): PactFlowReviewGateVerdict {
  const { record, observed, currentNeedRevision } = input

  // Checked before drift: a merged PR is a fact to report, and reporting "head
  // drifted" about something already merged would describe the wrong problem.
  if (observed.merged) {
    return {
      kind: 'externally-merged',
      detail: `PR #${String(record.pullRequestNumber)} 已在平台外被合并，需显式处置后才产生交付终态`,
    }
  }
  if (observed.headCommit !== record.headCommit) {
    return {
      kind: 'refused',
      reason: 'head-drift',
      detail: `PR #${String(record.pullRequestNumber)} 的 head 已从 ${record.headCommit} 变为 ${observed.headCommit}`,
    }
  }
  if (observed.baseBranch !== record.baseBranch) {
    return {
      kind: 'refused',
      reason: 'base-changed',
      detail: `PR #${String(record.pullRequestNumber)} 的 base 已从 ${record.baseBranch} 变为 ${observed.baseBranch}`,
    }
  }
  if (currentNeedRevision !== record.needRevision) {
    return {
      kind: 'refused',
      reason: 'subject-drift',
      detail: `需求已从修订 ${String(record.needRevision)} 变为 ${String(currentNeedRevision)}，`
        + '等待期间开启的收口输入不再对应当前交付对象，需重新确认',
    }
  }

  const gap: PactFlowReviewGateGap = {
    missingApprovals: Math.max(0, record.requiredApprovals - observed.approvals),
    checks: observed.checks,
  }

  const previouslySucceeded = new Set(
    (record.lastGap?.checks ?? []).filter(check => check.state === 'success').map(check => check.context),
  )
  const regressed = observed.checks.find(check => check.state === 'failure' && previouslySucceeded.has(check.context))
  if (regressed !== undefined) {
    return {
      kind: 'refused',
      reason: 'check-regressed',
      detail: `检查 ${regressed.context} 由成功转为失败`,
    }
  }

  if (gap.missingApprovals === 0 && observed.checks.every(check => check.state === 'success')) {
    return { kind: 'ready', gap }
  }

  const autoRecheckExhausted = record.recheckCount >= record.maxRechecks
  return {
    kind: 'waiting',
    gap,
    autoRecheckExhausted,
    detail: autoRecheckExhausted
      ? `${describeReviewGateGap(gap)}；自动复查已耗尽，可手动复查`
      : describeReviewGateGap(gap),
  }
}

/** Fold one observation back into the durable record. */
export function recordReviewGateObservation(
  record: PactFlowReviewGateRecord,
  verdict: PactFlowReviewGateVerdict,
  now: number,
): PactFlowReviewGateRecord {
  const gap = verdict.kind === 'ready' || verdict.kind === 'waiting' ? verdict.gap : record.lastGap
  return {
    ...record,
    recheckCount: record.recheckCount + 1,
    lastCheckedAt: now,
    ...gap === undefined ? {} : { lastGap: gap },
    ...verdict.kind === 'externally-merged' ? { externallyMerged: true } : {},
  }
}
