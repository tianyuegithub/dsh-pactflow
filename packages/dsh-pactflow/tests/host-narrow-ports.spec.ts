import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { reconcileCleanupsImpl, type CleanupHost } from '../src/host/cleanup.ts'
import { localExecutionImpl, type DispatchHost } from '../src/host/dispatch.ts'
import { reconcileLocalRunImpl, type RecoveryHost } from '../src/host/recovery.ts'

const roots: string[] = []
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })

function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pactflow-narrow-ports-'))
  roots.push(dir)
  return dir
}

// R12: a host module must receive narrow ports, not the whole Cordis Context. This
// host deliberately has NO `ctx` member — if the module still needs it, this fails.
function narrowHost(cleanups: readonly Record<string, unknown>[], retryCleanup: ReturnType<typeof vi.fn>): CleanupHost {
  return {
    events: { append: () => {} },
    logger: { warn: () => {} },
    delivery: () => ({ cleanups: Object.fromEntries(cleanups.map(record => [record.id as string, record])) }),
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

describe('PactFlow host narrow ports', () => {
  it('reconciles cleanups through narrow ports without the whole Context', async () => {
    const retryCleanup = vi.fn(async () => ({ id: 'cleanup-run-git' }))
    const pending = { id: 'cleanup-run-git', runId: 'run', target: 'git:pactflow/x', state: 'pending', attempt: 1 }
    await reconcileCleanupsImpl(narrowHost([pending], retryCleanup), session)
    expect(retryCleanup).toHaveBeenCalledTimes(1)
  })

  it('still skips retained records through narrow ports', async () => {
    const retryCleanup = vi.fn(async () => ({ id: 'cleanup-retained' }))
    const retained = { id: 'cleanup-retained', runId: 'run', target: 'git:pactflow/x', state: 'pending', attempt: 1, retain: true }
    await reconcileCleanupsImpl(narrowHost([retained], retryCleanup), session)
    expect(retryCleanup).not.toHaveBeenCalled()
  })

  // R12: DispatchHost no longer carries the whole Context. This host exposes only
  // the agent/subagent ports — a residual `host.ctx` read would throw here.
  it('resolves a local execution from agent/subagent ports without the whole Context', () => {
    const parent = { id: 'session' }
    const withCwd = {
      agents: () => ({ get: () => parent }),
      subagents: () => ({ getProvider: () => ({ capabilities: { cwd: true } }) }),
    } as unknown as DispatchHost
    const resolved = localExecutionImpl(
      withCwd,
      session,
      { provider: 'spawn', prompt: '  do the work  ' } as never,
      true,
    )
    expect(resolved.parent).toBe(parent)
    expect(resolved.prompt).toBe('do the work')

    const noCwd = {
      agents: () => ({ get: () => parent }),
      subagents: () => ({ getProvider: () => ({ capabilities: { cwd: false } }) }),
    } as unknown as DispatchHost
    expect(() => localExecutionImpl(noCwd, session, { provider: 'spawn', prompt: 'x' } as never, true))
      .toThrow(/cannot select a task worktree/)
  })

  // A08: the PactFlow preset persona is a read-only orchestrator, so a spawned
  // Worker that inherits it produces no commit. A supporting provider must get a
  // worker persona that shadows it; a non-supporting one must get none (DSH rejects it).
  it('requests a worker persona only from a provider that supports personas', () => {
    const parent = { id: 'session' }
    const supporting = {
      agents: () => ({ get: () => parent }),
      subagents: () => ({ getProvider: () => ({ capabilities: { cwd: true, persona: true } }) }),
    } as unknown as DispatchHost
    const withPersona = localExecutionImpl(supporting, session, { provider: 'spawn', prompt: 'x' } as never, true)
    expect(typeof withPersona.persona).toBe('string')
    // The shadowing persona must grant the write/commit the orchestrator persona forbids.
    expect(withPersona.persona).toMatch(/Worker/)
    expect(withPersona.persona).toMatch(/commit/i)

    const withoutPersona = {
      agents: () => ({ get: () => parent }),
      subagents: () => ({ getProvider: () => ({ capabilities: { cwd: true, persona: false } }) }),
    } as unknown as DispatchHost
    const noPersona = localExecutionImpl(withoutPersona, session, { provider: 'spawn', prompt: 'x' } as never, true)
    expect(noPersona.persona).toBeUndefined()
  })

  // R12: RecoveryHost reaches live sessions and logging only through narrow ports.
  it('drives local expiry recovery through logger/liveSession ports only', async () => {
    const warn = vi.fn()
    const current = { id: 'run-1', leaseDeadline: Date.now() + 5, k3s: undefined }
    const host = {
      logger: { warn },
      liveSession: () => ({ id: 'session' }),
      runState: () => ({ 'run-1': current }),
      isTerminalRun: () => false,
      clearLocalExpiryTimer: () => {},
      expireRunInSession: () => {},
      localExpiryTimers: new Map(),
      reconcileLocalRun: () => { throw new Error('recovery exploded') },
      boundedOutcome: (value: unknown) => String(value),
    } as unknown as RecoveryHost
    reconcileLocalRunImpl(host, session, current as never)
    expect(host.localExpiryTimers.size).toBe(1)
    await new Promise(resolve => setTimeout(resolve, 40))
    expect(warn).toHaveBeenCalledTimes(1)
    // format, run id, then the bounded outcome string.
    expect(String(warn.mock.calls[0]?.[2])).toContain('recovery exploded')
  })
})
