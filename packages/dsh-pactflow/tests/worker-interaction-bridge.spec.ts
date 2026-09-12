import { once } from 'node:events'
import { generateKeyPairSync } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { createConnection, type Socket } from 'node:net'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { executionDigest } from '../src/execution-plan.ts'
import { signWorkerAnswer } from '../src/host/interaction-signing.ts'
import { DshWorkerInteractionBridge } from '../src/worker/bridge.ts'
import { applyWorkerInteraction } from '../src/worker-interactions.ts'
import type {
  WorkerBridgeAnswer,
  WorkerBridgeMessage,
  WorkerInteractionAnswer,
  WorkerInteractionRecord,
  WorkerInteractionRequest,
} from '../src/worker-interaction-types.ts'

interface Peer {
  readonly socket: Socket
  readonly closed: Promise<void>
  readonly seen: readonly WorkerBridgeMessage[]
  next(type: WorkerBridgeMessage['type']): Promise<WorkerBridgeMessage>
  send(message: WorkerBridgeAnswer): void
}

async function connectPeer(socketPath: string): Promise<Peer> {
  const socket = createConnection(socketPath)
  socket.setEncoding('utf8')
  const queued: WorkerBridgeMessage[] = []
  const seen: WorkerBridgeMessage[] = []
  const waiters: {
    readonly type: WorkerBridgeMessage['type']
    readonly resolve: (message: WorkerBridgeMessage) => void
    readonly reject: (error: Error) => void
    readonly timer: ReturnType<typeof setTimeout>
  }[] = []
  let buffer = ''
  socket.on('data', chunk => {
    buffer += chunk
    let end: number
    while ((end = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, end)
      buffer = buffer.slice(end + 1)
      if (line.length === 0) continue
      const message = JSON.parse(line) as WorkerBridgeMessage
      seen.push(message)
      const index = waiters.findIndex(waiter => waiter.type === message.type)
      if (index < 0) queued.push(message)
      else {
        const [waiter] = waiters.splice(index, 1)
        clearTimeout(waiter!.timer)
        waiter!.resolve(message)
      }
    }
  })
  const closed = new Promise<void>(resolve => { socket.once('close', () => resolve()) })
  await once(socket, 'connect')
  return {
    socket,
    closed,
    seen,
    next: async type => {
      const index = queued.findIndex(message => message.type === type)
      if (index >= 0) return queued.splice(index, 1)[0]!
      return await new Promise<WorkerBridgeMessage>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`等待 bridge 消息超时：${type}`)), 2_000)
        waiters.push({ type, resolve, reject, timer })
      })
    },
    send: message => { socket.write(`${JSON.stringify(message)}\n`) },
  }
}

async function harness() {
  const root = await mkdtemp('/tmp/pf-wi-')
  const socketPath = join(root, 's')
  const pair = generateKeyPairSync('ed25519')
  const publicKey = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString()
  const privateKey = pair.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString()
  const bridge = new DshWorkerInteractionBridge(socketPath, undefined, {
    publicKey,
    runId: 'run-fixture',
    podUid: 'pod-fixture',
  })
  const peers = new Set<Peer>()
  await bridge.listen()
  return {
    bridge,
    privateKey,
    peer: async () => {
      const peer = await connectPeer(socketPath)
      peers.add(peer)
      return peer
    },
    finish: async () => {
      for (const peer of peers) peer.socket.destroy()
      await bridge.close()
      await rm(root, { recursive: true, force: true })
    },
  }
}

async function requestFrom(peer: Peer): Promise<WorkerInteractionRequest> {
  const message = await peer.next('request')
  expect(message.type).toBe('request')
  if (message.type !== 'request') throw new Error('Expected request')
  return message.request
}

function response(
  request: WorkerInteractionRequest,
  answer: WorkerInteractionAnswer,
  privateKey: string,
  overrides: Partial<Omit<WorkerBridgeAnswer, 'signature'>> = {},
): WorkerBridgeAnswer {
  return signWorkerAnswer({
    type: 'answer',
    bootId: request.bootId,
    requestId: request.requestId,
    digest: executionDigest(request),
    answer,
    runId: 'run-fixture',
    podUid: 'pod-fixture',
    expiresAt: request.expiresAt,
    ...overrides,
  }, privateKey)
}

describe('DshWorkerInteractionBridge', () => {
  it('only resolves an approval Promise for its exact request identity', async () => {
    const h = await harness()
    try {
      const first = await h.peer()
      const pending = h.bridge.ask({ kind: 'approval', title: 'Approve command', detail: 'run check', toolName: 'bash' })
      let resolved = false
      void pending.then(() => { resolved = true }, () => {})
      const request = await requestFrom(first)
      first.send(response(request, { decision: 'approve' }, h.privateKey, { requestId: 'another-request' }))
      await first.closed
      expect(resolved).toBe(false)

      const second = await h.peer()
      const replayed = await requestFrom(second)
      expect(replayed).toEqual(request)
      second.send(response(replayed, { decision: 'approve' }, h.privateKey))
      await expect(pending).resolves.toEqual({ decision: 'approve' })
    } finally {
      await h.finish()
    }
  })

  it('returns exact single-select, multi-select, and allowed custom answers', async () => {
    const h = await harness()
    try {
      const peer = await h.peer()
      const pending = h.bridge.ask({
        kind: 'question', title: 'Choose execution', detail: '', questions: [
          { id: 'single', question: 'Choose one', options: [{ label: 'A' }, { label: 'B' }] },
          { id: 'multi', question: 'Choose many', options: [{ label: 'X' }, { label: 'Y' }], multiSelect: true },
          { id: 'custom', question: 'Or describe', options: [{ label: 'Preset' }], allowCustom: true },
        ],
      })
      const request = await requestFrom(peer)
      const answer = { answers: [
        { id: 'single', selected: ['B'] },
        { id: 'multi', selected: ['X', 'Y'] },
        { id: 'custom', selected: [], custom: 'use isolated runner' },
      ] }
      peer.send(response(request, answer, h.privateKey))
      await expect(pending).resolves.toEqual(answer)
    } finally {
      await h.finish()
    }
  })

  it('rejects custom text when that question forbids it and keeps the native call pending', async () => {
    const h = await harness()
    try {
      const first = await h.peer()
      const pending = h.bridge.ask({ kind: 'question', title: 'Choose', detail: '', questions: [
        { id: 'choice', question: 'Choose one', options: [{ label: 'A' }], allowCustom: false },
      ] })
      let resolved = false
      void pending.then(() => { resolved = true }, () => {})
      const request = await requestFrom(first)
      first.send(response(request, { answers: [{ id: 'choice', selected: ['A'], custom: 'override' }] }, h.privateKey))
      await first.closed
      expect(resolved).toBe(false)

      const second = await h.peer()
      const replayed = await requestFrom(second)
      second.send(response(replayed, { answers: [{ id: 'choice', selected: ['A'] }] }, h.privateKey))
      await expect(pending).resolves.toEqual({ answers: [{ id: 'choice', selected: ['A'] }] })
    } finally {
      await h.finish()
    }
  })

  it('replays the same boot and request after disconnect without creating another question', async () => {
    const h = await harness()
    try {
      const first = await h.peer()
      const pending = h.bridge.ask({ kind: 'question', title: 'Continue', detail: '', questions: [
        { id: 'one', question: 'Continue?', options: [{ label: 'yes' }] },
      ] })
      const original = await requestFrom(first)
      first.socket.destroy()
      await first.closed

      const second = await h.peer()
      const hello = await second.next('hello')
      const replayed = await requestFrom(second)
      expect(hello).toMatchObject({ type: 'hello', bootId: original.bootId })
      expect(replayed).toEqual(original)
      expect(second.seen.filter(message => message.type === 'request')).toHaveLength(1)
      const answer = { answers: [{ id: 'one', selected: ['yes'] }] }
      second.send(response(replayed, answer, h.privateKey))
      await expect(pending).resolves.toEqual(answer)
    } finally {
      await h.finish()
    }
  })

  it('acknowledges an identical duplicate answer and rejects a changed duplicate', async () => {
    const h = await harness()
    try {
      const peer = await h.peer()
      const pending = h.bridge.ask({ kind: 'approval', title: 'Approve once', detail: 'operation' })
      const request = await requestFrom(peer)
      const approved = response(request, { decision: 'approve' }, h.privateKey)
      peer.send(approved)
      await expect(pending).resolves.toEqual({ decision: 'approve' })
      const firstSettled = await peer.next('settled')

      peer.send(approved)
      const duplicateSettled = await peer.next('settled')
      expect(duplicateSettled).toEqual(firstSettled)

      peer.send(response(request, { decision: 'reject' }, h.privateKey))
      await peer.closed
    } finally {
      await h.finish()
    }
  })

  it('rejects an aborted native call and never revives it with a late approval', async () => {
    const h = await harness()
    try {
      const peer = await h.peer()
      const controller = new AbortController()
      const pending = h.bridge.ask({ kind: 'approval', title: 'Cancelable', detail: 'operation' }, controller.signal)
      const request = await requestFrom(peer)
      controller.abort()
      await expect(pending).rejects.toThrow(/取消/)
      await expect(peer.next('withdrawn')).resolves.toMatchObject({
        type: 'withdrawn', bootId: request.bootId, requestId: request.requestId,
      })
      peer.send(response(request, { decision: 'approve' }, h.privateKey))
      await peer.closed
    } finally {
      await h.finish()
    }
  })

  it('does not resolve the native call when a signed answer is tampered', async () => {
    const h = await harness()
    try {
      const first = await h.peer()
      const pending = h.bridge.ask({ kind: 'approval', title: 'Signed approval', detail: 'operation' })
      let resolved = false
      void pending.then(() => { resolved = true }, () => {})
      const request = await requestFrom(first)
      const signed = response(request, { decision: 'approve' }, h.privateKey)
      first.send({ ...signed, signature: `${signed.signature.slice(0, -4)}AAAA` })
      await first.closed
      expect(resolved).toBe(false)

      const second = await h.peer()
      const replayed = await requestFrom(second)
      second.send(response(replayed, { decision: 'reject' }, h.privateKey))
      await expect(pending).resolves.toEqual({ decision: 'reject' })
    } finally {
      await h.finish()
    }
  })

  it.each(['boot', 'digest'] as const)('does not grant authority for an invalid %s', async invalidField => {
    const h = await harness()
    try {
      const first = await h.peer()
      const pending = h.bridge.ask({ kind: 'approval', title: 'Protected', detail: 'operation' })
      let resolved = false
      void pending.then(() => { resolved = true }, () => {})
      const request = await requestFrom(first)
      const invalid = invalidField === 'boot'
        ? response(request, { decision: 'approve' }, h.privateKey, { bootId: 'wrong-boot' })
        : response(request, { decision: 'approve' }, h.privateKey, { digest: '0'.repeat(64) })
      first.send(invalid)
      await first.closed
      expect(resolved).toBe(false)

      const second = await h.peer()
      const replayed = await requestFrom(second)
      second.send(response(replayed, { decision: 'reject' }, h.privateKey))
      await expect(pending).resolves.toEqual({ decision: 'reject' })
    } finally {
      await h.finish()
    }
  })
})

it('rejects a pending to cancelled transition that adds the first answer', () => {
  const createdAt = Date.now()
  const request: WorkerInteractionRequest = {
    protocol: 'dsh-worker-interactions/v1',
    bootId: 'boot',
    requestId: 'request',
    kind: 'approval',
    createdAt,
    expiresAt: createdAt + 60_000,
    title: 'Approve',
    detail: 'operation',
  }
  const prior: WorkerInteractionRecord = {
    id: 'interaction', sessionId: 'session', needId: 'need', runId: 'run', podUid: 'pod',
    revision: 1, expiresAt: request.expiresAt, request, digest: executionDigest(request),
    state: 'pending', updatedAt: createdAt, reason: '',
  }
  expect(applyWorkerInteraction(undefined, prior)).toEqual(prior)
  expect(() => applyWorkerInteraction(prior, {
    ...prior,
    revision: 2,
    state: 'cancelled',
    answer: { decision: 'approve' },
    updatedAt: createdAt + 1,
    reason: 'worker exited',
  })).toThrow(/Only a user decision may add an answer/)
})
