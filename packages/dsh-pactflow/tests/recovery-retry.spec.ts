import { afterEach, describe, expect, it, vi } from 'vitest'
import PactFlowService from '../lib/index.js'

// These helpers do not access Cordis state; isolate retry policy from network I/O.
function policy() {
  const service = Object.create(PactFlowService.prototype) as PactFlowService
  return {
    permanent: (error: unknown): boolean => Reflect.get(service, 'isPermanentK3sError').call(service, error),
    retry: (operation: () => Promise<unknown>, signal?: AbortSignal): Promise<unknown> =>
      Reflect.get(service, 'retryK3sOperation').call(service, operation, signal),
  }
}

afterEach(() => { vi.useRealTimers() })

describe('PactFlow recovery retry policy', () => {
  it.each([408, 409, 425, 429, 500, 503])('retries transient HTTP %s in both structured and wrapped errors', async status => {
    const retry = policy()
    expect(retry.permanent(Object.assign(new Error('API request failed'), { statusCode: status }))).toBe(false)
    const wrapped = new Error(`PactFlow cannot read K3s Job (status ${status})`)
    expect(retry.permanent(wrapped)).toBe(false)
    vi.useFakeTimers()
    const operation = vi.fn().mockRejectedValueOnce(wrapped).mockResolvedValue('recovered')
    const result = retry.retry(operation)
    await vi.advanceTimersByTimeAsync(250)
    await expect(result).resolves.toBe('recovered')
    expect(operation).toHaveBeenCalledTimes(2)
  })

  it.each([400, 401, 403, 422])('does not retry permanent structured HTTP %s', async status => {
    const error = Object.assign(new Error('API request failed'), { statusCode: status })
    const retry = policy()
    expect(retry.permanent(error)).toBe(true)
    const operation = vi.fn().mockRejectedValue(error)
    await expect(retry.retry(operation)).rejects.toBe(error)
    expect(operation).toHaveBeenCalledTimes(1)
  })

  it('keeps identity mismatches permanent', () => {
    expect(policy().permanent(new Error('K3s Job UID does not match the claimed Job'))).toBe(true)
  })

  it('bounds exhausted transient retries and preserves the final error', async () => {
    vi.useFakeTimers()
    const error = Object.assign(new Error('temporarily unavailable'), { response: { status: 503 } })
    const operation = vi.fn().mockRejectedValue(error)
    const pending = expect(policy().retry(operation)).rejects.toBe(error)
    await vi.runAllTimersAsync()
    await pending
    expect(operation).toHaveBeenCalledTimes(5)
    expect(vi.getTimerCount()).toBe(0)
  })

  it('cancels backoff without another operation or remaining timer', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const operation = vi.fn().mockRejectedValue(new Error('network unavailable'))
    const pending = expect(policy().retry(operation, controller.signal)).rejects.toThrow(/cancelled/)
    await vi.advanceTimersByTimeAsync(1)
    controller.abort()
    await pending
    expect(operation).toHaveBeenCalledTimes(1)
    expect(vi.getTimerCount()).toBe(0)
  })
})
