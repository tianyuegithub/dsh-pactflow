import { resolve } from 'node:path'

/**
 * Release requires evidence for every discovered suite, not merely a zero exit code.
 *
 * Every rejection names the specific offender (which counter, which suite file,
 * which missing suite) so a failing gate is diagnosable from its message alone —
 * the same "make the failure report itself" habit that located this session's
 * harder defects. Pass/fail semantics are unchanged.
 */
export function assertReleaseWebReport(report, requiredFiles) {
  if (!report || report.success !== true || !Array.isArray(report.testResults) || requiredFiles.length === 0) {
    const why = !report ? 'report is empty'
      : report.success !== true ? 'report.success is not true'
      : !Array.isArray(report.testResults) ? 'report.testResults is not an array'
      : 'no required suite files were discovered'
    throw new Error(`Web release gate: missing, failed, or malformed test report (${why})`)
  }
  for (const key of ['numFailedTests', 'numFailedTestSuites', 'numPendingTests', 'numPendingTestSuites', 'numTodoTests']) {
    if (report[key] !== 0) throw new Error(`Web release gate: ${key} must be zero but is ${String(report[key])}`)
  }
  const countProblems = []
  if (!Number.isSafeInteger(report.numTotalTests) || report.numTotalTests < 1) countProblems.push(`numTotalTests=${String(report.numTotalTests)}`)
  if (report.numPassedTests !== report.numTotalTests) countProblems.push(`numPassedTests=${String(report.numPassedTests)} != numTotalTests=${String(report.numTotalTests)}`)
  if (!Number.isSafeInteger(report.numTotalTestSuites) || report.numTotalTestSuites < 1) countProblems.push(`numTotalTestSuites=${String(report.numTotalTestSuites)}`)
  if (report.numPassedTestSuites !== report.numTotalTestSuites) countProblems.push(`numPassedTestSuites=${String(report.numPassedTestSuites)} != numTotalTestSuites=${String(report.numTotalTestSuites)}`)
  if (countProblems.length > 0) {
    throw new Error(`Web release gate: incomplete test or suite execution (${countProblems.join('; ')})`)
  }
  const expected = new Set(requiredFiles.map(file => resolve(file)))
  const seen = new Set()
  let assertions = 0
  for (const result of report.testResults) {
    if (typeof result.name !== 'string' || result.status !== 'passed' || !Array.isArray(result.assertionResults)
      || result.assertionResults.length === 0 || result.assertionResults.some(test => test.status !== 'passed')) {
      const label = typeof result?.name === 'string' ? result.name : JSON.stringify(result)
      throw new Error(`Web release gate: suite contains failed, skipped, or missing assertions (${label})`)
    }
    const file = resolve(result.name)
    if (!expected.has(file)) throw new Error(`Web release gate: unexpected suite (${result.name})`)
    if (seen.has(file)) throw new Error(`Web release gate: duplicate suite (${result.name})`)
    seen.add(file)
    assertions += result.assertionResults.length
  }
  if (seen.size !== expected.size) {
    const missing = [...expected].filter(file => !seen.has(file))
    throw new Error(`Web release gate: required suites are missing (${missing.join(', ')})`)
  }
  if (assertions !== report.numTotalTests) {
    throw new Error(`Web release gate: assertion count ${String(assertions)} does not match numTotalTests ${String(report.numTotalTests)}`)
  }
}
