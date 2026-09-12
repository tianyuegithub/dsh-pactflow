import { redactWorkerArguments } from '../worker/redact.ts'
import type { Session } from '@deepseek-ai/dsh-session'
import type { PactFlowRun, PactFlowSnapshot } from '../types.ts'
import { executionDigest } from '../execution-plan.ts'
import { workerInteractionRequestSchema, validateWorkerAnswer } from '../worker-interactions.ts'
import { WORKER_INTERACTION_PROTOCOL, type WorkerInteractionRecord, type AnswerWorkerInteractionRequest, type WorkerBridgeMessage, type WorkerBridgeAnswer } from '../worker-interaction-types.ts'
type Channel = { podUid: string; send(answer: WorkerBridgeAnswer): Promise<void>; close(): void }
interface Link { generation: number; channel?: Channel | undefined; bootId?: string | undefined; podUid?: string; connecting: boolean; connectedAt: number; retryAt: number; outageSince?: number | undefined; chain: Promise<void>; closed: boolean }
export interface WorkerInteractionHost {
  sessions(): readonly Session[]
  snapshot(session: Session): PactFlowSnapshot
  append(session: Session, record: WorkerInteractionRecord): void
  flush(session: Session): Promise<void>
  connect(run: PactFlowRun, receive: (message: WorkerBridgeMessage, podUid: string) => void, close: () => void): Promise<Channel | undefined>
  fail(session: Session, run: PactFlowRun, reason: string): Promise<void>
  sign(run: PactFlowRun, answer: Omit<WorkerBridgeAnswer, 'signature'>): Promise<WorkerBridgeAnswer>
  bounded(error: unknown): string
}
export class PactFlowWorkerInteractions {
  private links = new Map<string, Link>()
  private stopped = false
  private ticking = false
  constructor(private readonly host: WorkerInteractionHost) {}
  dispose(): void { this.stopped = true; for (const link of this.links.values()) { link.closed = true; link.channel?.close() }; this.links.clear() }
  private records(session: Session) { return this.host.snapshot(session).delivery.workerInteractions ?? {} }
  private live(session: Session, run: PactFlowRun): boolean {
    if (!['claimed', 'running', 'blocked'].includes(run.state)) return false
    const authority = this.authorityAtClaim(session, run)
    if (!authority) return true
    const latest = session.events.findLast(event => event.type === 'pactflow/autopilot-updated' && event.data.record.id === authority.id)
    return Date.now() < authority.expiresAt && !(latest?.type === 'pactflow/autopilot-updated' && latest.data.record.state === 'stopped')
  }
  private authorityAtClaim(session: Session, run: PactFlowRun) {
    const needId = this.host.snapshot(session).dag.byId[run.nodeId]?.needId
    const claimedIndex = session.events.findIndex(event => event.type === 'pactflow/run-claimed' && event.data.run.id === run.id)
    for (let index = claimedIndex - 1; index >= 0; index--) {
      const event = session.events[index]!
      if (event.type === 'pactflow/autopilot-updated' && event.data.record.needId === needId) return event.data.record.state === 'running' ? event.data.record : undefined
    }
    return undefined
  }
  private claimedAt(session: Session, run: PactFlowRun): number {
    const event = session.events.find(event => event.type === 'pactflow/run-claimed' && event.data.run.id === run.id)
    return event?.type === 'pactflow/run-claimed' ? event.data.run.updatedAt : run.updatedAt
  }
  private change(session: Session, record: WorkerInteractionRecord, changes: Partial<WorkerInteractionRecord>): WorkerInteractionRecord {
    const current = this.records(session)[record.id]
    if (current?.revision !== record.revision) throw new Error('交互状态已变化，请刷新')
    const next = { ...record, ...changes, revision: record.revision + 1, updatedAt: Date.now() }
    this.host.append(session, next); return next
  }
  async answer(session: Session, request: AnswerWorkerInteractionRequest): Promise<WorkerInteractionRecord> {
    const record = this.records(session)[request.id]
    const run = record && this.host.snapshot(session).runs.byId[record.runId]
    if (!record || record.sessionId !== session.id || record.revision !== request.expectedRevision || record.digest !== request.expectedDigest
      || record.state !== 'pending' || !run || !this.live(session, run) || Date.now() >= record.expiresAt) throw new Error('该交互已过期、结束或状态发生变化')
    const answer = validateWorkerAnswer(record.request, request.answer)
    if (Buffer.byteLength(JSON.stringify(answer)) > 60000) throw new Error('答案内容过长')
    if (executionDigest(answer) !== executionDigest(JSON.parse(redactWorkerArguments(JSON.stringify(answer))))) throw new Error('请使用凭证引用，不要在回答中填写密钥')
    const next = this.change(session, record, { state: 'answered', answer, reason: '用户答案已保存，等待执行器收讫' })
    await this.host.flush(session)
    await this.deliver(session, next)
    return this.records(session)[record.id]!
  }
  private async deliver(session: Session, record: WorkerInteractionRecord): Promise<void> {
    const link = this.links.get(`${session.id}:${record.runId}`)
    if (!link?.channel || link.closed || link.bootId !== record.request.bootId || link.podUid !== record.podUid) return
    const channel = link.channel
    await this.host.flush(session)
    const current = this.records(session)[record.id]
    const run = this.host.snapshot(session).runs.byId[record.runId]
    if (!current || current.state !== 'answered' || current.revision !== record.revision || !run || !this.live(session, run) || Date.now() >= record.expiresAt) return
    const signed = await this.host.sign(run, { runId: record.runId, podUid: record.podUid, expiresAt: record.expiresAt, type: 'answer', bootId: record.request.bootId, requestId: record.request.requestId, digest: record.digest, answer: record.answer! })
    if (this.stopped || link.closed || link.channel !== channel || this.records(session)[record.id]?.state !== 'answered' || !this.live(session, this.host.snapshot(session).runs.byId[record.runId]!)) return
    try { await channel.send(signed) }
    catch { channel.close(); if (link.channel === channel) link.channel = undefined; link.retryAt = Date.now() + 2000 }
  }
  async tick(): Promise<void> {
    if (this.stopped || this.ticking) return
    this.ticking = true
    try {
      const keep = new Set<string>()
      for (const session of this.host.sessions()) {
        const snapshot = this.host.snapshot(session)
        for (const record of Object.values(this.records(session))) {
          if (!['pending', 'answered'].includes(record.state)) continue
          const run = snapshot.runs.byId[record.runId]
          if (!run || !this.live(session, run)) this.change(session, record, { state: 'cancelled', reason: '执行任务已结束或停止' })
          else if (Date.now() >= record.expiresAt) {
            this.change(session, record, { state: 'expired', reason: '等待人工处理已达到期限' })
            await this.host.fail(session, run, '远程交互等待超时，保留现场')
          }
        }
        for (const run of Object.values(snapshot.runs.byId)) {
          if (run.k3s?.interactionProtocol !== WORKER_INTERACTION_PROTOCOL || !run.k3s.jobUid || !this.live(session, run)) continue
          const key = `${session.id}:${run.id}`; keep.add(key)
          let link = this.links.get(key)
          if (!link) { link = { generation: 0, connecting: false, connectedAt: Date.now(), retryAt: 0, outageSince: Date.now(), chain: Promise.resolve(), closed: false }; this.links.set(key, link) }
          if (link.channel) {
            if ((!link.bootId && Date.now() - link.connectedAt > 30000) || (link.outageSince !== undefined && Date.now() - link.outageSince > 120000)) { await this.host.fail(session, run, '执行器交互握手超时'); continue }
            for (const record of Object.values(this.records(session))) if (record.runId === run.id && record.state === 'answered') await this.deliver(session, record)
            continue
          }
          if (link.connecting || Date.now() < link.retryAt) continue
          if (link.outageSince !== undefined && Date.now() - link.outageSince > 120000) { await this.host.fail(session, run, '执行器交互通道持续不可用，已停止等待'); continue }
          this.open(session, run, link)
        }
      }
      for (const [key, link] of this.links) if (!keep.has(key)) { link.closed = true; link.channel?.close(); this.links.delete(key) }
    } finally { this.ticking = false }
  }
  private open(session: Session, run: PactFlowRun, link: Link): void {
    link.connecting = true
    const generation = ++link.generation
    link.bootId = undefined; link.connectedAt = Date.now()
    let disconnected = false
    void this.host.connect(run, (message, podUid) => {
      link.chain = link.chain.then(async () => {
        if (this.stopped || link.closed || generation !== link.generation) return
        await this.receive(session, run, link, message, podUid)
      }).catch(async error => {
        link.closed = true; link.channel?.close()
        await this.host.fail(session, run, this.host.bounded(error))
      })
    }, () => { if (generation !== link.generation) return; disconnected = true; link.outageSince ??= Date.now(); link.channel = undefined; link.retryAt = Date.now() + 2000 }).then(channel => {
      if (this.stopped || link.closed || disconnected || generation !== link.generation) { channel?.close(); return }
      link.channel = channel
      if (!channel) link.retryAt = Date.now() + 2000
    }).catch(() => { link.retryAt = Date.now() + 2000 }).finally(() => { link.connecting = false })
  }
  private async receive(session: Session, initial: PactFlowRun, link: Link, message: WorkerBridgeMessage, podUid: string): Promise<void> {
    const run = this.host.snapshot(session).runs.byId[initial.id]
    if (!run || !this.live(session, run) || run.k3s?.jobUid !== initial.k3s?.jobUid) throw new Error('执行器运行身份已变化')
    if (message?.type === 'hello') {
      if (message.protocol !== WORKER_INTERACTION_PROTOCOL || typeof message.bootId !== 'string' || !/^[a-f0-9-]{36}$/.test(message.bootId)) throw new Error('执行器协议握手无效')
      for (const record of Object.values(this.records(session))) if (record.runId === run.id && ['pending', 'answered'].includes(record.state)
        && (record.podUid !== podUid || record.request.bootId !== message.bootId)) this.change(session, record, { state: 'cancelled', reason: '原执行进程已结束，旧答案不可复用' })
      link.bootId = message.bootId; link.podUid = podUid; link.connectedAt = Date.now(); link.outageSince = undefined; return
    }
    if (!link.bootId || link.podUid !== podUid) throw new Error('未完成执行器握手')
    if (message?.type === 'request') {
      const request = workerInteractionRequestSchema.parse(message.request)
      if (executionDigest(request) !== executionDigest(JSON.parse(redactWorkerArguments(JSON.stringify(request))))) throw new Error('交互含有未清理的敏感信息，拒绝持久化')
      if (request.bootId !== link.bootId) throw new Error('执行器启动身份不匹配')
      const id = `${run.id}:${request.bootId}:${request.requestId}`
      const prior = this.records(session)[id]; const digest = executionDigest(request)
      if (prior) {
        if (prior.digest !== digest || prior.podUid !== podUid) throw new Error('重复交互内容被修改')
        if (prior.state === 'answered') await this.deliver(session, prior)
        return
      }
      const sameRun = Object.values(this.records(session)).filter(record => record.runId === run.id)
      if (sameRun.length >= 32 || sameRun.some(record => ['pending', 'answered'].includes(record.state))) throw new Error('执行器待处理问题数量超限')
      const snapshot = this.host.snapshot(session); const needId = snapshot.dag.byId[run.nodeId]!.needId
      const auto = this.authorityAtClaim(session, run)
      const now = Date.now()
      const expiresAt = Math.min(now + 900000, request.expiresAt, this.claimedAt(session, run) + run.k3s!.activeDeadlineSeconds * 1000,
        auto?.expiresAt ?? Infinity)
      if (expiresAt <= now) throw new Error('执行器交互已过期')
      this.host.append(session, { id, sessionId: session.id, needId, runId: run.id, podUid, revision: 1,
        request, digest, expiresAt, state: 'pending', updatedAt: now, reason: '执行代理等待人工处理' })
      await this.host.flush(session); return
    }
    if (message?.type !== 'settled' && message?.type !== 'withdrawn') throw new Error('未知执行器交互消息')
    if (message.bootId !== link.bootId) throw new Error('迟到的执行器交互消息')
    const id = `${run.id}:${message.bootId}:${message.requestId}`; const record = this.records(session)[id]
    if (!record || record.podUid !== podUid) throw new Error('交互来源不匹配')
    if (message.type === 'settled') {
      if (message.digest !== record.digest || !record.answer) throw new Error('未授权的交互收讫')
      if (record.state === 'answered') { this.change(session, record, { state: 'delivered', reason: '执行器已收到答案' }); await this.host.flush(session) }
    } else if (['pending', 'answered'].includes(record.state)) this.change(session, record, { state: 'cancelled', reason: '执行器撤回了问题' })
  }
}
