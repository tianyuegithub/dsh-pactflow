import { readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { checkWebGatePrerequisites, realWebGateEnvironment } from '../../../scripts/run-real-web-gate.mjs'

// The real web gate is the zero-skip release lane: if its prerequisite check were
// silently wrong it would either block a legitimate run or let an UNARMED run
// proceed. The offline-checkable parts are its external prerequisites and its
// arming set's completeness.
describe('PactFlow real web gate prerequisites', () => {
  afterEach(() => { vi.unstubAllEnvs() })

  // The gate's pass condition is zero skips across every discovered suite. If a
  // suite's env switch is absent from the arming set, that suite silently skips
  // and the gate can NEVER pass — the "structurally unsatisfiable gate" failure
  // this lane already hit once. Derive the required switches from the suites
  // themselves so a new gated suite without a matching arm entry fails here.
  it('arms every env switch the discovered e2e suites gate on', () => {
    const e2eRoot = resolve(import.meta.dirname, '../e2e')
    const gated = readdirSync(e2eRoot).filter(file => file.endsWith('.e2e.spec.ts'))
    const required = new Set<string>()
    for (const file of gated) {
      const source = readFileSync(join(e2eRoot, file), 'utf8')
      // The skip condition is bound to one of these consts at module scope.
      for (const line of source.split('\n')) {
        if (!/^const (enabled|record|realDescribe)\b/.test(line)) continue
        for (const match of line.matchAll(/process\.env\.([A-Z0-9_]+)/g)) required.add(match[1]!)
      }
    }
    expect(required.size).toBeGreaterThan(0)
    const armed = new Set(Object.keys(realWebGateEnvironment()))
    expect([...required].filter(name => !armed.has(name))).toEqual([])
  })

  // The suites read credentials from their OWN process env, so the gate must
  // INJECT the refs it checked for. A gate that only verified existence would
  // still leave every record-mode suite failing at beforeAll (reported as
  // skipped), which is exactly the zero-skip break found on the real run.
  it('injects the credential refs the real suites read, not just checks for them', () => {
    const environment = realWebGateEnvironment()
    expect(environment.DSH_SNAPSHOT).toBe('record')
    expect(environment.DSH_REAL_APPROVAL).toBe('1')
    expect(environment.DSH_REAL_CRASH).toBe('1')
    // Pin the injection intent in source (no secret needed): the environment
    // builder must spread the credential resolver, and the credential set must
    // include the record-mode model key.
    const source = readFileSync(resolve(import.meta.dirname, '../../../scripts/run-real-web-gate.mjs'), 'utf8')
    expect(source).toMatch(/gateCredentialEnvironment\(\)/)
    expect(source).toMatch(/REQUIRED_CREDENTIALS\s*=\s*\[[^\]]*'DEEPSEEK_API_KEY'/)
  })

  // The arming switches are supplied by the gate itself, so they must NOT be
  // caller prerequisites: requiring the caller to arm what the gate arms would
  // reject a correct run (this bit `check:release`, which arms internally).
  it('does not demand the caller set switches the gate arms itself', () => {
    vi.stubEnv('DSH_SNAPSHOT', '')
    vi.stubEnv('DSH_REAL_CRASH', '')
    vi.stubEnv('DSH_REAL_APPROVAL', '')
    // Injected probes: the live kubectl probe may block its full 10s timeout on
    // an unreachable cluster, past this runner's 5s budget — the arming-shape
    // assertion must not depend on the real cluster at all.
    const missing = checkWebGatePrerequisites({ reachable: () => true, credential: () => undefined })
    expect(missing).not.toContain('DSH_SNAPSHOT=record (real worker suites must run in record mode)')
    expect(missing.join('\n')).not.toMatch(/DSH_REAL_CRASH/)
    expect(missing.join('\n')).not.toMatch(/DSH_REAL_APPROVAL/)
  })

  it('reports missing credentials by name, and the result is always a string array', () => {
    // Injected probes keep the report deterministic offline: unreachable
    // cluster + unresolvable refs must both be reported by name.
    const missing = checkWebGatePrerequisites({ reachable: () => false, credential: () => undefined })
    expect(missing).toContain('DSH_K3S_E2E environment (kubectl cannot reach namespace pactflow)')
    expect(missing).toContain('DEEPSEEK_API_KEY credential ref (record-mode model suites)')
    expect(missing).toContain('PACTFLOW_GITEA_API_TOKEN credential ref')
    // Whatever the reported entries, the result is always an array of
    // non-empty strings (never null/undefined).
    expect(Array.isArray(missing)).toBe(true)
    expect(missing.every(entry => typeof entry === 'string' && entry.length > 0)).toBe(true)
  })
})
