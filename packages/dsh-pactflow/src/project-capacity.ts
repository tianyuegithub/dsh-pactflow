import type { PactFlowProjectWorkerPolicy } from './types.ts'

interface Waiter {
  readonly profileId: string
  readonly policy: PactFlowProjectWorkerPolicy
  readonly resolve: (release: () => void) => void
  readonly reject: (error: Error) => void
  readonly signal?: AbortSignal
  abort?: () => void
}

interface State {
  running: number
  readonly byProfile: Map<string, number>
  readonly queue: Waiter[]
}

/** Per-Agent FIFO quotas layered before the global Worker Pool capacity. */
export class PactFlowProjectCapacity {
  private static readonly maxQueuedPerWorkspace = 128
  private readonly states = new Map<string, State>()

  async acquire(
    workspaceId: string,
    policy: PactFlowProjectWorkerPolicy,
    profileId: string,
    signal?: AbortSignal,
  ): Promise<() => void> {
    const profile = policy.agentProfiles.find(item => item.id === profileId)
    if (profile === undefined) throw new Error(`PactFlow project does not allow Agent Profile "${profileId}"`)
    if (signal?.aborted) throw this.cancelled(workspaceId)
    const state: State = this.states.get(workspaceId) ?? { running: 0, byProfile: new Map(), queue: [] }
    this.states.set(workspaceId, state)
    if (state.queue.length === 0 && this.available(state, policy, profileId)) {
      this.reserve(state, profileId)
      return this.release(workspaceId, profileId)
    }
    if (state.queue.length >= PactFlowProjectCapacity.maxQueuedPerWorkspace) {
      throw new Error(`PactFlow project Worker queue for "${workspaceId}" is full`)
    }
    return await new Promise<() => void>((resolve, reject) => {
      const waiter: Waiter = { profileId, policy, resolve, reject, ...(signal === undefined ? {} : { signal }) }
      if (signal !== undefined) {
        waiter.abort = () => {
          const index = state.queue.indexOf(waiter)
          if (index < 0) return
          state.queue.splice(index, 1)
          reject(this.cancelled(workspaceId))
          if (state.running === 0 && state.queue.length === 0) this.states.delete(workspaceId)
        }
        signal.addEventListener('abort', waiter.abort, { once: true })
      }
      state.queue.push(waiter)
    })
  }

  /** Reserve immediately for the combined Host scheduler; never enqueues. */
  tryAcquire(
    workspaceId: string,
    policy: PactFlowProjectWorkerPolicy,
    profileId: string,
  ): (() => void) | undefined {
    const profile = policy.agentProfiles.find(item => item.id === profileId)
    if (profile === undefined) throw new Error(`PactFlow project does not allow Agent Profile "${profileId}"`)
    const state: State = this.states.get(workspaceId) ?? { running: 0, byProfile: new Map(), queue: [] }
    this.states.set(workspaceId, state)
    if (state.queue.length !== 0 || !this.available(state, policy, profileId)) return undefined
    this.reserve(state, profileId)
    return this.release(workspaceId, profileId)
  }

  /** Restore one persisted nonterminal Run before reconciliation after a Host restart. */
  reserveExisting(workspaceId: string, policy: PactFlowProjectWorkerPolicy, profileId: string): () => void {
    if (!policy.agentProfiles.some(item => item.id === profileId)) {
      throw new Error(`PactFlow project does not allow Agent Profile "${profileId}"`)
    }
    const state: State = this.states.get(workspaceId) ?? { running: 0, byProfile: new Map(), queue: [] }
    this.states.set(workspaceId, state)
    if (state.running >= projectCapacityLimit(policy)
      || (state.byProfile.get(profileId) ?? 0) >= profileMax(policy, profileId)) {
      throw new Error(`PactFlow project Worker capacity for "${workspaceId}" is exhausted during recovery`)
    }
    this.reserve(state, profileId)
    return this.release(workspaceId, profileId)
  }

  private available(state: State, policy: PactFlowProjectWorkerPolicy, profileId: string): boolean {
    const profile = policy.agentProfiles.find(item => item.id === profileId)!
    return state.running < projectCapacityLimit(policy)
      && (state.byProfile.get(profileId) ?? 0) < profile.maxConcurrency
  }

  private reserve(state: State, profileId: string): void {
    state.running += 1
    state.byProfile.set(profileId, (state.byProfile.get(profileId) ?? 0) + 1)
  }

  private release(workspaceId: string, profileId: string): () => void {
    let released = false
    return () => {
      if (released) return
      released = true
      const state = this.states.get(workspaceId)
      if (state === undefined) return
      state.running -= 1
      const nextCount = (state.byProfile.get(profileId) ?? 1) - 1
      if (nextCount === 0) state.byProfile.delete(profileId)
      else state.byProfile.set(profileId, nextCount)
      const waiter = state.queue[0]
      if (waiter !== undefined && this.available(state, waiter.policy, waiter.profileId)) {
        state.queue.shift()
        if (waiter.signal !== undefined && waiter.abort !== undefined) {
          waiter.signal.removeEventListener('abort', waiter.abort)
        }
        this.reserve(state, waiter.profileId)
        waiter.resolve(this.release(workspaceId, waiter.profileId))
      }
      if (state.running === 0 && state.queue.length === 0) this.states.delete(workspaceId)
    }
  }

  private cancelled(workspaceId: string): Error {
    return new Error(`PactFlow project Worker queue for "${workspaceId}" wait was cancelled`)
  }
}

function profileMax(policy: PactFlowProjectWorkerPolicy, profileId: string): number {
  return policy.agentProfiles.find(item => item.id === profileId)?.maxConcurrency ?? 0
}

function projectCapacityLimit(policy: PactFlowProjectWorkerPolicy): number {
  const derived = policy.agentProfiles.reduce((total, profile) => total + profile.maxConcurrency, 0)
  return Math.max(1, policy.maxConcurrency, derived)
}
