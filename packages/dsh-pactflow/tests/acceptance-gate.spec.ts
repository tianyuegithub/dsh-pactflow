import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertAcceptanceResult, collectForGate } from '../../../scripts/acceptance-gate.mjs'
import { preserveReport } from '../../../scripts/evidence-store.mjs'
import { ACCEPTANCE_EVIDENCE_TARGETS } from '../../../scripts/evidence-schema.mjs'

function evidence(target, overrides = {}) {
  return {
    target,
    command: ['pnpm', 'run', 'check'],
    verdict: 'passed',
    evidencePath: `/evidence/${target}.txt`,
    elapsedMs: 10,
    conclusion: 'verified-fact',
    ...overrides,
  }
}

function zeroProof(batchId = 'batch') {
  return { batchId, before: [{ kind: 'pod', count: 0 }], after: [{ kind: 'pod', count: 0 }], cleaning: [] }
}

const dirs = []
const priorEvidenceRoot = process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR

/** Each test gets its own evidence root; batch names are resolved relative to it. */
function useEvidenceRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'pactflow-gate-root-'))
  dirs.push(root)
  process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR = root
  return root
}
function batchDir(name: string): string {
  const dir = join(process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR!, name)
  mkdirSync(dir, { recursive: true })
  return dir
}
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  if (priorEvidenceRoot === undefined) delete process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR
  else process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR = priorEvidenceRoot
})

describe('PactFlow acceptance gate', () => {
  it('accepts a batch whose every target is passed and verified, with zero-proof', () => {
    useEvidenceRoot()
    const root = batchDir('pass')
    for (const target of ACCEPTANCE_EVIDENCE_TARGETS) {
      const targetDir = join(root, target)
      mkdirSync(targetDir)
      writeFileSync(join(targetDir, 'evidence.json'), JSON.stringify(evidence(target)))
    }
    writeFileSync(join(root, 'zero-proof.json'), JSON.stringify(zeroProof()))
    const result = collectForGate('pass')
    expect(() => assertAcceptanceResult(result)).not.toThrow()
    expect(result.evidences.length).toBe(ACCEPTANCE_EVIDENCE_TARGETS.length)
  })

  it('fails closed for all-failed evidence that the collector would still return', () => {
    useEvidenceRoot()
    const root = batchDir('failed')
    for (const target of ACCEPTANCE_EVIDENCE_TARGETS) {
      const targetDir = join(root, target)
      mkdirSync(targetDir)
      writeFileSync(join(targetDir, 'evidence.json'), JSON.stringify(evidence(target, { verdict: 'failed' })))
    }
    writeFileSync(join(root, 'zero-proof.json'), JSON.stringify(zeroProof()))
    expect(() => assertAcceptanceResult(collectForGate('failed'))).toThrow(/verdict is "failed"/)
  })

  it('fails closed for an unknown conclusion even when the verdict passed', () => {
    useEvidenceRoot()
    const root = batchDir('unknown')
    for (const target of ACCEPTANCE_EVIDENCE_TARGETS) {
      const targetDir = join(root, target)
      mkdirSync(targetDir)
      writeFileSync(join(targetDir, 'evidence.json'), JSON.stringify(evidence(target, {
        conclusion: target === '5.1' ? 'unknown' : 'verified-fact',
      })))
    }
    writeFileSync(join(root, 'zero-proof.json'), JSON.stringify(zeroProof()))
    expect(() => assertAcceptanceResult(collectForGate('unknown'))).toThrow(/conclusion is "unknown"/)
  })

  it('fails closed when a target is missing or zero-proof is absent', () => {
    useEvidenceRoot()
    const missing = batchDir('missing')
    mkdirSync(join(missing, '5.1'))
    writeFileSync(join(missing, '5.1', 'evidence.json'), JSON.stringify(evidence('5.1')))
    writeFileSync(join(missing, 'zero-proof.json'), JSON.stringify(zeroProof()))
    expect(() => assertAcceptanceResult(collectForGate('missing'))).toThrow(/missing evidence/)

    const noZero = batchDir('no-zero')
    for (const target of ACCEPTANCE_EVIDENCE_TARGETS) {
      const targetDir = join(noZero, target)
      mkdirSync(targetDir)
      writeFileSync(join(targetDir, 'evidence.json'), JSON.stringify(evidence(target)))
    }
    expect(() => assertAcceptanceResult(collectForGate('no-zero'))).toThrow(/missing zero-proof/)
  })

  it('rejects a missing batch directory instead of treating it as empty', () => {
    useEvidenceRoot()
    expect(() => collectForGate('pactflow-gate-does-not-exist-xyz')).toThrow(/not found/)
  })
})

describe('PactFlow evidence preservation', () => {
  it('copies the report out of the temporary directory before cleanup', () => {
    const root = useEvidenceRoot()
    const reportPath = join(root, 'web-results.json')
    writeFileSync(reportPath, JSON.stringify({ failed: true }))
    const store = join(root, 'store')
    mkdirSync(store)
    process.env.PACTFLOW_REPORT_DIR = store
    try {
      const preserved = preserveReport(reportPath, 'unit')
      expect(preserved).toBeDefined()
      rmSync(reportPath, { force: true })
      expect(() => JSON.parse(readFileSync(preserved!, 'utf8'))).not.toThrow()
    } finally {
      delete process.env.PACTFLOW_REPORT_DIR
    }
  })
})
