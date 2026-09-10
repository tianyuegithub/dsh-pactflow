import { readdirSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { describe, expect, it } from 'vitest'

// development-plan §1 states a hard completion criterion: the Web console must be
// built from DSH Client Module primitives, with NO iframe, NO second web shell, and
// NO private DSH source imports. That was verified by hand; this guards it so a
// future change cannot violate it silently.
//
// "No private DSH source import" means: every deep import into a published package
// must land on a subpath that package DECLARES in its `exports` map. A package that
// declares `"./src/*"` is exposing that tree as public API, so importing it is fine;
// reaching into an UNDECLARED path is the violation.
const srcRoot = resolve(import.meta.dirname, '..', 'src')
const require = createRequire(import.meta.url)

function sourceFiles(dir: string): { readonly path: string; readonly text: string }[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return entry.name.startsWith('.') ? [] : sourceFiles(full)
    return /\.(ts|tsx)$/.test(entry.name) ? [{ path: full, text: readFileSync(full, 'utf8') }] : []
  })
}

/** Export keys of a package, or undefined when it cannot be resolved. */
function declaredExports(pkg: string): readonly string[] | undefined {
  try {
    const manifestPath = require.resolve(`${pkg}/package.json`)
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { exports?: Record<string, unknown> }
    return manifest.exports === undefined ? undefined : Object.keys(manifest.exports)
  } catch {
    return undefined
  }
}

/** Whether a declared export key pattern covers a concrete subpath. */
function subpathDeclared(keys: readonly string[], subpath: string): boolean {
  return keys.some(key => {
    if (key === subpath) return true
    if (!key.includes('*')) return false
    const [head, tail] = key.split('*')
    return subpath.startsWith(head ?? '') && subpath.endsWith(tail ?? '')
  })
}

describe('PactFlow client composition (development-plan §1)', () => {
  const files = sourceFiles(srcRoot)

  it('finds the client sources', () => {
    expect(files.some(f => f.path.startsWith(join(srcRoot, 'client')))).toBe(true)
  })

  it('uses no iframe or second web shell', () => {
    const offenders = files
      .filter(f => /<iframe|<webview\b|ReactDOM\.render|createRoot\(/.test(f.text))
      .map(f => f.path)
    expect(offenders, offenders.join('\n')).toEqual([])
  })

  it('reaches only declared export subpaths of published DSH packages', () => {
    const offenders: string[] = []
    for (const file of files) {
      for (const match of file.text.matchAll(/from\s+['"](@deepseek-ai\/[^'"]+)['"]/g)) {
        const specifier = match[1]!
        const segments = specifier.split('/')
        // @deepseek-ai/<name> is the package; anything after is a subpath.
        const pkg = segments.slice(0, 2).join('/')
        const subpath = `./${segments.slice(2).join('/')}`
        if (segments.length <= 2) continue // package root — always allowed
        const keys = declaredExports(pkg)
        if (keys === undefined) continue // cannot read the manifest; do not guess
        if (!subpathDeclared(keys, subpath)) offenders.push(`${file.path}: ${specifier} (not a declared export)`)
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([])
  })
})
