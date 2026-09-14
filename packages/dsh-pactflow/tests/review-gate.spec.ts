import { describe, expect, it } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  PACTFLOW_REVIEW_GATE_MAX_RECHECKS,
  PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS,
  describeReviewGateGap,
  evaluateReviewGate,
  recordReviewGateObservation,
  reviewGateRecheckDue,
} from '../src/review-gate.ts'
import type { PactFlowGiteaGateState } from '../src/gitea.ts'
import type { PactFlowReviewGateRecord } from '../src/types.ts'

/**
 * Closing used to abandon the Need when the default branch required approvals or
 * status checks, which handed the merge to a person outside the platform — and a
 * hand-merge produces a delivery terminal state the Host never verified. These
 * cases pin the decision the wait state replaces it with.
 */

const record = (overrides: Partial<PactFlowReviewGateRecord> = {}): PactFlowReviewGateRecord => ({
  needId: 'need-1',
  pullRequestNumber: 7,
  pullRequestUrl: 'https://gitea.example/org/repo/pulls/7',
  headCommit: 'a'.repeat(40),
  baseBranch: 'main',
  needRevision: 5,
  closingInputDigest: 'f'.repeat(64),
  requiredApprovals: 2,
  requiredChecks: ['ci/build', 'ci/test'],
  openedAt: 1,
  recheckCount: 0,
  maxRechecks: 20,
  ...overrides,
})

const observed = (overrides: Partial<PactFlowGiteaGateState> = {}): PactFlowGiteaGateState => ({
  number: 7,
  headCommit: 'a'.repeat(40),
  baseBranch: 'main',
  merged: false,
  approvals: 0,
  checks: [
    { context: 'ci/build', state: 'pending' },
    { context: 'ci/test', state: 'pending' },
  ],
  ...overrides,
})

const evaluate = (
  recordOverrides: Partial<PactFlowReviewGateRecord> = {},
  observedOverrides: Partial<PactFlowGiteaGateState> = {},
  currentNeedRevision = 5,
) => evaluateReviewGate({
  record: record(recordOverrides), observed: observed(observedOverrides), currentNeedRevision,
})

describe('PactFlow review gate readiness', () => {
  it('is ready only when approvals are met and every required check succeeded', () => {
    const verdict = evaluate({}, {
      approvals: 2,
      checks: [{ context: 'ci/build', state: 'success' }, { context: 'ci/test', state: 'success' }],
    })
    expect(verdict.kind).toBe('ready')
  })

  it('waits while one approval is still missing', () => {
    const verdict = evaluate({}, {
      approvals: 1,
      checks: [{ context: 'ci/build', state: 'success' }, { context: 'ci/test', state: 'success' }],
    })
    expect(verdict).toMatchObject({ kind: 'waiting' })
    expect(verdict.kind === 'waiting' && verdict.gap.missingApprovals).toBe(1)
  })

  it('waits while a required check is still running', () => {
    const verdict = evaluate({}, {
      approvals: 2,
      checks: [{ context: 'ci/build', state: 'success' }, { context: 'ci/test', state: 'running' }],
    })
    expect(verdict.kind).toBe('waiting')
  })

  it('never treats a check that has not reported as one that passed', () => {
    // Silence is not success: a required context with no status is pending.
    const verdict = evaluate({}, { approvals: 2, checks: [{ context: 'ci/build', state: 'pending' }] })
    expect(verdict.kind).toBe('waiting')
  })

  it('names the concrete gap rather than reporting "not ready"', () => {
    const verdict = evaluate({}, {
      approvals: 1,
      checks: [{ context: 'ci/build', state: 'success' }, { context: 'ci/test', state: 'running' }],
    })
    expect(verdict.kind === 'waiting' && verdict.detail).toContain('尚缺 1 个批准')
    expect(verdict.kind === 'waiting' && verdict.detail).toContain('ci/test')
    expect(verdict.kind === 'waiting' && verdict.detail).toContain('进行中')
  })
})

describe('PactFlow review gate fail-closed conditions', () => {
  it('refuses when the PR head drifted from what the gate was opened against', () => {
    const verdict = evaluate({}, { headCommit: 'b'.repeat(40) })
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'head-drift' })
    expect(verdict.kind === 'refused' && verdict.detail).toContain('b'.repeat(40))
  })

  it('refuses when the base branch changed', () => {
    const verdict = evaluate({}, { baseBranch: 'release' })
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'base-changed' })
  })

  it('refuses when the Need revision moved during the wait', () => {
    const verdict = evaluate({}, {}, 6)
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'subject-drift' })
  })

  it('refuses when a previously successful check turned to failure', () => {
    const verdict = evaluate(
      { lastGap: { missingApprovals: 0, checks: [{ context: 'ci/test', state: 'success' }] } },
      { approvals: 2, checks: [{ context: 'ci/test', state: 'failure' }] },
    )
    expect(verdict).toMatchObject({ kind: 'refused', reason: 'check-regressed' })
    expect(verdict.kind === 'refused' && verdict.detail).toContain('ci/test')
  })

  it('does not call a check that was never green a regression', () => {
    // A check failing for the first time is something CI can retry; the wait
    // continues and the failure is visible. Only success -> failure needs a human.
    const verdict = evaluate({}, { approvals: 2, checks: [{ context: 'ci/test', state: 'failure' }] })
    expect(verdict.kind).toBe('waiting')
  })

  it('reports an outside merge instead of treating it as ready', () => {
    const verdict = evaluate({}, { merged: true, mergeCommit: 'c'.repeat(40) })
    expect(verdict.kind).toBe('externally-merged')
  })

  it('reports an outside merge even when the head also drifted', () => {
    // Reporting "head drifted" about something already merged would describe
    // the wrong problem to whoever has to act on it.
    const verdict = evaluate({}, { merged: true, headCommit: 'b'.repeat(40) })
    expect(verdict.kind).toBe('externally-merged')
  })
})

describe('PactFlow review gate recheck budget', () => {
  it('keeps waiting when the automatic recheck budget runs out', () => {
    // Exhaustion is not a failure and never a merge: what runs out is the
    // platform's patience, not the user's ability to recheck by hand.
    const verdict = evaluate({ recheckCount: 20, maxRechecks: 20 }, { approvals: 1 })
    expect(verdict).toMatchObject({ kind: 'waiting', autoRecheckExhausted: true })
    expect(verdict.kind === 'waiting' && verdict.detail).toContain('自动复查已耗尽')
  })

  it('is not exhausted before the budget is reached', () => {
    const verdict = evaluate({ recheckCount: 19, maxRechecks: 20 }, { approvals: 1 })
    expect(verdict).toMatchObject({ kind: 'waiting', autoRecheckExhausted: false })
  })
})

describe('PactFlow review gate observation folding', () => {
  it('advances the recheck count and remembers the gap for regression detection', () => {
    const before = record()
    const verdict = evaluate({}, {
      approvals: 2, checks: [{ context: 'ci/build', state: 'success' }, { context: 'ci/test', state: 'running' }],
    })
    const after = recordReviewGateObservation(before, verdict, 1_700)
    expect(after.recheckCount).toBe(1)
    expect(after.lastCheckedAt).toBe(1_700)
    expect(after.lastGap?.checks.find(check => check.context === 'ci/build')?.state).toBe('success')
  })

  it('marks an outside merge without discarding the previously observed gap', () => {
    const before = record({ lastGap: { missingApprovals: 1, checks: [{ context: 'ci/test', state: 'success' }] } })
    const after = recordReviewGateObservation(before, { kind: 'externally-merged', detail: 'x' }, 2)
    expect(after.externallyMerged).toBe(true)
    expect(after.lastGap?.checks[0]?.state).toBe('success')
  })

  it('leaves the identity fields of the record untouched', () => {
    const before = record()
    const after = recordReviewGateObservation(before, evaluate(), 3)
    expect(after.headCommit).toBe(before.headCommit)
    expect(after.pullRequestNumber).toBe(before.pullRequestNumber)
    expect(after.closingInputDigest).toBe(before.closingInputDigest)
    expect(after.needRevision).toBe(before.needRevision)
  })
})

describe('PactFlow review gate gap rendering', () => {
  it('says the prerequisites are met when nothing is outstanding', () => {
    expect(describeReviewGateGap({ missingApprovals: 0, checks: [{ context: 'ci/test', state: 'success' }] }))
      .toBe('前置已齐备')
  })

  it('lists each outstanding check by name and state', () => {
    const text = describeReviewGateGap({
      missingApprovals: 2,
      checks: [
        { context: 'ci/build', state: 'success' },
        { context: 'ci/test', state: 'failure' },
        { context: 'ci/lint', state: 'pending' },
      ],
    })
    expect(text).toContain('尚缺 2 个批准')
    expect(text).toContain('ci/test：失败')
    expect(text).toContain('ci/lint：未开始')
    expect(text).not.toContain('ci/build')
  })
})

describe('PactFlow review gate recheck cadence', () => {
  it('allows the first unattended recheck immediately', () => {
    expect(reviewGateRecheckDue(record(), 1_000)).toBe(true)
  })

  it('holds off until the interval has elapsed', () => {
    // The autopilot driver ticks every second; CI does not. Without a floor the
    // wait would hammer the Gitea API once per second.
    const waiting = record({ lastCheckedAt: 100_000 })
    expect(reviewGateRecheckDue(waiting, 100_000 + PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS - 1)).toBe(false)
    expect(reviewGateRecheckDue(waiting, 100_000 + PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS)).toBe(true)
  })

  it('stops once the budget is spent regardless of elapsed time', () => {
    const spent = record({ recheckCount: 40, maxRechecks: 40, lastCheckedAt: 0 })
    expect(reviewGateRecheckDue(spent, 10_000_000)).toBe(false)
  })

  it('covers a realistic CI window before giving up', () => {
    // 40 rechecks at a 30s floor is about twenty unattended minutes: long enough
    // for a normal pipeline, short enough not to poll a repository forever.
    const window = PACTFLOW_REVIEW_GATE_MAX_RECHECKS * PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS
    expect(window).toBeGreaterThanOrEqual(15 * 60 * 1_000)
    expect(window).toBeLessThanOrEqual(60 * 60 * 1_000)
  })
})

describe('PactFlow closing has exactly one merge-and-verify implementation', () => {
  // The waiting path must not grow its own copy of the closing checks: the
  // unprotected path carries years of adversarial coverage (exact merge SHA,
  // ancestry, task set against this baseline, binding-sourced credentials).
  const hostRoot = resolve(import.meta.dirname, '..', 'src')
  // Scan the whole host surface, not just index.ts: the narrow-port modules under
  // src/host/ are exactly where a second copy would naturally be put.
  const hostSources = [
    readFileSync(resolve(hostRoot, 'index.ts'), 'utf8'),
    ...readdirSync(resolve(hostRoot, 'host'))
      .filter(name => name.endsWith('.ts'))
      .map(name => readFileSync(resolve(hostRoot, 'host', name), 'utf8')),
  ].join('\n')
  const source = readFileSync(resolve(hostRoot, 'index.ts'), 'utf8')

  it('mentions the Gitea merge exactly once across the whole host surface', () => {
    // Count every mention rather than the `this.gitea.` spelling: aliasing it
    // (`const gitea = this.gitea`) or destructuring would slip past a
    // prefix-shaped match while adding a real second merge path.
    expect([...hostSources.matchAll(/mergePullRequest\(/g)]).toHaveLength(1)
  })

  it('mentions the merge-commit revalidation exactly once across the whole host surface', () => {
    expect([...hostSources.matchAll(/revalidateMergeCommit\(/g)]).toHaveLength(1)
  })

  it('re-enters closing from the recheck instead of merging inside it', () => {
    const start = source.indexOf('async recheckReviewGate(')
    expect(start).toBeGreaterThan(-1)
    const body = source.slice(start, source.indexOf('\n  /**', start))
    expect(body).toContain('this.closeGitNeed(')
    expect(body).not.toContain('mergePullRequest')
    expect(body).not.toContain('revalidateMergeCommit')
  })

  it('exposes no review-gate write to the Agent tool surface', () => {
    // The gate advances by observation or by a person; a model must not be able
    // to drive a protected-branch merge from its own tool list.
    const agentSource = readFileSync(resolve(import.meta.dirname, '..', 'src', 'agent', 'index.ts'), 'utf8')
    expect(agentSource).not.toContain('recheckReviewGate')
    expect(agentSource).not.toContain('cancelReviewGate')
  })
})
