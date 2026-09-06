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
})
