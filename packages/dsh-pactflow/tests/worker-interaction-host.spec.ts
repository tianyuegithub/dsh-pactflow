import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import SessionStore, { SessionId, type Session } from '@deepseek-ai/dsh-session'
import { SessionProjectionRegistry } from '@deepseek-ai/dsh-session-projection'
import JsonlSessionPersistence from '@deepseek-ai/dsh-session-persistence-jsonl'
import { describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'
import { PactFlowWorkerInteractions } from '../src/host/worker-interactions.ts'
import { signWorkerAnswer } from '../src/host/interaction-signing.ts'
import { WORKER_INTERACTION_PROTOCOL } from '../src/worker-interaction-types.ts'
import type { WorkerBridgeAnswer, WorkerBridgeMessage, WorkerInteractionRequest } from '../src/worker-interaction-types.ts'
import { PactFlowRunId, type PactFlowAutopilotRecord, type PactFlowK3sRunSpec, type PactFlowRun, type PactFlowSnapshot } from '../src/types.ts'

const BOOT_ID = '11111111-2222-3333-4444-555555555555'
const OTHER_BOOT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
const POD_UID = 'pod-fixture'

async function contextWithPersistence(root: string): Promise<Context> {
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(SessionProjectionRegistry)
  await ctx.plugin(PactFlowService)
  Reflect.get(ctx.pactflow, 'workerInteractions').dispose()
  Reflect.get(ctx.pactflow, 'autopilotDriver').dispose()
  await ctx.plugin(JsonlSessionPersistence, { root, compression: 'none' })
  return ctx
}

function snapshot(ctx: Context, session: Session): PactFlowSnapshot {
  return Reflect.get(ctx.pactflow, 'snapshotOfLive').call(ctx.pactflow, session) as PactFlowSnapshot
}

function k3sFixture(publicKey: string, runId: string): PactFlowK3sRunSpec {
  return {
    interactionPublicKey: publicKey,
    interactionRunId: runId,
    interactionProtocol: WORKER_INTERACTION_PROTOCOL,
    templateId: 'dsh',
    namespace: 'pactflow',
    jobName: 'interaction-job',
    jobUid: 'job-fixture',
    configMapName: 'interaction-config',
    image: `registry.invalid/worker@sha256:${'a'.repeat(64)}`,
    imagePullSecret: 'pull-secret',
    harness: 'dsh',
    apiMode: 'openai-chat-completions',
    model: 'test-model',
    baseUrl: 'https://model.invalid',
    modelSecretName: 'model-secret',
    runNonceHash: 'b'.repeat(64),
    claimTokenHash: 'c'.repeat(64),
    specDigest: 'd'.repeat(64),
    gitSecretName: 'git-secret',
    cpuRequest: '100m',
    memoryRequest: '128Mi',
    cpuLimit: '1',
    memoryLimit: '1Gi',
    activeDeadlineSeconds: 3_600,
    finishedJobTtlSeconds: 86_400,
  }
}

function approvalRequest(overrides: Partial<WorkerInteractionRequest> = {}): WorkerInteractionRequest {
  const createdAt = Date.now()
  return {
    protocol: WORKER_INTERACTION_PROTOCOL,
    bootId: BOOT_ID,
    requestId: 'approval-request',
    kind: 'approval',
    createdAt,
    expiresAt: createdAt + 600_000,
    title: 'Approve execution',
    detail: 'Run the bounded action',
    toolName: 'bash',
    ...overrides,
  }
}

interface TransportPort {
  readonly send: ReturnType<typeof vi.fn>
  readonly close: ReturnType<typeof vi.fn>
  readonly connect: ReturnType<typeof vi.fn>
  readonly fail: ReturnType<typeof vi.fn>
  disconnect(): void
  emit(broker: PactFlowWorkerInteractions, session: Session, run: PactFlowRun, message: WorkerBridgeMessage): Promise<void>
}

function transportPort(): TransportPort {
  let receive: ((message: WorkerBridgeMessage, podUid: string) => void) | undefined
  let disconnected: (() => void) | undefined
  const send = vi.fn(async (_answer: WorkerBridgeAnswer) => {})
  const close = vi.fn()
  const connect = vi.fn(async (
    _run: PactFlowRun,
    next: (message: WorkerBridgeMessage, podUid: string) => void,
    onDisconnected: () => void,
  ) => {
    receive = next
    disconnected = onDisconnected
    return { podUid: POD_UID, send, close }
  })
  const fail = vi.fn(async () => {})
  return {
    send,
    close,
    connect,
    fail,
    disconnect: () => {
      if (disconnected === undefined) throw new Error('Interaction transport is not connected')
      disconnected()
    },
    emit: async (broker, session, run, message) => {
      if (receive === undefined) throw new Error('Interaction transport is not connected')
      receive(message, POD_UID)
      const link = (Reflect.get(broker, 'links') as Map<string, { chain: Promise<void> }>).get(`${session.id}:${run.id}`)
      if (link === undefined) throw new Error('Interaction link is missing')
      await link.chain
    },
  }
}

async function harness(options: { readonly autopilotExpiresAt?: number } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pactflow-worker-host-'))
  const persistenceRoot = join(root, 'sessions')
  const previousDshHome = process.env.DSH_HOME
  process.env.DSH_HOME = root
  const keys = generateKeyPairSync('ed25519')
  const publicKey = keys.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKey = keys.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const ctx = await contextWithPersistence(persistenceRoot)
  const session = ctx.sessions.create(SessionId('worker-interaction-host'), { meta: { agentPreset: 'pactflow' } })
  ctx.pactflow.initialize(session.id, { name: 'Worker interaction host' })
  ctx.pactflow.createNeed(session.id, { id: 'need', title: 'Need', description: '' })
  const node = ctx.pactflow.createNode(session.id, { id: 'node', needId: 'need', title: 'Node', dependencies: [] })
  const autopilot: PactFlowAutopilotRecord | undefined = options.autopilotExpiresAt === undefined ? undefined : {
    id: 'autopilot-fixture',
    needId: 'need',
    revision: 1,
    state: 'running',
    scopeDigest: 'e'.repeat(64),
    repository: '/fixture/repository',
    branch: 'main',
    limits: { maxDurationMs: 3_600_000, maxModelSteps: 20, maxWorkerStarts: 10, maxConcurrency: 1, maxStalledTurns: 3 },
    startedAt: Date.now(),
    expiresAt: options.autopilotExpiresAt,
    startSequence: session.events.length,
    initialRunIds: [],
    modelSteps: 0,
    wakeCount: 0,
    stalledTurns: 0,
    updatedAt: Date.now(),
    reason: 'fixture running authorization',
  }
  if (autopilot !== undefined) {
    Reflect.get(ctx.pactflow, 'events').append(session, 'pactflow/autopilot-updated', { v: 1, record: autopilot })
  }
  const runId = PactFlowRunId('run-11111111-2222-3333-4444-555555555555')
  const claimed = Reflect.get(ctx.pactflow, 'claimNodeInSession').call(ctx.pactflow, session, {
    nodeId: node.id,
    expectedRevision: node.revision,
    provider: 'k3s:dsh',
    leaseDurationMs: 3_600_000,
  }, { runId, k3s: k3sFixture(publicKey, runId) }) as { run: PactFlowRun }
  if (autopilot !== undefined) {
    Reflect.get(ctx.pactflow, 'events').append(session, 'pactflow/autopilot-updated', {
      v: 1,
      record: { ...autopilot, revision: 2, state: 'paused', updatedAt: Date.now(), reason: 'fixture paused authorization' },
    })
  }
  const port = transportPort()
  let flushFailure: Error | undefined
  const trace: string[] = []
  const makeBroker = (
    targetCtx = ctx,
    targetSession = session,
    targetPort = port,
    flushPort?: (session: Session) => Promise<void>,
  ) => new PactFlowWorkerInteractions({
    sessions: () => [targetSession],
    snapshot: current => snapshot(targetCtx, current),
    append: (current, record) => {
      Reflect.get(targetCtx.pactflow, 'events').append(current, 'pactflow/worker-interaction', { v: 1, record })
    },
    flush: flushPort ?? (async current => {
      trace.push('flush')
      if (flushFailure !== undefined) throw flushFailure
      if (!await targetCtx.sessions.flush(current)) throw new Error('flush unavailable')
    }),
    connect: targetPort.connect,
    fail: targetPort.fail,
    sign: async (_run, unsigned) => signWorkerAnswer(unsigned, privateKey),
    bounded: error => error instanceof Error ? error.message : String(error),
  })
  const broker = makeBroker()
  await broker.tick()
  await Promise.resolve()

  async function emit(message: WorkerBridgeMessage, targetBroker = broker, targetPort = port, targetSession = session, targetRun = claimed.run) {
    await targetPort.emit(targetBroker, targetSession, targetRun, message)
  }

  async function establish(request = approvalRequest()) {
    await emit({ type: 'hello', protocol: WORKER_INTERACTION_PROTOCOL, bootId: BOOT_ID })
    await emit({ type: 'request', request })
    const id = `${claimed.run.id}:${request.bootId}:${request.requestId}`
    return { request, id, record: snapshot(ctx, session).delivery.workerInteractions![id]! }
  }

  return {
    root,
    persistenceRoot,
    ctx,
    session,
    run: claimed.run,
    broker,
    port,
    trace,
    makeBroker,
    establish,
    emit,
    setFlushFailure: (error: Error | undefined) => { flushFailure = error },
    finish: async () => {
      broker.dispose()
      await ctx.fiber.dispose()
      if (previousDshHome === undefined) delete process.env.DSH_HOME
      else process.env.DSH_HOME = previousDshHome
      await rm(root, { recursive: true, force: true })
    },
  }
}

describe('PactFlowWorkerInteractions host persistence boundary', () => {
  it('persists pending and answered before send, then marks only the matching acknowledgement delivered', async () => {
    const h = await harness()
    try {
      const { request, record } = await h.establish()
      expect(record).toMatchObject({ state: 'pending', request, runId: h.run.id, podUid: POD_UID })
      h.trace.length = 0
      h.port.send.mockImplementationOnce(async () => { h.trace.push('send') })
      const answered = await h.broker.answer(h.session, {
        id: record.id,
        expectedRevision: record.revision,
        expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })
      expect(answered).toMatchObject({ state: 'answered', answer: { decision: 'approve' } })
      expect(h.trace).toEqual(['flush', 'flush', 'send'])
      expect(snapshot(h.ctx, h.session).delivery.workerInteractions![record.id]!.state).toBe('answered')

      await h.emit({
        type: 'settled', bootId: request.bootId, requestId: request.requestId, digest: record.digest,
      })
      expect(snapshot(h.ctx, h.session).delivery.workerInteractions![record.id]).toMatchObject({
        state: 'delivered', answer: { decision: 'approve' },
      })
    } finally {
      await h.finish()
    }
  })

  it('sends nothing when answer persistence fails and retries only after a successful flush', async () => {
    const h = await harness()
    try {
      const { record } = await h.establish()
      h.setFlushFailure(new Error('jsonl flush failed'))
      await expect(h.broker.answer(h.session, {
        id: record.id, expectedRevision: record.revision, expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })).rejects.toThrow('jsonl flush failed')
      expect(h.port.send).not.toHaveBeenCalled()

      h.setFlushFailure(undefined)
      await h.broker.tick()
      expect(h.port.send).toHaveBeenCalledTimes(1)
      expect(h.port.send.mock.calls[0]![0]).toMatchObject({ answer: { decision: 'approve' } })
    } finally {
      await h.finish()
    }
  })

  it.each(['changed-content', 'other-boot'] as const)('rejects replayed identity with %s', async variant => {
    const h = await harness()
    try {
      const { request, record } = await h.establish()
      const replay = variant === 'changed-content'
        ? { ...request, detail: 'changed after first receipt' }
        : { ...request, bootId: OTHER_BOOT_ID }
      await h.emit({ type: 'request', request: replay })
      expect(h.port.fail).toHaveBeenCalledTimes(1)
      expect(snapshot(h.ctx, h.session).delivery.workerInteractions![record.id]).toEqual(record)
    } finally {
      await h.finish()
    }
  })

  it('rejects a duplicate user submission without changing the saved answer', async () => {
    const h = await harness()
    try {
      const { record } = await h.establish()
      const answered = await h.broker.answer(h.session, {
        id: record.id, expectedRevision: record.revision, expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })
      await expect(h.broker.answer(h.session, {
        id: answered.id, expectedRevision: answered.revision, expectedDigest: answered.digest,
        answer: { decision: 'reject' },
      })).rejects.toThrow(/过期、结束或状态发生变化/)
      expect(snapshot(h.ctx, h.session).delivery.workerInteractions![record.id]!.answer).toEqual({ decision: 'approve' })
    } finally {
      await h.finish()
    }
  })

  it('rejects an answer after the owning Run reaches a terminal state', async () => {
    const h = await harness()
    try {
      const { record } = await h.establish()
      h.ctx.pactflow.settleRun(h.session.id, {
        runId: h.run.id,
        claimId: h.run.claimId,
        expectedNodeRevision: h.run.nodeRevision,
        state: 'cancelled',
        outcome: 'test terminal state',
      })
      await expect(h.broker.answer(h.session, {
        id: record.id, expectedRevision: record.revision, expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })).rejects.toThrow(/过期、结束或状态发生变化/)
      expect(h.port.send).not.toHaveBeenCalled()
    } finally {
      await h.finish()
    }
  })

  it('caps a remote future deadline at fifteen minutes from Host receipt', async () => {
    const h = await harness()
    vi.useFakeTimers({ toFake: ['Date'] })
    const receivedAt = Date.now()
    vi.setSystemTime(receivedAt)
    try {
      const request = approvalRequest({
        createdAt: receivedAt + 86_400_000,
        expiresAt: receivedAt + 86_400_000 + 900_000,
      })
      const { record } = await h.establish(request)
      expect(record.expiresAt).toBe(receivedAt + 900_000)
    } finally {
      vi.useRealTimers()
      await h.finish()
    }
  })

  it('keeps the fixed running-autopilot deadline after pause and rejects an answer at expiry', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const grantedAt = 1_800_000_000_000
    const authorizationExpiresAt = grantedAt + 300_000
    vi.setSystemTime(grantedAt)
    let h: Awaited<ReturnType<typeof harness>> | undefined
    try {
      h = await harness({ autopilotExpiresAt: authorizationExpiresAt })
      expect(snapshot(h.ctx, h.session).delivery.autopilots?.need).toMatchObject({
        state: 'paused', expiresAt: authorizationExpiresAt,
      })
      const { record } = await h.establish(approvalRequest({
        createdAt: grantedAt,
        expiresAt: grantedAt + 600_000,
      }))
      expect(record).toMatchObject({ state: 'pending', expiresAt: authorizationExpiresAt })

      vi.setSystemTime(authorizationExpiresAt)
      await expect(h.broker.answer(h.session, {
        id: record.id,
        expectedRevision: record.revision,
        expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })).rejects.toThrow(/过期、结束或状态发生变化/)
      expect(h.port.send).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      if (h !== undefined) await h.finish()
    }
  })

  it('reconnects after a brief outage even when the preceding healthy handshake is older than 120 seconds', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const connectedAt = 1_800_000_000_000
    vi.setSystemTime(connectedAt)
    let h: Awaited<ReturnType<typeof harness>> | undefined
    try {
      h = await harness()
      await h.emit({ type: 'hello', protocol: WORKER_INTERACTION_PROTOCOL, bootId: BOOT_ID })
      expect(h.port.connect).toHaveBeenCalledTimes(1)

      vi.setSystemTime(connectedAt + 121_000)
      await h.broker.tick()
      expect(h.port.fail).not.toHaveBeenCalled()
      h.port.disconnect()

      vi.setSystemTime(connectedAt + 123_001)
      await h.broker.tick()
      await Promise.resolve()
      expect(h.port.connect).toHaveBeenCalledTimes(2)
      expect(h.port.fail).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
      if (h !== undefined) await h.finish()
    }
  })

  it('restores an answered record from JSONL and resends the original answer after same-boot reconnect', async () => {
    const h = await harness()
    let reader: Context | undefined
    let restoredBroker: PactFlowWorkerInteractions | undefined
    let detachRestored: (() => void) | undefined
    try {
      const { record } = await h.establish()
      const answered = await h.broker.answer(h.session, {
        id: record.id, expectedRevision: record.revision, expectedDigest: record.digest,
        answer: { decision: 'approve' },
      })
      expect(answered.state).toBe('answered')
      await h.ctx.sessions.flush(h.session)
      h.broker.dispose()

      const stored = await h.ctx.sessionPersistence.load(h.session.id)
      reader = await contextWithPersistence(h.persistenceRoot)
      const restoredSession = reader.sessions.prepare(h.session.id, {
        seed: structuredClone([...stored.events]),
        meta: structuredClone(stored.meta),
        seedSource: 'persistence',
      })
      detachRestored = reader.sessions.enter(restoredSession)
      reader.sessions.announce(restoredSession)
      const restoredRun = snapshot(reader, restoredSession).runs.byId[h.run.id]!
      expect(snapshot(reader, restoredSession).delivery.workerInteractions![record.id]).toMatchObject({
        state: 'answered', answer: { decision: 'approve' },
      })

      const restoredPort = transportPort()
      restoredBroker = h.makeBroker(reader, restoredSession, restoredPort, async current => {
        if (!await reader!.sessions.flush(current)) throw new Error('restored flush unavailable')
      })
      await restoredBroker.tick()
      await Promise.resolve()
      await restoredPort.emit(restoredBroker, restoredSession, restoredRun, {
        type: 'hello', protocol: WORKER_INTERACTION_PROTOCOL, bootId: BOOT_ID,
      })
      await restoredBroker.tick()
      expect(restoredPort.send).toHaveBeenCalledTimes(1)
      expect(restoredPort.send.mock.calls[0]![0]).toMatchObject({
        runId: h.run.id,
        podUid: POD_UID,
        answer: { decision: 'approve' },
      })
    } finally {
      restoredBroker?.dispose()
      detachRestored?.()
      if (reader !== undefined) await reader.fiber.dispose()
      await h.finish()
    }
  })
})
