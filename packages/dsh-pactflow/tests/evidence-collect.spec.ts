import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { collectEvidence } from '../../../scripts/evidence-collect.mjs'
import { ACCEPTANCE_EVIDENCE_TARGETS } from '../../../scripts/evidence-schema.mjs'

// `collectEvidence` was previously exercised by NO test — an earlier refactor of its
// read-and-validate path was therefore verified only by hand. These tests drive it
// through its real entry point (an evidence root on disk) so the path is guarded.
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  delete process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR
})

function evidence(target: string, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { target, command: ['git', 'diff', '--check'], verdict: 'passed',
    evidencePath: 'logs/x.txt', elapsedMs: 3, conclusion: 'verified-fact', ...overrides }
}

/** Build a batch directory rooted at a temp evidence root and point the collector at it. */
function batch(files: Record<string, unknown>, name = 'batch-a'): string {
  const root = mkdtempSync(join(tmpdir(), 'pactflow-evidence-collect-'))
  roots.push(root)
  process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR = root
  const dir = join(root, name)
  for (const [target, value] of Object.entries(files)) {
    const targetDir = join(dir, target)
    mkdirSync(targetDir, { recursive: true })
    writeFileSync(join(targetDir, 'evidence.json'), JSON.stringify(value))
  }
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'zero-proof.json'), JSON.stringify({
    batchId: name, before: [], after: [], cleaning: [],
  }))
  return name
}

describe('PactFlow evidence collector', () => {
  it('collects every target and reports nothing missing for a complete batch', () => {
    const files = Object.fromEntries(ACCEPTANCE_EVIDENCE_TARGETS.map(t => [t, evidence(t)]))
    const result = collectEvidence(batch(files))
    expect(result.evidences).toHaveLength(ACCEPTANCE_EVIDENCE_TARGETS.length)
    expect(result.missing).toEqual([])
  })

  it('reports a missing target rather than counting it as passed', () => {
    const files = Object.fromEntries(ACCEPTANCE_EVIDENCE_TARGETS.slice(1).map(t => [t, evidence(t)]))
    const result = collectEvidence(batch(files))
    expect(result.missing).toEqual([ACCEPTANCE_EVIDENCE_TARGETS[0]])
  })

  it('fails closed on a structurally invalid evidence file (the refactored read-and-validate path)', () => {
    const files = Object.fromEntries(ACCEPTANCE_EVIDENCE_TARGETS.map(t => [t, evidence(t)]))
    files[ACCEPTANCE_EVIDENCE_TARGETS[0]!] = evidence(ACCEPTANCE_EVIDENCE_TARGETS[0]!, { sneaky: true })
    expect(() => collectEvidence(batch(files))).toThrow(/unexpected fields sneaky/)
  })

  it('fails closed on a missing batch directory', () => {
    const root = mkdtempSync(join(tmpdir(), 'pactflow-evidence-collect-'))
    roots.push(root)
    process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR = root
    expect(() => collectEvidence('does-not-exist')).toThrow(/evidence directory not found/)
  })
})
