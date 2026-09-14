/**
 * Validation-integrity signals for a delivered task commit.
 *
 * A task may legitimately change tests, but if it also rewrites the project's own
 * verification wiring (test/build/CI configuration) the human reviewing the result
 * should see that. This module only *reports* such files; it never blocks a task,
 * and it deliberately does not attempt to judge whether a test was "weakened".
 */

const VALIDATION_SENSITIVE_FILES: readonly string[] = [
  'package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  'vitest.config.ts', 'vitest.config.js', 'jest.config.js', 'jest.config.ts',
  'tsconfig.json', 'tsconfig.base.json', 'Makefile', 'mvnw', 'pom.xml',
]

const VALIDATION_SENSITIVE_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.github\/workflows\//,
  /(^|\/)\.gitlab-ci/,
  /(^|\/)ci\//,
]

/** Whether one changed path touches the project's verification wiring. */
export function isValidationSensitivePath(path: string): boolean {
  // Match on the basename, not the whole path. Exact-string matching only ever
  // saw a file at the repository root, so in a monorepo — this repository
  // included — `packages/x/package.json` and `apps/y/vitest.config.ts` were
  // invisible, and the approval prompt told the reviewer the wiring was untouched.
  const basename = path.slice(path.lastIndexOf('/') + 1)
  if (VALIDATION_SENSITIVE_FILES.includes(basename)) return true
  return VALIDATION_SENSITIVE_PATTERNS.some(pattern => pattern.test(path))
}

/**
 * Validation-sensitive files changed between a task's baseline and its commit,
 * derived from `git diff --name-only` output. Deterministic and order-independent.
 */
export function validationSensitiveChanges(diffOutput: string): readonly string[] {
  const changed = diffOutput.split('\n').map(line => line.trim()).filter(Boolean)
  return [...new Set(changed.filter(isValidationSensitivePath))].sort()
}

/**
 * How many registered validation commands actually ran. Zero means the delivery
 * carries no automatic verification and must not be presented as verified.
 */
export function validationExecutedCount(evidence: { readonly validations: readonly unknown[] }): number {
  return evidence.validations.length
}
