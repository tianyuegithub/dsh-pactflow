import { describe, expect, it } from 'vitest'
import {
  isValidationSensitivePath,
  validationExecutedCount,
  validationSensitiveChanges,
} from '../src/validation-integrity.ts'

describe('PactFlow validation integrity signal', () => {
  it('sees verification wiring inside a monorepo package, not only at the root', () => {
    // Exact-path matching only ever saw the repository root. This repository is
    // itself a monorepo, so its own `packages/dsh-pactflow/package.json` was in
    // the blind spot, and the approval prompt reported "无" for a commit that
    // rewrote it.
    expect(validationSensitiveChanges([
      'packages/dsh-pactflow/package.json',
      'apps/web/vitest.config.ts',
      'services/api/pom.xml',
      'src/feature.ts',
    ].join('\n'))).toEqual([
      'apps/web/vitest.config.ts', 'packages/dsh-pactflow/package.json', 'services/api/pom.xml',
    ])
  })

  it('does not mistake an unrelated file whose name merely ends the same way', () => {
    expect(validationSensitiveChanges([
      'docs/not-package.json', 'src/mypom.xml', 'src/Makefile.md',
    ].join('\n'))).toEqual([])
  })

  it('flags a commit that touches the project verification wiring', () => {
    const diff = ['package.json', 'src/feature.ts', 'vitest.config.ts', '.github/workflows/ci.yml'].join('\n')
    expect(validationSensitiveChanges(diff)).toEqual([
      '.github/workflows/ci.yml', 'package.json', 'vitest.config.ts',
    ])
  })

  it('does not flag ordinary source changes', () => {
    const diff = ['src/api.ts', 'src/client/panel.tsx', 'README.md'].join('\n')
    expect(validationSensitiveChanges(diff)).toEqual([])
  })

  it('is order-independent and deduplicates', () => {
    const diff = ['package.json', 'package.json', 'pom.xml'].join('\n')
    expect(validationSensitiveChanges(diff)).toEqual(['package.json', 'pom.xml'])
  })

  it('recognises lockfiles and CI directories as sensitive', () => {
    for (const path of ['pnpm-lock.yaml', 'yarn.lock', 'pom.xml', 'ci/build.sh', '.gitlab-ci.yml']) {
      expect(isValidationSensitivePath(path)).toBe(true)
    }
    for (const path of ['src/main.ts', 'docs/guide.md', 'lib/index.js']) {
      expect(isValidationSensitivePath(path)).toBe(false)
    }
  })

  it('reports zero executed commands for a delivery with no automatic verification', () => {
    expect(validationExecutedCount({ validations: [] })).toBe(0)
    expect(validationExecutedCount({ validations: [{}] })).toBe(1)
  })
})
