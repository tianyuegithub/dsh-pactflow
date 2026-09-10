import { describe, expect, it } from 'vitest'
import { assertReleaseWebReport } from '../../../scripts/release-web-report.mjs'

const files = ['/isolated/web.spec.ts']
function report() {
  return { success: true, numFailedTests: 0, numFailedTestSuites: 0, numPendingTests: 0, numPendingTestSuites: 0,
    numTodoTests: 0, numTotalTests: 1, numPassedTests: 1, numTotalTestSuites: 1, numPassedTestSuites: 1,
    testResults: [{ name: files[0], status: 'passed', assertionResults: [{ status: 'passed' }] }] }
}

describe('PactFlow release Web gate', () => {
  it('accepts a complete all-passed report', () => { expect(() => assertReleaseWebReport(report(), files)).not.toThrow() })
  it.each(['skipped', 'todo', 'missing-suite', 'empty', 'failed', 'malformed', 'skipped-assertion'] as const)('fails closed for %s', variant => {
    const value = report()
    if (variant === 'skipped') value.numPendingTests = 1
    if (variant === 'todo') value.numTodoTests = 1
    if (variant === 'missing-suite') value.testResults = []
    if (variant === 'empty') { value.numTotalTests = 0; value.numPassedTests = 0; value.testResults[0]!.assertionResults = [] }
    if (variant === 'failed') value.success = false
    if (variant === 'skipped-assertion') value.testResults[0]!.assertionResults[0]!.status = 'pending'
    expect(() => assertReleaseWebReport(variant === 'malformed' ? {} : value, files)).toThrow()
  })

  // The gate must be diagnosable from its message alone: it names the specific
  // counter, suite file, or missing suite rather than a generic refusal.
  it('names the offending counter when a count is non-zero', () => {
    const value = report()
    value.numPendingTests = 3
    expect(() => assertReleaseWebReport(value, files)).toThrow(/numPendingTests must be zero but is 3/)
  })

  it('names the offending suite when it has a skipped assertion', () => {
    const value = report()
    value.testResults[0]!.assertionResults[0]!.status = 'pending'
    expect(() => assertReleaseWebReport(value, files)).toThrow(new RegExp(`skipped, or missing assertions \\(${files[0]!}`))
  })

  it('names the missing suite rather than only that something is missing', () => {
    const value = report()
    value.testResults = []
    expect(() => assertReleaseWebReport(value, files)).toThrow(new RegExp(`required suites are missing \\(${files[0]!}`))
  })

  it('names an unexpected suite', () => {
    const value = report()
    value.testResults = [{ name: '/isolated/other.spec.ts', status: 'passed', assertionResults: [{ status: 'passed' }] }]
    expect(() => assertReleaseWebReport(value, files)).toThrow(/unexpected suite \(\/isolated\/other\.spec\.ts\)/)
  })
})
