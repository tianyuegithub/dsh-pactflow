import type { PactFlowInfrastructure } from './infrastructure.ts'
import type { PactFlowProjectWorkerPolicy } from './types.ts'
import { PactFlowProjectCapacity } from './project-capacity.ts'

interface Request {
  readonly workspaceId: string | undefined
  readonly policy: PactFlowProjectWorkerPolicy | undefined
  readonly profileId: string | undefined
  readonly poolId: string | undefined
  readonly resolveInfrastructure: () => PactFlowInfrastructure | undefined
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  readonly signal: AbortSignal | undefined
  abort?: () => void
}

/** One FIFO admission queue that atomically acquires project and global slots. */
export class PactFlowExecutionCapacity {
  private static readonly maxQueued = 512
  private readonly queue: Request[] = []
  private pumping = false
  private disposed = false
  private inventoryDepth = 0
  private readonly inventoryFailures = new Map<string, string>()
  private wakeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly projects: PactFlowProjectCapacity) {}

  /** Restore occupied slots before admitting new requests; nested scans compose. */
  pauseAdmission(): () => void {
    if (this.disposed) throw new Error('PactFlow Worker admission scheduler was disposed')
    this.inventoryDepth++
    return this.once(() => { this.inventoryDepth--; this.pump() })
  }

  setInventoryFailure(scope: string, message: string | undefined): void {
    if (message === undefined) this.inventoryFailures.delete(scope)
    else this.inventoryFailures.set(scope, message.slice(0, 2_048))
    this.pump()
  }

  async acquire(input: {
    readonly workspaceId: string | undefined
    readonly policy: PactFlowProjectWorkerPolicy | undefined
    readonly profileId: string | undefined
    readonly poolId: string | undefined
    readonly resolveInfrastructure: () => PactFlowInfrastructure | undefined
    readonly signal: AbortSignal | undefined
  }): Promise<() => void> {
    if (this.disposed) throw new Error('PactFlow Worker admission scheduler was disposed')
    const failure = this.inventoryFailures.values().next().value
    if (failure !== undefined) throw new Error(failure)
    if (input.signal?.aborted) throw new Error('PactFlow Worker admission wait was cancelled')
    if (this.queue.length >= PactFlowExecutionCapacity.maxQueued) throw new Error('PactFlow Worker admission queue is full')
    const result = await new Promise<() => void>((resolve, reject) => {
      const request: Request = { ...input, resolve, reject }
      if (input.signal !== undefined) {
        request.abort = () => {
          const index = this.queue.indexOf(request)
          if (index < 0) return
          this.queue.splice(index, 1)
          reject(new Error('PactFlow Worker admission wait was cancelled'))
          this.pump()
        }
        input.signal.addEventListener('abort', request.abort, { once: true })
      }
      this.queue.push(request)
      this.pump()
    })
    return result
  }

  reserveExisting(input: {
    readonly workspaceId: string | undefined
    readonly policy: PactFlowProjectWorkerPolicy | undefined
    readonly profileId: string | undefined
    readonly poolId: string | undefined
    readonly resolveInfrastructure: () => PactFlowInfrastructure | undefined
  }): () => void {
    if (this.disposed) throw new Error('PactFlow Worker admission scheduler was disposed')
    const projectRelease = input.workspaceId !== undefined && input.policy !== undefined && input.profileId !== undefined
      ? this.projects.reserveExisting(input.workspaceId, input.policy, input.profileId)
      : undefined
    try {
      const infrastructure = input.poolId === undefined ? undefined : input.resolveInfrastructure()
      if (input.poolId !== undefined && infrastructure === undefined) {
        throw new Error('PactFlow Worker infrastructure is unavailable during recovery')
      }
      const poolRelease = input.poolId === undefined ? undefined : infrastructure!.reserveExisting(input.poolId)
      return this.once(() => { poolRelease?.(); projectRelease?.(); })
    } catch (error) {
      projectRelease?.()
      throw error
    }
  }

  waiting(poolId?: string): number {
    return this.queue.filter(request => request.poolId === poolId).length
  }

  dispose(): void {
    this.disposed = true
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer)
    this.wakeTimer = undefined
    for (const request of this.queue) {
      if (request.signal !== undefined && request.abort !== undefined) request.signal.removeEventListener('abort', request.abort)
      request.reject(new Error('PactFlow Worker admission scheduler was disposed'))
    }
    this.queue.length = 0
  }

  private pump(): void {
    if (this.pumping || this.disposed || this.inventoryDepth > 0) return
    this.pumping = true
    let projectRelease: (() => void) | undefined
    let poolRelease: (() => void) | undefined
    let admitted = false
    try {
      const request = this.queue[0]
      if (request === undefined) return
      const failure = this.inventoryFailures.values().next().value
      if (failure !== undefined) throw new Error(failure)
      const projects = request.workspaceId !== undefined && request.policy !== undefined && request.profileId !== undefined
        ? this.projects.tryAcquire(request.workspaceId, request.policy, request.profileId)
        : undefined
      projectRelease = projects
      const infrastructure = request.resolveInfrastructure()
      const pool = request.poolId === undefined ? undefined : infrastructure?.tryAcquire(request.poolId)
      poolRelease = pool
      const needsProject = request.workspaceId !== undefined && request.policy !== undefined && request.profileId !== undefined
      const needsPool = request.poolId !== undefined
      if ((needsProject && projects === undefined) || (needsPool && pool === undefined)) {
        pool?.()
        projects?.()
        projectRelease = undefined
        poolRelease = undefined
        this.scheduleWake()
        return
      }
      this.queue.shift()
      if (request.signal !== undefined && request.abort !== undefined) request.signal.removeEventListener('abort', request.abort)
      request.resolve(this.once(() => { pool?.(); projects?.(); this.pump() }))
      projectRelease = undefined
      poolRelease = undefined
      admitted = true
    } catch (error) {
      poolRelease?.()
      projectRelease?.()
      const request = this.queue.shift()
      if (request !== undefined) {
        if (request.signal !== undefined && request.abort !== undefined) request.signal.removeEventListener('abort', request.abort)
        request.reject(error instanceof Error ? error : new Error(String(error)))
      }
      this.scheduleWake()
    } finally {
      this.pumping = false
      if (admitted && this.queue.length > 0) this.pump()
    }
  }

  private scheduleWake(): void {
    if (this.disposed || this.wakeTimer !== undefined) return
    this.wakeTimer = setTimeout(() => {
      this.wakeTimer = undefined
      this.pump()
    }, 25)
  }

  private once(action: () => void): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      action()
    }
  }
}
