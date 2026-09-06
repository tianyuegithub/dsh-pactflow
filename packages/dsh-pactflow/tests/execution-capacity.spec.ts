import { afterEach, describe, expect, it, vi } from 'vitest'
import { PactFlowExecutionCapacity } from '../src/execution-capacity.ts'
import { PactFlowProjectCapacity } from '../src/project-capacity.ts'

afterEach(() => { vi.useRealTimers() })

describe('PactFlow combined admission lifecycle', () => {
  it('fails closed until every failed inventory scope is repaired', async () => {
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: undefined,
      signal: undefined, resolveInfrastructure: () => undefined }
    const resume = scheduler.pauseAdmission()
    const waiting = expect(scheduler.acquire(input)).rejects.toThrow(/inventory failed/)
    scheduler.setInventoryFailure('one', 'inventory failed')
    scheduler.setInventoryFailure('two', 'another inventory failed')
    resume()
    await waiting
    scheduler.setInventoryFailure('one', undefined)
    await expect(scheduler.acquire(input)).rejects.toThrow(/another inventory failed/)
    scheduler.setInventoryFailure('two', undefined)
    const release = await scheduler.acquire(input)
    release()
    scheduler.dispose()
  })

  it('holds new admission until all nested recovery inventories finish', async () => {
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    const outer = scheduler.pauseAdmission()
    const inner = scheduler.pauseAdmission()
    let admitted = false
    const pending = scheduler.acquire({ workspaceId: undefined, policy: undefined, profileId: undefined, poolId: undefined,
      signal: undefined, resolveInfrastructure: () => undefined }).then(release => { admitted = true; return release })
    outer()
    outer()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(admitted).toBe(false)
    inner()
    const release = await pending
    expect(admitted).toBe(true)
    release()
    scheduler.dispose()
  })

  it('bounds the queue and drains the full accepted capacity without stranded waiters', async () => {
    vi.useFakeTimers()
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    let available = false
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: 'pool', signal: undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => available ? () => {} : undefined }) as never }
    const order: number[] = []
    const releases: Array<() => void> = []
    const pending = Array.from({ length: 512 }, (_, index) => scheduler.acquire(input)
      .then(release => { order.push(index); releases.push(release) }, () => {}))
    try {
      await expect(scheduler.acquire(input)).rejects.toThrow(/queue is full/)
      available = true
      await vi.advanceTimersByTimeAsync(25)
      expect(order).toEqual(Array.from({ length: 512 }, (_, index) => index))
    } finally {
      scheduler.dispose()
      for (const release of releases) release()
      await Promise.all(pending)
    }
  })

  it('drains all available slots in FIFO order after a pool wait', async () => {
    vi.useFakeTimers()
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    let available = false
    const release = vi.fn()
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: 'pool', signal: undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => available ? release : undefined }) as never }
    const order: number[] = []
    const releases: Array<() => void> = []
    const pending = [1, 2, 3].map(id => scheduler.acquire(input).then(slot => { order.push(id); releases.push(slot) }, () => {}))
    try {
      expect(scheduler.waiting('pool')).toBe(3)
      available = true
      await vi.advanceTimersByTimeAsync(25)
      expect(order).toEqual([1, 2, 3])
      expect(scheduler.waiting('pool')).toBe(0)
      for (const slot of releases) { slot(); slot() }
      expect(release).toHaveBeenCalledTimes(3)
    } finally { scheduler.dispose(); await Promise.all(pending) }
  })

  it('rejects new admission and recovery reservations after disposal', async () => {
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: undefined,
      signal: undefined, resolveInfrastructure: () => undefined }
    scheduler.dispose()
    await expect(scheduler.acquire(input)).rejects.toThrow(/disposed/)
    expect(() => scheduler.reserveExisting(input)).toThrow(/disposed/)
  })

  it('cancels a queued head and preserves the remaining request', async () => {
    vi.useFakeTimers()
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    let available = false
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: 'pool', signal: undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => available ? () => {} : undefined }) as never }
    const controller = new AbortController()
    const head = expect(scheduler.acquire({ ...input, signal: controller.signal })).rejects.toThrow(/cancelled/)
    const tail = scheduler.acquire(input)
    controller.abort()
    await head
    expect(scheduler.waiting('pool')).toBe(1)
    available = true
    await vi.advanceTimersByTimeAsync(25)
    const release = await tail
    release()
    scheduler.dispose()
    expect(vi.getTimerCount()).toBe(0)
  })

  it('rejects queued requests and clears wake timers on disposal', async () => {
    vi.useFakeTimers()
    const scheduler = new PactFlowExecutionCapacity(new PactFlowProjectCapacity())
    const input = { workspaceId: undefined, policy: undefined, profileId: undefined, poolId: 'pool', signal: undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => undefined }) as never }
    const pending = expect(scheduler.acquire(input)).rejects.toThrow(/disposed/)
    scheduler.dispose()
    scheduler.dispose()
    await pending
    expect(vi.getTimerCount()).toBe(0)
    expect(scheduler.waiting('pool')).toBe(0)
  })

  it('admits interleaved projects in global arrival order', async () => {
    vi.useFakeTimers()
    const projects = new PactFlowProjectCapacity()
    const scheduler = new PactFlowExecutionCapacity(projects)
    const policyFor = (id: string) => ({
      clusterId: 'c', workerPoolId: 'pool', maxConcurrency: 2,
      agentProfiles: [{ id, displayName: id, templateId: 't', maxConcurrency: 2, modelConnectionId: 'm' }],
    })
    const inputFor = (workspaceId: string) => ({
      workspaceId, policy: policyFor(`${workspaceId}-profile`), profileId: `${workspaceId}-profile`, poolId: 'pool',
      signal: undefined as AbortSignal | undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => () => {} }) as never,
    })
    const order: string[] = []
    const releases: Array<() => void> = []
    const pending: Array<Promise<void>> = []
    for (const workspaceId of ['ws-a', 'ws-b', 'ws-a', 'ws-b', 'ws-a']) {
      pending.push(scheduler.acquire(inputFor(workspaceId)).then(release => {
        order.push(workspaceId); releases.push(release)
      }))
    }
    await vi.advanceTimersByTimeAsync(25)
    // The first four arrive in order; the fifth waits because project A's
    // per-project quota (2) is exhausted even though the pool has room.
    expect(order).toEqual(['ws-a', 'ws-b', 'ws-a', 'ws-b'])
    expect(scheduler.waiting('pool')).toBe(1)
    releases[0]!()
    await vi.advanceTimersByTimeAsync(25)
    expect(order).toEqual(['ws-a', 'ws-b', 'ws-a', 'ws-b', 'ws-a'])
    for (const release of releases) release()
    await Promise.all(pending)
    scheduler.dispose()
  })

  it('keeps a blocked project head unoverpassed by later projects', async () => {
    vi.useFakeTimers()
    const projects = new PactFlowProjectCapacity()
    const scheduler = new PactFlowExecutionCapacity(projects)
    const policyFor = (id: string, limit: number) => ({
      clusterId: 'c', workerPoolId: 'pool', maxConcurrency: limit,
      agentProfiles: [{ id, displayName: id, templateId: 't', maxConcurrency: limit, modelConnectionId: 'm' }],
    })
    const holdPolicy = policyFor('a-profile', 1)
    // Exhaust project A's single slot so its second request becomes a blocked head.
    const hold = projects.reserveExisting('ws-a', holdPolicy, 'a-profile')
    const aInput = {
      workspaceId: 'ws-a', policy: holdPolicy, profileId: 'a-profile', poolId: 'pool',
      signal: undefined as AbortSignal | undefined,
      resolveInfrastructure: () => ({ tryAcquire: () => () => {} }) as never,
    }
    const bInput = { ...aInput, workspaceId: 'ws-b', policy: policyFor('b-profile', 1), profileId: 'b-profile' }
    const admitted: string[] = []
    const pendingA = scheduler.acquire(aInput).then(release => { admitted.push('ws-a'); return release })
    const pendingB = scheduler.acquire(bInput).then(release => { admitted.push('ws-b'); return release })
    await vi.advanceTimersByTimeAsync(100)
    // Project B could acquire now, but the strict FIFO head (ws-a) blocks it.
    expect(admitted).toEqual([])
    hold()
    // Releasing the head unblocks it, and the queue drains behind it in
    // arrival order within the same pump cycle.
    await vi.advanceTimersByTimeAsync(100)
    expect(admitted).toEqual(['ws-a', 'ws-b'])
    const releaseA = await pendingA
    const releaseB = await pendingB
    releaseA()
    releaseB()
    await Promise.all([pendingA, pendingB])
    scheduler.dispose()
  })
})
