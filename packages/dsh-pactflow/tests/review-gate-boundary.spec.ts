import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { PactFlowGiteaClient } from '../src/gitea.ts'
import type { PactFlowGiteaBinding } from '../src/types.ts'

/**
 * The review gate observes; it never influences.
 *
 * Reading approvals and check results is one API call away from submitting an
 * approval, and merging is one flag away from force-merging past protection.
 * Both are refusals the contract depends on, so they get an adversarial guard
 * rather than a convention.
 */

const binding: PactFlowGiteaBinding = {
  baseUrl: 'https://gitea.example',
  owner: 'org',
  repo: 'repo',
  tokenCredentialRef: 'ref',
}

/** Record every request the client makes so the whole surface can be asserted. */
function recordingFetch(responder: (url: string) => unknown) {
  const calls: { url: string; method: string; body: unknown }[] = []
  const stub = vi.fn(async (url: string | URL, init?: RequestInit) => {
    const href = String(url)
    calls.push({
      url: href,
      method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as unknown : undefined,
    })
    return new Response(JSON.stringify(responder(href)), {
      status: 200, headers: { 'content-type': 'application/json' },
    })
  })
  return { calls, stub }
}

describe('PactFlow review gate never influences the review', () => {
  it('reads the gate with GET requests only', async () => {
    const { calls, stub } = recordingFetch(url => {
      if (url.includes('/pulls/7/reviews')) {
        return [
          { state: 'APPROVED', user: { id: 1 } },
          { state: 'APPROVED', user: { id: 2 } },
        ]
      }
      if (url.includes('/statuses/')) return [{ context: 'ci/test', status: 'success' }]
      return { number: 7, html_url: 'u', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } }
    })
    vi.stubGlobal('fetch', stub)
    try {
      const state = await new PactFlowGiteaClient().pullRequestGateState(binding, 'token', 7, ['ci/test'])
      expect(state.approvals).toBe(2)
      expect(state.checks).toEqual([{ context: 'ci/test', state: 'success' }])

      // Nothing in the whole observation writes.
      expect(calls.every(call => call.method === 'GET')).toBe(true)
      const surface = calls.map(call => call.url).join('\n')
      expect(surface).not.toMatch(/\/reviews\b.*\bPOST/i)
      expect(surface).not.toContain('/branch_protections')
      expect(surface).not.toContain('/merge')
    } finally { vi.unstubAllGlobals() }
  })

  it('counts one approval per reviewer, taking only their latest decision', async () => {
    // A reviewer who approved and then requested changes must not still count.
    const { stub } = recordingFetch(url => {
      if (url.includes('/reviews')) {
        return [
          { state: 'APPROVED', user: { id: 1 } },
          { state: 'REQUEST_CHANGES', user: { id: 1 } },
          { state: 'APPROVED', user: { id: 2 } },
        ]
      }
      return { number: 7, html_url: 'u', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } }
    })
    vi.stubGlobal('fetch', stub)
    try {
      const state = await new PactFlowGiteaClient().pullRequestGateState(binding, 'token', 7, [])
      expect(state.approvals).toBe(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('ignores stale, dismissed and comment-only reviews', async () => {
    const { stub } = recordingFetch(url => {
      if (url.includes('/reviews')) {
        return [
          { state: 'APPROVED', user: { id: 1 }, stale: true },
          { state: 'APPROVED', user: { id: 2 }, dismissed: true },
          { state: 'COMMENT', user: { id: 3 } },
          { state: 'APPROVED', user: { id: 4 } },
        ]
      }
      return { number: 7, html_url: 'u', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } }
    })
    vi.stubGlobal('fetch', stub)
    try {
      const state = await new PactFlowGiteaClient().pullRequestGateState(binding, 'token', 7, [])
      expect(state.approvals).toBe(1)
    } finally { vi.unstubAllGlobals() }
  })

  it('treats a required check that never reported as pending, not as absent', async () => {
    const { stub } = recordingFetch(url => {
      if (url.includes('/reviews')) return []
      if (url.includes('/statuses/')) return [{ context: 'ci/build', status: 'success' }]
      return { number: 7, html_url: 'u', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } }
    })
    vi.stubGlobal('fetch', stub)
    try {
      const state = await new PactFlowGiteaClient().pullRequestGateState(binding, 'token', 7, ['ci/build', 'ci/test'])
      expect(state.checks).toEqual([
        { context: 'ci/build', state: 'success' },
        { context: 'ci/test', state: 'pending' },
      ])
    } finally { vi.unstubAllGlobals() }
  })

  it('reads an error or warning status as a failure rather than as unknown', async () => {
    const { stub } = recordingFetch(url => {
      if (url.includes('/reviews')) return []
      if (url.includes('/statuses/')) return [{ context: 'ci/test', status: 'error' }]
      return { number: 7, html_url: 'u', merged: false, head: { sha: 'a'.repeat(40) }, base: { ref: 'main' } }
    })
    vi.stubGlobal('fetch', stub)
    try {
      const state = await new PactFlowGiteaClient().pullRequestGateState(binding, 'token', 7, ['ci/test'])
      expect(state.checks[0]?.state).toBe('failure')
    } finally { vi.unstubAllGlobals() }
  })
})

describe('PactFlow merge never bypasses branch protection', () => {
  const source = readFileSync(resolve(import.meta.dirname, '..', 'src', 'gitea.ts'), 'utf8')

  it('never sends force_merge as true', () => {
    expect(source).toContain('force_merge: false')
    expect(source).not.toMatch(/force_merge:\s*true/)
  })

  it('exposes no branch-protection write and no review submission', () => {
    // The only branch_protections reference is the read in verify().
    const writes = [...source.matchAll(/method:\s*'POST'/g)].length
    expect(writes).toBeGreaterThan(0)
    expect(source).not.toMatch(/branch_protections[^\n]*method:\s*'POST'/)
    expect(source).not.toMatch(/\/reviews[^\n]*method:\s*'POST'/)
    expect(source).not.toContain('/pulls/${String(number)}/reviews\', {\n      method')
  })

  it('stops retrying the merge once branch protection is the reason', async () => {
    // A protected-branch rejection is not a race window: no amount of retrying
    // satisfies a reviewer, so looping here would keep knocking on protection.
    let mergeAttempts = 0
    const stub = vi.fn(async (url: string | URL, init?: RequestInit) => {
      const href = String(url)
      if (href.endsWith('/merge')) {
        mergeAttempts += 1
        return new Response(JSON.stringify({ message: 'Please try again later, the pull request is not ready to be merged' }), {
          status: 405, headers: { 'content-type': 'application/json' },
        })
      }
      void init
      return new Response(JSON.stringify({
        number: 7, html_url: 'u', merged: false, mergeable: true,
        head: { sha: 'a'.repeat(40) }, base: { ref: 'main' },
      }), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    vi.stubGlobal('fetch', stub)
    try {
      await expect(new PactFlowGiteaClient().mergePullRequest(
        binding, 'token', 7, 'a'.repeat(40), undefined, undefined, true,
      )).rejects.toThrow(/branch protection is unsatisfied/)
      expect(mergeAttempts).toBe(1)
    } finally { vi.unstubAllGlobals() }
  })
})
