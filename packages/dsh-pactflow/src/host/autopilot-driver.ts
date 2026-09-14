import type { Agent } from '@deepseek-ai/dsh-agent'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PactFlowAutopilotRecord, PactFlowReviewGateRecord, PactFlowSnapshot } from '../types.ts'
import { autopilotProgress, autopilotWorkerCounts } from '../autopilot.ts'
import { describeReviewGateGap, reviewGateRecheckDue } from '../review-gate.ts'

export interface AutopilotDriverHost {
  sessions(): readonly Session[]
  agent(session: Session): Agent | undefined
  snapshot(session: Session): PactFlowSnapshot
  check(session: Session, record: PactFlowAutopilotRecord): Promise<void>
  flush(session: Session): Promise<void>
  update(session: Session, record: PactFlowAutopilotRecord, changes: Partial<PactFlowAutopilotRecord>): PactFlowAutopilotRecord | undefined
  block(session: Session, record: PactFlowAutopilotRecord, reason: string, cancel?: boolean): void
  boundedError(error: unknown): string
  /**
   * gitea-review-gate: the Need's durable wait state when closing is held at a
   * protected branch that requires external review, or undefined when it is not.
   */
  reviewGate(session: Session, needId: string): PactFlowReviewGateRecord | undefined
  /** Observe that gate once. Never merges by itself; closing does that. */
  /**
   * Re-observe the review gate. Returns the refusal when the recheck concluded
   * one — head drift, a changed base, a revised subject, a check that regressed
   * from success to failure. Discarding it left the driver repeating the stale
   * gap ("还缺 1 个批准") every 30 seconds while the real reason never surfaced.
   */
  recheckReviewGate(session: Session, needId: string): Promise<{ readonly reason: string; readonly detail: string } | undefined>
}

/** One host-owned driver; browser lifetime never owns continuation. */
export class PactFlowAutopilotDriver {
  private readonly busy = new Set<string>()
  private readonly sent = new Set<string>()
  private stopped = false
  constructor(private readonly host: AutopilotDriverHost) {}

  dispose(): void { this.stopped = true; this.sent.clear() }

  async tick(): Promise<void> {
    if (this.stopped) return
    await Promise.all(this.host.sessions().map(async session => {
      if (this.busy.has(session.id)) return
      const record = Object.values(this.host.snapshot(session).delivery.autopilots ?? {}).find(item => item.state === 'running')
      if (record === undefined) return
      this.busy.add(session.id)
      try { await this.advance(session, record) } catch (error) {
        // advance may already have persisted a newer wake revision before a
        // flush/handoff fails. Block that grant, not the now-stale revision.
        const current = this.host.snapshot(session).delivery.autopilots?.[record.needId]
        if (!this.stopped && current?.id === record.id && current.state === 'running') {
          this.host.block(session, current, this.host.boundedError(error))
        }
      } finally { this.busy.delete(session.id) }
    }))
  }

  private async advance(session: Session, record: PactFlowAutopilotRecord): Promise<void> {
    const snapshot = this.host.snapshot(session)
    const agent = this.host.agent(session)
    if (snapshot.needs.byId[record.needId]?.phase === 'deployed' && snapshot.delivery.releases[record.needId]?.commit) {
      if (agent?.status !== 'running') this.host.update(session, record, { state: 'completed', reason: '代码已验证并完成主分支收口' })
      return
    }
    if (Date.now() >= record.expiresAt) {
      this.host.block(session, record, '挂机运行时长已达到授权上限', true); return
    }
    const gate = this.host.reviewGate(session, record.needId)
    if (gate !== undefined) {
      // Waiting on people and CI outside the platform is neither the model's
      // turn nor a stall. Left alone, the unchanged progress digest would grow
      // stalledTurns until autopilot blocked on "no verifiable progress", and
      // every tick would wake the model to look at a Need only a reviewer can
      // advance — burning the model-step budget on a question it cannot answer.
      if (gate.externallyMerged === true) {
        this.host.block(session, record,
          `PR #${String(gate.pullRequestNumber)} 已在平台外被合并，宿主未核验该合并，需人显式处置`)
        return
      }
      const exhausted = gate.recheckCount >= gate.maxRechecks
      // The driver ticks every second; CI does not. Honour the recheck interval
      // so an unattended wait does not hammer the Gitea API.
      const refusal = reviewGateRecheckDue(gate, Date.now())
        ? await this.host.recheckReviewGate(session, record.needId)
        : undefined
      if (this.stopped) return
      if (refusal !== undefined) {
        // The gate did not merely fail to advance: it concluded the wait cannot
        // be satisfied as recorded. Nobody but a person can resolve that, so say
        // which of them it was rather than repeating the last gap until the
        // recheck ceiling runs out and the wait ends with "自动复查已耗尽".
        this.host.block(session, record,
          `PR #${String(gate.pullRequestNumber)} 的外部评审复查被拒绝（${refusal.reason}）：${refusal.detail}`)
        return
      }
      // Re-read: the recheck may have satisfied the gate and merged, in which
      // case the next tick completes through the ordinary deployed path.
      const settled = this.host.reviewGate(session, record.needId)
      if (settled !== undefined) {
        const reason = exhausted
          ? `等待外部评审（PR #${String(gate.pullRequestNumber)}）：自动复查已耗尽，可手动复查`
          : `等待外部评审（PR #${String(gate.pullRequestNumber)}）：${describeReviewGateGap(settled.lastGap ?? { missingApprovals: settled.requiredApprovals, checks: [] })}`
        // Write only when the wording actually changed. The driver ticks once a
        // second and a reviewer takes hours: an unconditional update would append
        // ~3600 autopilot events per hour into the one durable source of truth,
        // and bump the autopilot revision every second so any concurrent call
        // carrying an expectedRevision would lose its CAS.
        if (record.reason !== reason) this.host.update(session, record, { reason })
        return
      }
    }
    if (agent === undefined || agent.status !== 'idle') return
    const counts = autopilotWorkerCounts(snapshot, record)
    if (counts.active > 0) return
    await this.host.check(session, record)
    if (this.stopped || agent.status !== 'idle') return
    const latest = this.host.snapshot(session).delivery.autopilots?.[record.needId]
    if (latest?.id !== record.id || latest.revision !== record.revision || latest.state !== 'running') return
    const paused = Object.values(snapshot.dag.byId).find(node => node.needId === record.needId && ['paused', 'blocked'].includes(node.state))
    if (paused !== undefined) { this.host.block(session, record, `节点 ${paused.id} 已暂停或阻塞，需要人工处理`); return }
    if (record.modelSteps >= record.limits.maxModelSteps) { this.host.block(session, record, '模型调用次数达到授权上限'); return }
    const seen = record.lastWakeId !== undefined && session.events.some(event => event.type === 'user/message' && event.data.id === record.lastWakeId)
    if (record.lastWakeId !== undefined && this.sent.has(record.lastWakeId) && !seen) return
    if (record.lastWakeId !== undefined) this.sent.delete(record.lastWakeId)
    const progress = autopilotProgress(snapshot, record.needId)
    const stalledTurns = seen && record.lastProgressDigest === progress ? record.stalledTurns + 1 : 0
    if (stalledTurns >= record.limits.maxStalledTurns) { this.host.block(session, record, '连续多轮没有可验证进展，停止空转并等待处理'); return }
    const message = createUserMessage({
      source: { kind: 'plugin', plugin: 'dsh-pactflow/autopilot', form: 'notice', summary: `继续挂机需求 ${record.needId}` },
      content: [{ type: 'text', text: [
        `宿主挂机续跑（不是用户新指令）。仅推进需求 ${record.needId}，目标：${snapshot.needs.byId[record.needId]?.title}。`,
        `授权终点：验证通过并合并 ${record.repository} 的 ${record.branch} 分支，不部署。`,
        '先读取 pactflow_view。按当前阶段和真实证据推进；有效预授权下计划选择与评审由宿主策略处理，不请求重复人工确认。',
        '优先完整单节点交付；把修复、测试和记录作为节点内部职责。使用已批准的精确指令和执行规格。',
        '失败时在原范围和预算内修复复验；不得降低测试标准、伪造通过、扩大资源或改变需求。',
        '缺少必要业务决定、权限或不可恢复条件时调用 pactflow_block_autopilot 报告阻塞。',
        '完成阶段工作后继续下一步；只有宿主交付记录成立才能宣称完成。',
      ].join('\n') }],
    })
    const saved = this.host.update(session, record, { wakeCount: record.wakeCount + 1, lastWakeId: message.id,
      lastProgressDigest: progress, stalledTurns, reason: `正在推进 ${snapshot.needs.byId[record.needId]?.phase ?? '当前阶段'}` })
    if (saved === undefined || this.stopped) return
    await this.host.flush(session)
    const current = this.host.snapshot(session).delivery.autopilots?.[record.needId]
    if (this.stopped || current?.id !== saved.id || current.state !== 'running' || current.lastWakeId !== message.id || agent.status !== 'idle') return
    this.sent.add(message.id)
    agent.followup(message)
  }
}
