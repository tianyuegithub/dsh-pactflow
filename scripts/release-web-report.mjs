import { resolve } from 'node:path'

/** Release requires evidence for every discovered suite, not merely a zero exit code. */
export function assertReleaseWebReport(report, requiredFiles) {
  if (!report || report.success !== true || !Array.isArray(report.testResults) || requiredFiles.length === 0) {
    throw new Error('Web release gate: missing, failed, or malformed test report')
  }
  for (const key of ['numFailedTests', 'numFailedTestSuites', 'numPendingTests', 'numPendingTestSuites', 'numTodoTests']) {
    if (report[key] !== 0) throw new Error(`Web release gate: ${key} must be zero`)
  }
  if (!Number.isSafeInteger(report.numTotalTests) || report.numTotalTests < 1
    || report.numPassedTests !== report.numTotalTests
    || !Number.isSafeInteger(report.numTotalTestSuites) || report.numTotalTestSuites < 1
    || report.numPassedTestSuites !== report.numTotalTestSuites) {
    throw new Error('Web release gate: incomplete test or suite execution')
  }
  const expected = new Set(requiredFiles.map(file => resolve(file)))
  const seen = new Set()
  let assertions = 0
  for (const result of report.testResults) {
    if (typeof result.name !== 'string' || result.status !== 'passed' || !Array.isArray(result.assertionResults)
      || result.assertionResults.length === 0 || result.assertionResults.some(test => test.status !== 'passed')) {
      throw new Error('Web release gate: suite contains failed, skipped, or missing assertions')
    }
    const file = resolve(result.name)
    if (!expected.has(file) || seen.has(file)) throw new Error('Web release gate: unexpected or duplicate suite')
    seen.add(file)
    assertions += result.assertionResults.length
  }
  if (seen.size !== expected.size || assertions !== report.numTotalTests) {
    throw new Error('Web release gate: required suites or assertions are missing')
  }
}
