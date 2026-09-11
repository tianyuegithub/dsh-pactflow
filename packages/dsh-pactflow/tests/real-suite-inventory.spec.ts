import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const e2eRoot = resolve(import.meta.dirname, '../e2e')

// Real-environment suites are triaged into three explicit buckets so none can be
// silently emptied, duplicated, or dropped to make the check look green.
//
// REQUIRED_NOT_RUN: still an honest `expect.fail` skeleton waiting on a real
//   environment or a human actor. Must keep the marker (no weakened assertion).
// IMPLEMENTED: real assertions replace the skeleton; must NOT still be a skeleton.
// COVERED_ELSEWHERE: the suite was intentionally removed because its intent is
//   proven by other evidence; must NOT be re-added as a dead skeleton.
const REQUIRED_NOT_RUN: string[] = []
const IMPLEMENTED = [
  'pactflow-real-approval.e2e.spec.ts',
  'pactflow-real-probe-ledger.e2e.spec.ts',
  'pactflow-real-crash-restart.e2e.spec.ts',
  'pactflow-real-todo-webapp.e2e.spec.ts',
]
const COVERED_ELSEWHERE = {
  // Probe/run Job TTL existence is asserted by tests/k3s-cleanup.spec.ts (run=3600,
  // probe=3600); real short-window ttl-after-finished recycle is observed by
  // scripts/run-real-k3s-batch.mjs `ttlStage` (verified on a real cluster 2026-09-11).
  'pactflow-k3s-ttl.e2e.spec.ts': 'isolated TTL-existence tests + real ttlStage batch stage',
}
const SKELETON_MARKER = "expect.fail('skeleton"

describe('PactFlow real-suite inventory', () => {
  it.each(REQUIRED_NOT_RUN)('%s stays an explicit skeleton (never silently emptied)', file => {
    expect(readFileSync(join(e2eRoot, file), 'utf8')).toContain(SKELETON_MARKER)
  })

  it.each(IMPLEMENTED)('%s carries real assertions rather than a skeleton', file => {
    const source = readFileSync(join(e2eRoot, file), 'utf8')
    expect(source).not.toContain(SKELETON_MARKER)
    expect(/expect\((?!true\)|false\))/.test(source)).toBe(true)
  })

  it.each(Object.entries(COVERED_ELSEWHERE))('%s stays removed (its intent lives elsewhere)', (file, rationale) => {
    expect(existsSync(join(e2eRoot, file)), `covered elsewhere by: ${rationale}`).toBe(false)
  })
})
