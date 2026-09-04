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
  private wakeTimer: ReturnType<typeof setTimeout> | undefined

  constructor(private readonly projects: PactFlowProjectCapacity) {}

  async acquire(input: {
    readonly workspaceId: string | undefined
    readonly policy: PactFlowProjectWorkerPolicy | undefined
    readonly profileId: string | undefined
    readonly poolId: string | undefined
    readonly resolveInfrastructure: () => PactFlowInfrastructure | undefined
    readonly signal: AbortSignal | undefined
  }): Promise<() => void> {
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
    const projectRelease = input.workspaceId !== undefined && input.policy !== undefined && input.profileId !== undefined
      ? this.projects.tryAcquire(input.workspaceId, input.policy, input.profileId)
      : undefined
    const poolRelease = input.poolId === undefined ? undefined : input.resolveInfrastructure()?.tryAcquire(input.poolId)
    if ((input.workspaceId !== undefined && input.policy !== undefined && input.profileId !== undefined && projectRelease === undefined)
      || (input.poolId !== undefined && poolRelease === undefined)) {
      poolRelease?.()
      projectRelease?.()
      throw new Error('PactFlow Worker capacity is exhausted during recovery')
    }
    return this.once(() => { poolRelease?.(); projectRelease?.(); })
  }

  waiting(poolId?: string): number {
    return this.queue.filter(request => request.poolId === poolId).length
  }

  dispose(): void {
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer)
    this.wakeTimer = undefined
    for (const request of this.queue) {
      if (request.signal !== undefined && request.abort !== undefined) request.signal.removeEventListener('abort', request.abort)
      request.reject(new Error('PactFlow Worker admission scheduler was disposed'))
    }
    this.queue.length = 0
  }

  private pump(): void {
    if (this.pumping) return
    this.pumping = true
    let projectRelease: (() => void) | undefined
    let poolRelease: (() => void) | undefined
    try {
      const request = this.queue[0]
      if (request === undefined) return
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
      this.pump()
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
    }
  }

  private scheduleWake(): void {
    if (this.wakeTimer !== undefined) return
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
