import { readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * Fifty spec files import `../lib/index.js` — the build output, not the source.
 * `pnpm test` does not build, so editing `src/**` and running the unit suite
 * exercises whatever was last compiled. A sabotage probe confirmed the hole:
 * `throw new Error(...)` injected into the first line of `initialize()` left all
 * nineteen `domain.spec.ts` cases green, because `lib/index.js` predated it.
 *
 * The consequence is not a slow test run; it is a green that means nothing. So
 * the freshness of the artifacts those specs load is itself asserted here.
 * `pnpm run check` builds first and therefore always satisfies this; the case
 * that turns red is exactly the one that used to lie.
 */

const PACKAGE_ROOT = resolve(import.meta.dirname, '..')

/** Newest modification time anywhere under a directory, skipping build output. */
function newestMtimeMs(dir: string): { path: string; mtimeMs: number } {
  let newest = { path: dir, mtimeMs: 0 }
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      const inner = newestMtimeMs(path)
      if (inner.mtimeMs > newest.mtimeMs) newest = inner
      continue
    }
    if (!entry.isFile()) continue
    const { mtimeMs } = statSync(path)
    if (mtimeMs > newest.mtimeMs) newest = { path, mtimeMs }
  }
  return newest
}

/** Artifacts the unit suite loads, and the sources each one is compiled from. */
const ARTIFACTS: readonly { artifact: string; sources: readonly string[] }[] = [
  { artifact: join('lib', 'index.js'), sources: [join('src')] },
  { artifact: join('lib', 'client.js'), sources: [join('src')] },
  { artifact: join('presets', 'pactflow', 'plugin', 'index.js'), sources: [join('src')] },
]

describe('PactFlow build freshness', () => {
  it.each(ARTIFACTS)('$artifact is not older than the sources it is built from', ({ artifact, sources }) => {
    const artifactPath = join(PACKAGE_ROOT, artifact)
    const built = statSync(artifactPath).mtimeMs

    for (const source of sources) {
      const newest = newestMtimeMs(join(PACKAGE_ROOT, source))
      expect(
        built,
        `${artifact} is older than ${newest.path.slice(PACKAGE_ROOT.length + 1)} — the unit suite would be `
        + 'asserting against stale output. Run `pnpm run build` (or `pnpm run check`) and re-run.',
      ).toBeGreaterThanOrEqual(newest.mtimeMs)
    }
  })

  it('actually reads the artifacts rather than passing on a missing file', () => {
    // A rename or a moved output path must turn this red, not quietly skip.
    for (const { artifact } of ARTIFACTS) {
      expect(statSync(join(PACKAGE_ROOT, artifact)).size).toBeGreaterThan(0)
    }
  })
})
