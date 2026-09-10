import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reconcileCleanupsImpl, type CleanupHost } from '../src/host/cleanup.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pactflow-cleanup-guard-'))
  roots.push(dir)
  return dir
}

function host(cleanups: readonly Record<string, unknown>[], retryCleanup: ReturnType<typeof vi.fn>): CleanupHost {
  return {
    events: { append: () => {} },
    logger: { warn: () => {} },
    delivery: () => ({ cleanups: Object.fromEntries(cleanups.map(r => [r.id as string, r])) }),
    git: {} as never,
    cleanupTimers: new Map(),
    cleanupStopped: false,
    activeCleanups: new Map(),
    appendCleanupRecord: () => {},
    scheduleCleanupRetry: () => {},
    runCleanupRecord: async () => true,
    performCleanupRecord: async () => true,
    retryCleanup,
    cleanupAction: async () => {},
    livePactFlowSession: () => ({ id: 's' }),
    requireProject: () => ({ id: 'p' }),
    workspaceProjectForSession: async () => undefined,
    workspaceGitBinding: () => undefined,
    node: () => ({ needId: 'need' }),
    runState: () => ({}),
    workerForRun: () => ({ cleanupRun: async () => {} }),
    resolveGitAuth: async () => undefined,
    boundedOutcome: (value: unknown) => String(value),
  } as unknown as CleanupHost
}

const session = { id: 'session' } as never

describe('PactFlow retained-record cleanup guard', () => {
  it('never auto-cleans a retained failure record', async () => {
    const retryCleanup = vi.fn(async () => ({ id: 'cleanup-run-git-retained' }))
    const retained = { id: 'cleanup-run-git-retained', runId: 'run', target: 'git:pactflow/x', state: 'pending', attempt: 1, retain: true }
    await reconcileCleanupsImpl(host([retained], retryCleanup), session)
    expect(retryCleanup).not.toHaveBeenCalled()
  })

  it('still reconciles an ordinary pending record', async () => {
    const retryCleanup = vi.fn(async () => ({ id: 'cleanup-run-git' }))
    const pending = { id: 'cleanup-run-git', runId: 'run', target: 'git:pactflow/x', state: 'pending', attempt: 1 }
    await reconcileCleanupsImpl(host([pending], retryCleanup), session)
    expect(retryCleanup).toHaveBeenCalledTimes(1)
  })
})
