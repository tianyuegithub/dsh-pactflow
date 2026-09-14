import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { EVIDENCE_MAX_DEPTH, resolveEvidenceBatch, walkEvidence } from '../../../scripts/evidence-path.mjs'

const roots: string[] = []
function root(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pactflow-evidence-path-'))
  roots.push(dir)
  return dir
}
afterEach(() => { for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true }) })

describe('PactFlow evidence path hygiene', () => {
  it('rejects absolute batch paths and escapes outside the evidence root', () => {
    const base = root()
    expect(() => resolveEvidenceBatch(base, '/etc')).toThrow(/relative name/)
    expect(() => resolveEvidenceBatch(base, '../../etc')).toThrow(/escapes the evidence root/)
    expect(() => resolveEvidenceBatch(base, '../sibling')).toThrow(/escapes the evidence root/)
  })

  it('accepts a nested batch name inside the evidence root', () => {
    const base = root()
    expect(resolveEvidenceBatch(base, 'batch-a')).toBe(join(resolve(base), 'batch-a'))
    expect(resolveEvidenceBatch(base, join('batch-a', 'inner'))).toBe(join(resolve(base), 'batch-a', 'inner'))
    expect(resolveEvidenceBatch(base, undefined)).toBe(resolve(base))
  })

  it('does not follow symlinked directories during a walk', () => {
    const base = root()
    writeFileSync(join(base, 'evidence.json'), '{}')
    const outside = root()
    writeFileSync(join(outside, 'evidence.json'), '{"outside":true}')
    symlinkSync(outside, join(base, 'linked'), 'dir')
    const seen: string[] = []
    walkEvidence(base, (name, full) => { if (name === 'evidence.json') seen.push(full) })
    expect(seen).toHaveLength(1)
    expect(seen[0]!.startsWith(resolve(base))).toBe(true)
  })

  it('fails closed when the evidence tree exceeds the depth limit', () => {
    const base = root()
    let current = base
    for (let index = 0; index <= EVIDENCE_MAX_DEPTH + 1; index += 1) {
      current = join(current, `d${String(index)}`)
      mkdirSync(current)
    }
    expect(() => walkEvidence(base, () => {})).toThrow(/maximum depth/)
  })
})

describe('PactFlow typecheck entry hygiene', () => {
  const packageRoot = resolve(import.meta.dirname, '..', '..', '..')

  it('is not the build script and does not delete build output', () => {
    const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8')) as {
      scripts?: Record<string, string>
    }
    expect(manifest.scripts?.typecheck).not.toContain('build.mjs')
    const source = readFileSync(join(packageRoot, 'scripts', 'typecheck.mjs'), 'utf8')
    expect(source).toContain('--noEmit')
    expect(source).not.toContain('rmSync')
    expect(source).not.toContain('tsdown')
  })
})

describe('PactFlow verification-script hygiene', () => {
  const packageRoot = resolve(import.meta.dirname, '..', '..', '..')
  const scriptsRoot = join(packageRoot, 'scripts')

  it('parses every verification script (a syntactically broken gate never runs)', () => {
    // A gate that cannot even be parsed is worse than no gate: it reports failure
    // (or hangs) for reasons unrelated to what it verifies. Parse them all.
    for (const name of readdirSync(scriptsRoot)) {
      if (!name.endsWith('.mjs')) continue
      const file = join(scriptsRoot, name)
      // Throws on a syntax error.
      execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
    }
  })

  it('does not reference timeout constants before their declaration', () => {
    // `verify-profile.mjs` once used COMMAND_TIMEOUT_MS inside a top-level try that
    // precedes its `const` — a temporal-dead-zone ReferenceError that made the whole
    // gate unrunnable. Guard the invariant: a timeout const must be declared before
    // the first top-level `try {` that could call `run(...)`.
    const source = readFileSync(join(scriptsRoot, 'verify-profile.mjs'), 'utf8')
    const declIndex = source.indexOf('const COMMAND_TIMEOUT_MS')
    const tryIndex = source.indexOf('try {')
    expect(declIndex, 'COMMAND_TIMEOUT_MS must be declared').toBeGreaterThan(-1)
    expect(tryIndex, 'expected a top-level try block').toBeGreaterThan(-1)
    expect(declIndex).toBeLessThan(tryIndex)
  })

  it('type-checks leaf projects rather than empty solution stubs', () => {
    // `tsconfig.host.json` / `tsconfig.client.json` at the root are solution files:
    // `{"files": [], "references": [...]}`. `tsc --noEmit -p` on one of those checks
    // the empty file list and exits 0 WITHOUT descending into the referenced
    // project, so the entry point reported "type-check cleanly" while src/index.ts
    // held 18 real errors. The contract already says a type error must exit
    // non-zero; this keeps the entry point pointed at projects that actually have
    // sources to check.
    const source = readFileSync(join(scriptsRoot, 'typecheck.mjs'), 'utf8')
    const projects = [...source.matchAll(/'([^']*tsconfig\.[a-z]+\.json)'/g)].map(match => match[1]!)
    expect(projects.length, 'typecheck.mjs must name the projects it checks').toBeGreaterThan(0)
    for (const project of projects) {
      const config = JSON.parse(readFileSync(resolve(scriptsRoot, '..', project), 'utf8')) as {
        files?: readonly string[]
        include?: readonly string[]
      }
      const inputs = (config.files?.length ?? 0) + (config.include?.length ?? 0)
      expect(inputs, `${project} has no sources, so checking it proves nothing`).toBeGreaterThan(0)
    }
  })
})
