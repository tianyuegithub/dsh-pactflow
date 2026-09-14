import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { PACTFLOW_EVENT_PRODUCER_VERSION } from '../src/domain.ts'

// The shipped worker image manifest records which host this image was built and
// verified against. Those numbers are a compatibility record for anyone
// reconciling an image digest with a host build, so a stale figure is a real
// defect — the same class the operator-manual event-count guard was created for
// (that one caught a documented 13 against a shipped 17).
//
// `hostEventProducerVersion` had been wrong since the commit that introduced it
// (1594fa5 moved the constant 0.3.0 -> 0.6.0 and wrote 0.5.0 into the manifest in
// the same commit; 3146903 refreshed the digests and adapterVersion without
// touching it). Nothing read the field, so nothing caught it.
const manifest = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '..', 'worker', 'dsh', 'release-manifest.json'),
  'utf8',
)) as Record<string, unknown>

const pluginPackage = JSON.parse(readFileSync(
  resolve(import.meta.dirname, '..', 'package.json'),
  'utf8',
)) as { version: string }

describe('PactFlow worker release manifest accuracy', () => {
  it('declares the host event producer version the code actually registers', () => {
    expect(
      manifest.hostEventProducerVersion,
      `release-manifest.json declares hostEventProducerVersion ${JSON.stringify(manifest.hostEventProducerVersion)}`
      + ` but the host registers ${JSON.stringify(PACTFLOW_EVENT_PRODUCER_VERSION)}`,
    ).toBe(PACTFLOW_EVENT_PRODUCER_VERSION)
  })

  it('declares the host plugin version the package actually ships', () => {
    expect(
      manifest.hostPluginVersion,
      `release-manifest.json declares hostPluginVersion ${JSON.stringify(manifest.hostPluginVersion)}`
      + ` but the package ships ${JSON.stringify(pluginPackage.version)}`,
    ).toBe(pluginPackage.version)
  })
})
