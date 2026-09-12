import { createServer, type Socket, type Server } from 'node:net'
import { randomUUID, verify, createPublicKey } from 'node:crypto'
import { chmod } from 'node:fs/promises'
import { executionDigest } from '../execution-plan.ts'
import { WORKER_INTERACTION_PROTOCOL, type WorkerInteractionRequest, type WorkerInteractionAnswer, type WorkerBridgeMessage, type WorkerBridgeAnswer } from '../worker-interaction-types.ts'
import { validateWorkerAnswer, workerInteractionRequestSchema } from '../worker-interactions.ts'
export const WORKER_SOCKET_PATH = '/tmp/pactflow-dsh-interactions.sock'
export const MAX_BRIDGE_LINE = 65536
interface Pending { request: WorkerInteractionRequest; digest: string; resolve(answer: WorkerInteractionAnswer): void; reject(error: Error): void; dispose(): void }
/** Only a live process can resume its pending native call. Never persist a fake call stack. */
export class DshWorkerInteractionBridge {
  readonly bootId = randomUUID()
  private server: Server | undefined
  private peers = new Set<Socket>()
  private pending: Pending | undefined
  private settled = new Map<string, { digest: string; answer: WorkerInteractionAnswer }>()
  private count = 0
  constructor(readonly socketPath = WORKER_SOCKET_PATH, private readonly now = () => Date.now(),
    private readonly identity: { publicKey: string; runId: string; podUid: string }) {}
  async listen(): Promise<void> {
    // Do not unlink an unknown socket: a second runtime must not steal its endpoint.
    this.server = createServer(socket => {
      this.peers.add(socket)
      this.send(socket, { type: 'hello', protocol: WORKER_INTERACTION_PROTOCOL, bootId: this.bootId })
      if (this.pending) this.send(socket, { type: 'request', request: this.pending.request })
      let buffer = ''
      socket.setEncoding('utf8')
      socket.on('data', chunk => {
        buffer += chunk
        if (Buffer.byteLength(buffer) > MAX_BRIDGE_LINE) { socket.destroy(); return }
        let end: number
        while ((end = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, end); buffer = buffer.slice(end + 1)
          try { this.receive(JSON.parse(line) as WorkerBridgeAnswer, socket) } catch { socket.destroy() }
        }
      })
      socket.on('error', () => { socket.destroy() })
      socket.on('close', () => this.peers.delete(socket))
    })
    await new Promise<void>((resolve, reject) => { this.server!.once('error', reject); this.server!.listen(this.socketPath, () => { this.server!.off('error', reject); resolve() }) })
    await chmod(this.socketPath, 0o600)
  }
  async ask(input: Pick<WorkerInteractionRequest, 'kind' | 'title' | 'detail' | 'toolName' | 'callId' | 'questions'>, signal?: AbortSignal): Promise<WorkerInteractionAnswer> {
    if (!this.server || signal?.aborted) throw new Error('远程交互已取消或不可用')
    if (this.pending || this.count >= 32) throw new Error('远程交互数量超限')
    const createdAt = this.now()
    const request = workerInteractionRequestSchema.parse({ ...input, protocol: WORKER_INTERACTION_PROTOCOL, bootId: this.bootId,
      requestId: randomUUID(), createdAt, expiresAt: createdAt + 900000 })
    if (Buffer.byteLength(JSON.stringify(request)) > MAX_BRIDGE_LINE - 128) throw new Error('远程交互内容过长')
    this.count++
    return await new Promise<WorkerInteractionAnswer>((resolve, reject) => {
      const cancel = (reason: string) => {
        if (this.pending?.request.requestId !== request.requestId) return
        this.pending.dispose(); this.pending = undefined
        this.broadcast({ type: 'withdrawn', bootId: this.bootId, requestId: request.requestId, reason })
        reject(new Error(reason))
      }
      const abort = () => cancel('执行器取消了交互')
      const timer = setTimeout(() => cancel('等待人工处理已超时'), request.expiresAt - createdAt)
      timer.unref(); signal?.addEventListener('abort', abort, { once: true })
      this.pending = { request, digest: executionDigest(request), resolve, reject,
        dispose: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort) } }
      this.broadcast({ type: 'request', request })
      if (signal?.aborted) abort()
    })
  }
  private receive(message: WorkerBridgeAnswer, socket: Socket): void {
    const { signature, ...body } = message ?? {}
    if (typeof signature !== 'string' || message.runId !== this.identity.runId || message.podUid !== this.identity.podUid
      || !Number.isSafeInteger(message.expiresAt) || this.now() >= message.expiresAt
      || !verify(null, Buffer.from(JSON.stringify(body)), createPublicKey(this.identity.publicKey), Buffer.from(signature, 'base64'))) throw new Error('Untrusted interaction answer')
    if (message?.type !== 'answer' || message.bootId !== this.bootId) throw new Error('Wrong bridge identity')
    const old = this.settled.get(message.requestId)
    if (old) {
      if (old.digest !== message.digest || JSON.stringify(old.answer) !== JSON.stringify(message.answer)) throw new Error('Changed duplicate answer')
      this.send(socket, { type: 'settled', bootId: this.bootId, requestId: message.requestId, digest: old.digest }); return
    }
    const pending = this.pending
    if (!pending || pending.request.requestId !== message.requestId || pending.digest !== message.digest || this.now() >= pending.request.expiresAt) throw new Error('Stale bridge answer')
    const answer = validateWorkerAnswer(pending.request, message.answer)
    pending.dispose(); this.pending = undefined
    this.settled.set(message.requestId, { digest: pending.digest, answer })
    pending.resolve(structuredClone(answer))
    this.send(socket, { type: 'settled', bootId: this.bootId, requestId: message.requestId, digest: pending.digest })
  }
  private send(socket: Socket, message: WorkerBridgeMessage): void { if (!socket.destroyed) socket.write(JSON.stringify(message) + '\n') }
  private broadcast(message: WorkerBridgeMessage): void { for (const socket of this.peers) this.send(socket, message) }
  async close(): Promise<void> {
    if (this.pending) { this.pending.dispose(); this.pending.reject(new Error('执行器已停止')); this.pending = undefined }
    for (const socket of this.peers) socket.destroy()
    if (this.server?.listening) { await new Promise<void>(resolve => this.server!.close(() => resolve())) }
    this.server = undefined
  }
}
