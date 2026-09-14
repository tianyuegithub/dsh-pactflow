import { describe, expect, it, vi } from 'vitest'
import { PactFlowAutopilotDriver } from '../src/host/autopilot-driver.ts'
import type { AutopilotDriverHost } from '../src/host/autopilot-driver.ts'
import type { PactFlowAutopilotRecord, PactFlowReviewGateRecord, PactFlowSnapshot } from '../src/types.ts'

/**
 * Autopilot meeting a closing that waits on external review.
 *
 * "Waiting for external review" is a position the autopilot contract never had:
 * stopped, but not failed, and not the model's turn either. Left unhandled the
 * driver does two harmful things — the unchanged progress digest grows
 * `stalledTurns` until it blocks on "no verifiable progress", and every tick
 * wakes the model to look at a Need that only a reviewer can advance, spending
 * the model-step budget on a question it cannot answer.
 *
 * The driver is exercised through its narrow port, so these run without a
 * Cordis context.
 */

const NEED = 'need-gate'

const autopilot = (overrides: Partial<PactFlowAutopilotRecord> = {}): PactFlowAutopilotRecord => ({
  id: 'autopilot-1',
  needId: NEED,
  state: 'running',
  revision: 1,
  scopeDigest: 'd'.repeat(64),
  startedAt: 1,
  expiresAt: Date.now() + 3_600_000,
  repository: 'org/repo',
  branch: 'main',
  startSequence: 0,
  modelSteps: 0,
  wakeCount: 0,
  stalledTurns: 0,
  limits: { maxModelSteps: 50, maxStalledTurns: 3, maxWorkers: 1 },
  ...overrides,
} as PactFlowAutopilotRecord)

const gate = (overrides: Partial<PactFlowReviewGateRecord> = {}): PactFlowReviewGateRecord => ({
  needId: NEED,
  pullRequestNumber: 7,
  pullRequestUrl: 'https://gitea.example/org/repo/pulls/7',
  headCommit: 'a'.repeat(40),
  baseBranch: 'main',
  needRevision: 5,
  closingInputDigest: 'f'.repeat(64),
  requiredApprovals: 2,
  requiredChecks: ['ci/test'],
  openedAt: 1,
  recheckCount: 0,
  maxRechecks: 20,
  lastGap: { missingApprovals: 1, checks: [{ context: 'ci/test', state: 'running' }] },
  ...overrides,
})

function harness(input: {
  readonly gate?: PactFlowReviewGateRecord | undefined
  readonly record?: PactFlowAutopilotRecord
  readonly phase?: string
}) {
  let record = input.record ?? autopilot()
  let currentGate = input.gate
  const agent = { status: 'idle' as const, followup: vi.fn() }
  const blocked: { reason: string; cancel?: boolean }[] = []
  const recheck = vi.fn(async () => {})

  const snapshot = (): PactFlowSnapshot => ({
    project: { project: null },
    needs: { byId: { [NEED]: { id: NEED, title: 'Need', phase: input.phase ?? 'closing', revision: 5 } } },
    dag: { byId: {} },
    runs: { byId: {} },
    delivery: { reviews: {}, documents: {}, releases: {}, cleanups: {}, autopilots: { [NEED]: record } },
  } as never as PactFlowSnapshot)

  const host: AutopilotDriverHost = {
    sessions: () => [{ id: 'session-1', events: [] } as never],
    agent: () => agent as never,
    snapshot,
    check: async () => {},
    flush: async () => {},
    update: (_session, _record, changes) => { record = { ...record, ...changes }; return record },
    block: (_session, _record, reason, cancel) => {
      blocked.push({ reason, ...(cancel === undefined ? {} : { cancel }) })
      record = { ...record, state: 'blocked', reason } as PactFlowAutopilotRecord
    },
    boundedError: error => String(error),
    reviewGate: () => currentGate,
    recheckReviewGate: recheck,
  }

  return {
    driver: new PactFlowAutopilotDriver(host),
    agent,
    blocked,
    recheck,
    get record() { return record },
    settleGate: (next: PactFlowReviewGateRecord | undefined) => { currentGate = next },
  }
}

describe('PactFlow autopilot at a waiting review gate', () => {
  it('does not wake the model while a reviewer has not acted', async () => {
    const h = harness({ gate: gate() })
    await h.driver.tick()
    expect(h.agent.followup).not.toHaveBeenCalled()
    h.driver.dispose()
  })

  it('does not count the wait as a stalled turn', async () => {
    // Several ticks with no reviewer action must not accumulate toward the
    // no-progress limit; the work is outside the platform, not stuck inside it.
    const h = harness({ gate: gate() })
    await h.driver.tick()
    await h.driver.tick()
    await h.driver.tick()
    await h.driver.tick()
    expect(h.record.stalledTurns).toBe(0)
    expect(h.record.state).toBe('running')
    expect(h.blocked).toHaveLength(0)
    h.driver.dispose()
  })

  it('spends no model steps and raises no wake count', async () => {
    const h = harness({ gate: gate() })
    await h.driver.tick()
    await h.driver.tick()
    expect(h.record.modelSteps).toBe(0)
    expect(h.record.wakeCount).toBe(0)
    h.driver.dispose()
  })

  it('rechecks the gate within budget and reports the concrete gap', async () => {
    const h = harness({ gate: gate() })
    await h.driver.tick()
    expect(h.recheck).toHaveBeenCalledTimes(1)
    expect(h.record.reason).toContain('等待外部评审')
    expect(h.record.reason).toContain('尚缺 1 个批准')
    expect(h.record.reason).toContain('ci/test')
    h.driver.dispose()
  })

  it('stops rechecking once the budget runs out but keeps the authorization', async () => {
    const h = harness({ gate: gate({ recheckCount: 20, maxRechecks: 20 }) })
    await h.driver.tick()
    expect(h.recheck).not.toHaveBeenCalled()
    expect(h.record.state).toBe('running')
    expect(h.record.reason).toContain('自动复查已耗尽')
    expect(h.blocked).toHaveLength(0)
    h.driver.dispose()
  })

  it('blocks rather than completing when the PR was merged outside the platform', async () => {
    // Nothing verified that merge commit, its ancestry or the task set, so
    // autopilot must not turn it into a delivery terminal state.
    const h = harness({ gate: gate({ externallyMerged: true }) })
    await h.driver.tick()
    expect(h.recheck).not.toHaveBeenCalled()
    expect(h.blocked[0]?.reason).toContain('平台外被合并')
    expect(h.record.state).toBe('blocked')
    h.driver.dispose()
  })

  it('resumes the ordinary path once the gate is satisfied and closing merged', async () => {
    const h = harness({ gate: gate() })
    await h.driver.tick()
    expect(h.agent.followup).not.toHaveBeenCalled()
    // The recheck merged; the gate is gone and the Need is deployed.
    h.settleGate(undefined)
    await h.driver.tick()
    // Without a gate the driver proceeds as usual (here: wakes the model, since
    // the fixture Need is still in closing) rather than staying parked.
    expect(h.agent.followup).toHaveBeenCalled()
    h.driver.dispose()
  })

  it('leaves a Need without a gate completely unaffected', async () => {
    const h = harness({ gate: undefined })
    await h.driver.tick()
    expect(h.recheck).not.toHaveBeenCalled()
    expect(h.agent.followup).toHaveBeenCalled()
    h.driver.dispose()
  })
})
