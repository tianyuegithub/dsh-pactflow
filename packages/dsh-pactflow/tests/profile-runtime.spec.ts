import { describe, expect, it } from 'vitest'
import { resolveProfileRuntime } from '../../../scripts/profile-runtime.mjs'

describe('Profile verification runtime selection', () => {
  it('does not silently select a development worktree', () => {
    expect(() => resolveProfileRuntime({})).toThrow(/DSH_CLI_ENTRY/)
    expect(() => resolveProfileRuntime({ source: '/isolated/source', cliEntry: '/isolated/runtime/lib/bin.js' })).toThrow(/development/)
  })
  it('uses a supplied JavaScript CLI without a TypeScript source loader', () => {
    expect(resolveProfileRuntime({ cliEntry: '/isolated/runtime/lib/bin.js' }).args).toEqual(['/isolated/runtime/lib/bin.js'])
    expect(() => resolveProfileRuntime({ cliEntry: '/isolated/source/bin.ts' })).toThrow(/JavaScript/)
  })
  it('keeps source verification explicit and labelled as development', () => {
    const runtime = resolveProfileRuntime({ development: true, source: '/isolated/source' })
    expect(runtime.kind).toBe('development')
    expect(runtime.args).toEqual(['--import', 'tsx/esm', '/isolated/source/apps/cli/src/bin.ts'])
  })
})
