import type { PactFlowProjectWorkerPolicy } from './types.ts'

interface Waiter {
  readonly profileId: string
  readonly policy: PactFlowProjectWorkerPolicy
  readonly resolve: (release: () => void) => void
}

interface State {
  running: number
  readonly byProfile: Map<string, number>
  readonly queue: Waiter[]
}

/** Per-Agent FIFO quotas layered before the global Worker Pool capacity. */
export class PactFlowProjectCapacity {
  private readonly states = new Map<string, State>()

  async acquire(workspaceId: string, policy: PactFlowProjectWorkerPolicy, profileId: string): Promise<() => void> {
    const profile = policy.agentProfiles.find(item => item.id === profileId)
    if (profile === undefined) throw new Error(`PactFlow project does not allow Agent Profile "${profileId}"`)
    const state: State = this.states.get(workspaceId) ?? { running: 0, byProfile: new Map(), queue: [] }
    this.states.set(workspaceId, state)
    if (state.queue.length === 0 && this.available(state, policy, profileId)) {
      this.reserve(state, profileId)
      return this.release(workspaceId, profileId)
    }
    return await new Promise<() => void>(resolve => { state.queue.push({ profileId, policy, resolve }) })
  }

  private available(state: State, policy: PactFlowProjectWorkerPolicy, profileId: string): boolean {
    const profile = policy.agentProfiles.find(item => item.id === profileId)!
    return (state.byProfile.get(profileId) ?? 0) < profile.maxConcurrency
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
        this.reserve(state, waiter.profileId)
        waiter.resolve(this.release(workspaceId, waiter.profileId))
      }
      if (state.running === 0 && state.queue.length === 0) this.states.delete(workspaceId)
    }
  }
}
