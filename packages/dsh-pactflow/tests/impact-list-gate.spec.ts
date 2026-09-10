import { describe, expect, it } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  requireGrantedImpactList,
  loadAndRequireGrantedImpactList,
  validatePreciseImpactList,
  validatePreciseImpactListFile,
} from '../../../scripts/impact-list.schema.mjs'

// The plan (§380) requires a precise impact list with applicable authorization
// before a B-class (mutating) run. These tests cover the enforcement path that was
// previously implemented but never wired: a _well-formed_ list is not enough.
function validList(overrides = {}) {
  return {
    targets: ['real K3s batch: TTL + zero-proof'],
    branches: [{ name: 'pactflow/need/node/x', action: 'create', expectedHead: 'a'.repeat(40) }],
    merges: [{ into: 'main', from: 'pactflow/need/node/x', protective: true }],
    cleanups: [{ kind: 'job', identity: 'dsh-pf-x', precondition: 'uid' }],
    authorization: 'granted',
    ...overrides,
  }
}

describe('PactFlow precise impact list schema', () => {
  it('accepts a well-formed list', () => {
    expect(validatePreciseImpactList(validList())).toMatchObject({ authorization: 'granted' })
  })

  it('rejects unknown fields, empty arrays, and bad enums', () => {
    expect(() => validatePreciseImpactList(validList({ extra: 1 }))).toThrow(/unexpected fields/)
    expect(() => validatePreciseImpactList(validList({ branches: [] }))).toThrow(/non-empty/)
    expect(() => validatePreciseImpactList(validList({
      cleanups: [{ kind: 'pod', identity: 'p', precondition: 'name' }],
    }))).not.toThrow()
    expect(() => validatePreciseImpactList(validList({
      cleanups: [{ kind: 'nope', identity: 'p', precondition: 'name' }],
    }))).toThrow(/kind must be one of/)
    expect(() => validatePreciseImpactList(validList({ authorization: 'maybe' }))).toThrow(/authorization must be/)
  })
})

describe('PactFlow B-class impact-list gate', () => {
  it('refuses a well-formed but ungranted list', () => {
    // Structural validity is not authorization.
    expect(() => requireGrantedImpactList(validList({ authorization: 'pending' })))
      .toThrow(/not authorized \(authorization=pending\)/)
  })

  it('accepts a granted list and still rejects a malformed one', () => {
    expect(requireGrantedImpactList(validList())).toMatchObject({ authorization: 'granted' })
    expect(() => requireGrantedImpactList(validList({ targets: [] }))).toThrow(/non-empty/)
  })

  it('loads, validates, and gates a list from a file', () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-impact-list-'))
    try {
      const granted = join(root, 'granted.json')
      writeFileSync(granted, JSON.stringify(validList()))
      expect(loadAndRequireGrantedImpactList(granted)).toMatchObject({ authorization: 'granted' })

      const pending = join(root, 'pending.json')
      writeFileSync(pending, JSON.stringify(validList({ authorization: 'pending' })))
      expect(() => loadAndRequireGrantedImpactList(pending)).toThrow(/not authorized/)

      const broken = join(root, 'broken.json')
      writeFileSync(broken, '{ not json')
      expect(() => validatePreciseImpactListFile(broken)).toThrow()
      expect(readFileSync(granted, 'utf8')).toContain('granted')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})
