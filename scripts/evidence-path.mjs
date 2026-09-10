import { lstatSync, readdirSync } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'

export const EVIDENCE_MAX_DEPTH = 8
export const EVIDENCE_MAX_ENTRIES = 10_000

/**
 * Resolve a batch name to a directory strictly inside the evidence root. Absolute
 * paths and paths that normalise outside the root (e.g. `../../etc`) are rejected,
 * so an imported acceptance bundle cannot escape the evidence root.
 */
export function resolveEvidenceBatch(evidenceRoot, batch) {
  if (!batch) return evidenceRoot
  if (isAbsolute(batch)) {
    throw new Error(`evidence batch must be a relative name inside the evidence root: ${batch}`)
  }
  const target = resolve(evidenceRoot, batch)
  const root = resolve(evidenceRoot)
  if (target !== root && !target.startsWith(`${root}${sep}`)) {
    throw new Error(`evidence batch escapes the evidence root: ${batch}`)
  }
  return target
}

/**
 * Walk one evidence directory without following symlinks and within bounded depth
 * and entry count. `onFile(name, fullPath, depth)` decides how to read each entry.
 */
export function walkEvidence(directory, onFile) {
  let entries = 0
  const visit = (current, depth) => {
    if (depth > EVIDENCE_MAX_DEPTH) {
      throw new Error(`evidence directory exceeds the maximum depth of ${EVIDENCE_MAX_DEPTH}`)
    }
    for (const name of readdirSync(current)) {
      entries += 1
      if (entries > EVIDENCE_MAX_ENTRIES) {
        throw new Error(`evidence directory exceeds the maximum of ${EVIDENCE_MAX_ENTRIES} entries`)
      }
      const full = join(current, name)
      const stat = lstatSync(full)
      if (stat.isSymbolicLink()) continue
      if (stat.isDirectory()) { visit(full, depth + 1); continue }
      onFile(name, full)
    }
  }
  visit(directory, 0)
}
