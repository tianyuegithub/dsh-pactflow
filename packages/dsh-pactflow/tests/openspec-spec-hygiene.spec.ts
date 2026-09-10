import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

// Archiving a change that creates a NEW capability writes a placeholder
// `## Purpose` ("TBD - created by archiving change …"). That placeholder fails
// `openspec validate --all --strict`, which broke the release gate repeatedly
// until each one was rewritten by hand. This guard makes the regression loud at
// `pnpm run check` time instead of at archive time.
const specsRoot = resolve(import.meta.dirname, '..', '..', '..', 'openspec', 'specs')
const PLACEHOLDER = /^\s*(TBD|TODO)\b|created by archiving/i

function specFiles(): { readonly name: string; readonly text: string }[] {
  return readdirSync(specsRoot, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => ({ name: entry.name, text: readFileSync(join(specsRoot, entry.name, 'spec.md'), 'utf8') }))
}

describe('PactFlow OpenSpec spec hygiene', () => {
  it('discovers every capability spec', () => {
    expect(specFiles().length).toBeGreaterThan(0)
  })

  it('gives every capability a real Purpose (never the archive placeholder)', () => {
    const offenders: string[] = []
    for (const spec of specFiles()) {
      const match = /^## Purpose\s*\n([\s\S]*?)(?=\n## |\n*$)/m.exec(spec.text)
      if (match === null) { offenders.push(`${spec.name}: missing ## Purpose`); continue }
      const purpose = match[1]!.trim()
      if (purpose.length === 0) offenders.push(`${spec.name}: empty Purpose`)
      else if (PLACEHOLDER.test(purpose)) offenders.push(`${spec.name}: placeholder Purpose -> ${purpose.slice(0, 60)}`)
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('states at least one Requirement per capability', () => {
    const offenders = specFiles()
      .filter(spec => !/^### Requirement:/m.test(spec.text))
      .map(spec => spec.name)
    expect(offenders, offenders.join(', ')).toEqual([])
  })
})
