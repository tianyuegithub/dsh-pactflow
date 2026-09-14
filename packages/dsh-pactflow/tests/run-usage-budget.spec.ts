import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_DEFAULT_RUN_BUDGET,
  boundOutputToBudget,
  evaluateAttemptBudget,
  evaluateUsageBudget,
  parseRunUsage,
} from '../src/run-budget.ts'

/**
 * Token and model-call usage is a NEW budget dimension, and the thing it must
 * never do is pretend.
 *
 * Only the `dsh` executor's adapter is written in this repository, so only it can
 * be made to report usage; a third-party Harness's termination document simply has
 * no such field. Recording that absence as `0` would be a lie with consequences in
 * both directions: it reads as "this run cost nothing", and it lets a budget
 * comparison return a verdict about a quantity nobody measured. "Unavailable" is
 * therefore a first-class state, distinct from a measured zero.
 *
 * The second guard is about authority. attempts, duration and `maxOutputBytes`
 * each remain the single authority for their own dimension — a usage figure must
 * never change what the output cap decides. `run-budgets` already pins that
 * "输出上限必须由运行预算单一权威决定"; adding a dimension must not quietly
 * introduce a second one.
 */

describe('PactFlow run usage is measured or absent, never faked', () => {
  it('reads a reported usage figure', () => {
    const usage = parseRunUsage({ inputTokens: 1_200, outputTokens: 340, modelCalls: 3 })
    expect(usage).toEqual({ available: true, inputTokens: 1_200, outputTokens: 340, modelCalls: 3 })
  })

  it.each([
    ['no document at all', undefined],
    ['a document with no usage section', {}],
    ['a usage section with no numbers', { inputTokens: undefined, outputTokens: undefined, modelCalls: undefined }],
  ] as const)('reports %s as unavailable rather than as zero', (_label, document) => {
    const usage = parseRunUsage(document)
    expect(usage.available).toBe(false)
    // The distinction that matters: nothing here may read as a measured zero.
    expect(usage).not.toHaveProperty('inputTokens')
    expect(usage).not.toHaveProperty('outputTokens')
    expect(usage).not.toHaveProperty('modelCalls')
  })

  it('keeps a genuine zero distinguishable from an absent one', () => {
    // A run that really made no model call is a fact; it is not the same fact as
    // "this Harness does not tell us".
    const measured = parseRunUsage({ inputTokens: 0, outputTokens: 0, modelCalls: 0 })
    expect(measured).toEqual({ available: true, inputTokens: 0, outputTokens: 0, modelCalls: 0 })
    expect(measured.available).not.toBe(parseRunUsage({}).available)
  })

  it.each([
    ['a negative count', { inputTokens: -1, outputTokens: 0, modelCalls: 0 }],
    ['a fractional count', { inputTokens: 1.5, outputTokens: 0, modelCalls: 0 }],
    ['a non-numeric count', { inputTokens: '1200', outputTokens: 0, modelCalls: 0 }],
    ['a partially reported section', { inputTokens: 10, modelCalls: 2 }],
  ] as const)('refuses %s rather than coercing it', (_label, document) => {
    // Coercion here would manufacture a number nobody measured — the same defect
    // as recording absence as zero, arriving by a different route.
    expect(parseRunUsage(document).available).toBe(false)
  })
})

describe('PactFlow usage budget never judges what it did not measure', () => {
  it('returns no verdict when usage is unavailable', () => {
    const verdict = evaluateUsageBudget({ maxModelCalls: 10 }, parseRunUsage({}))
    expect(verdict).toEqual({ exhausted: false, judged: false })
  })

  it('judges only a measured figure', () => {
    const usage = parseRunUsage({ inputTokens: 1, outputTokens: 1, modelCalls: 11 })
    const verdict = evaluateUsageBudget({ maxModelCalls: 10 }, usage)
    expect(verdict.exhausted).toBe(true)
    expect(verdict.judged).toBe(true)
    if (verdict.exhausted) {
      expect(verdict.reason).toBe('model-calls')
      // The refusal names both sides, as every other budget refusal does.
      expect(verdict.detail).toContain('11')
      expect(verdict.detail).toContain('10')
    }
  })

  it('does not judge when no usage budget is configured', () => {
    const usage = parseRunUsage({ inputTokens: 1, outputTokens: 1, modelCalls: 9_999 })
    expect(evaluateUsageBudget({}, usage)).toEqual({ exhausted: false, judged: false })
  })
})

describe('PactFlow usage rides existing payloads, not a new event type', () => {
  it('adds no event type and does not move the producer version', () => {
    // Usage is an optional structured field on the existing run-result payload.
    // A new event type would raise the declared external producer version, and a
    // session created before that upgrade becomes write-frozen — so the cost of
    // getting this wrong is paid by existing projects, not by this change.
    const domain = readFileSync(resolve(import.meta.dirname, '..', 'src', 'domain.ts'), 'utf8')
    for (const name of ['usage', 'token', 'modelCalls', 'toolInvocation']) {
      const declared = new RegExp(`PACTFLOW_EVENT_TYPES_V0_\\d+[^]*?pactflow/[a-z-]*${name}`, 'i')
      expect(declared.test(domain), `an event type mentioning "${name}" was declared`).toBe(false)
    }
    // Deliberately not pinned to a literal version: this guard is about the usage
    // dimension not adding an event type, not about freezing the vocabulary against
    // every other change. `need-attachments` legitimately moved it to 0.8.0 by
    // adding `pactflow/attachment-linked`, and that must not read as a failure here.
    expect(domain).toMatch(/PACTFLOW_EVENT_PRODUCER_VERSION = '\d+\.\d+\.\d+'/)
  })

  it('keeps the usage type optional so an older reader parses without it', () => {
    // An older reader sees a run result with no usage section; that has to remain
    // a legal document, not a parse failure.
    expect(parseRunUsage({ exitCode: 0, commit: 'a'.repeat(40) }).available).toBe(false)
    expect(() => parseRunUsage({ exitCode: 0 })).not.toThrow()
  })
})

describe('PactFlow usage does not become a second authority', () => {
  it('leaves the output cap decided by maxOutputBytes alone', () => {
    // Adversarial: whatever usage says, the output bound must be identical.
    const text = '中'.repeat(5_000)
    const withoutUsage = boundOutputToBudget(text, PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes)
    const usage = parseRunUsage({ inputTokens: 999_999, outputTokens: 999_999, modelCalls: 999 })
    expect(usage.available).toBe(true)
    const withUsage = boundOutputToBudget(text, PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes)
    expect(withUsage).toEqual(withoutUsage)
  })

  it('leaves the attempt budget decided by maxAttempts alone', () => {
    const usage = parseRunUsage({ inputTokens: 0, outputTokens: 0, modelCalls: 999 })
    expect(usage.available).toBe(true)
    expect(evaluateAttemptBudget(5, 3)).toEqual({ exhausted: false })
    expect(evaluateAttemptBudget(5, 6).exhausted).toBe(true)
  })

  it('carries no usage field in the default budget, so it is opt-in', () => {
    // A default usage ceiling would start judging every existing run against a
    // number nobody chose.
    expect(PACTFLOW_DEFAULT_RUN_BUDGET).not.toHaveProperty('maxModelCalls')
  })
})
