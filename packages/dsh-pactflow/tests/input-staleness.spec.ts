import { describe, expect, it } from 'vitest'
import { staleCodeInputs } from '../src/input-staleness.ts'

describe('PactFlow code-input staleness', () => {
  it('reports no staleness when each recorded input still matches the predecessor latest commit', () => {
    const recorded = [{ dependency: 'a', branch: 'pactflow/need/a/x', commit: 'a'.repeat(40) }]
    const latest = new Map([['a', 'a'.repeat(40)]])
    expect(staleCodeInputs(recorded, latest)).toEqual([])
  })

  it('reports the dependency whose commit moved on after the successor ran', () => {
    const recorded = [{ dependency: 'a', branch: 'pactflow/need/a/x', commit: 'a'.repeat(40) }]
    const latest = new Map([['a', 'b'.repeat(40)]])
    const stale = staleCodeInputs(recorded, latest)
    expect(stale).toHaveLength(1)
    expect(stale[0]).toMatchObject({ dependency: 'a', branch: 'pactflow/need/a/x', recorded: 'a'.repeat(40), latest: 'b'.repeat(40) })
  })

  it('is deterministic and sorted by dependency then branch', () => {
    const recorded = [
      { dependency: 'z', branch: 'pactflow/need/z/x', commit: '1'.repeat(40) },
      { dependency: 'a', branch: 'pactflow/need/a/x', commit: '2'.repeat(40) },
    ]
    const latest = new Map([['a', '3'.repeat(40)], ['z', '4'.repeat(40)]])
    expect(staleCodeInputs(recorded, latest).map(entry => entry.dependency)).toEqual(['a', 'z'])
  })

  it('does not mark staleness for a dependency with no known latest commit', () => {
    const recorded = [{ dependency: 'a', branch: 'pactflow/need/a/x', commit: 'a'.repeat(40) }]
    expect(staleCodeInputs(recorded, new Map())).toEqual([])
  })
})
