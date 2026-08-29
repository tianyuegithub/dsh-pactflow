import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(root, 'packages/dsh-pactflow')
const manifest = JSON.parse(readFileSync(resolve(packageRoot, 'package.json'), 'utf8'))
const required = [
  'lib/index.js',
  'lib/client.js',
  'lib/typert.host.js',
  'lib/typert.host.d.ts',
  'lib/typert.remote-client.js',
  'lib/typert.remote-client.d.ts',
  'cordis.patch.yml',
  'presets/pactflow/agent.cordis.yml',
  'presets/pactflow/preset.yml',
  'presets/pactflow/plugin/index.js',
  'presets/pactflow/plugin/package.json',
]

for (const relative of required) {
  readFileSync(resolve(packageRoot, relative))
}
if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('dsh.bundle.patch must point at ./cordis.patch.yml')
}
if (manifest.dsh?.client?.platform !== 'web') {
  throw new Error('dsh.client.platform must be web')
}
console.log(`check-package: ${required.length} required artifact(s) present`)
