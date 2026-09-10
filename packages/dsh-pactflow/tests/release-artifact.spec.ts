import { describe, expect, it } from 'vitest'
import { assertArtifactManifest } from '../../../scripts/check-package.mjs'

const REQUIRED = ['lib/index.js', 'cordis.patch.yml', 'LICENSE']
const ENTRIES = ['lib/index.js', 'lib/types/index.d.ts', 'cordis.patch.yml', 'README.md', 'LICENSE', 'package.json']

describe('PactFlow release artifact manifest', () => {
  it('accepts a manifest with all required artifacts and declared entries', () => {
    expect(() => assertArtifactManifest(ENTRIES, REQUIRED, ['lib/index.js', 'lib/types/index.d.ts'])).not.toThrow()
  })

  it('fails closed when a required artifact is missing', () => {
    const without = ENTRIES.filter(entry => entry !== 'LICENSE')
    expect(() => assertArtifactManifest(without, REQUIRED, [])).toThrow(/LICENSE/)
  })

  it('fails closed when a declared entry is absent from the tarball', () => {
    expect(() => assertArtifactManifest(ENTRIES, REQUIRED, ['lib/missing.js'])).toThrow(/lib\/missing\.js/)
  })

  it.each([
    'src/index.ts',
    'src/host/dispatch.ts',
    'node_modules/zod/index.js',
    '.env',
    '.DS_Store',
    'config/.pem',
    'secrets/id_rsa',
    'debug.log',
    'state.tmp',
    'packages/dsh-pactflow/src/k3s-worker.tsx',
  ])('rejects forbidden artifact path %s', forbidden => {
    expect(() => assertArtifactManifest([...ENTRIES, forbidden], REQUIRED, [])).toThrow()
  })

  it('does not misclassify legitimate declaration and lib files as source', () => {
    // .d.ts declaration files and lib/*.js are legitimate; only .ts/.tsx sources are forbidden.
    expect(() => assertArtifactManifest([
      ...ENTRIES, 'lib/redaction.js', 'lib/types/redaction.d.ts', 'lib/types/run-ledger.d.ts',
    ], REQUIRED, [])).not.toThrow()
  })
})
