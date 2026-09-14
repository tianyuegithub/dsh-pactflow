import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, posix } from 'node:path'
import { fileURLToPath } from 'node:url'

const FORBIDDEN_PREFIXES = ['node_modules/', 'packages/', 'src/', 'tests/', 'test/', 'e2e/']
const FORBIDDEN_EXTENSIONS = ['.ts', '.tsx', '.pem', '.key', '.log', '.tmp']
const FORBIDDEN_FILES = ['.env', '.DS_Store', 'id_rsa']

/** One path is forbidden if it is source, a dependency, a secret, or a transient artifact. */
function isForbidden(path) {
  if (FORBIDDEN_PREFIXES.some(prefix => path === prefix.slice(0, -1) || path.startsWith(prefix))) return true
  if (FORBIDDEN_FILES.some(name => path === name || path.endsWith(`/${name}`))) return true
  // .d.ts is a declaration, not a source file; only reject real .ts/.tsx sources.
  if (path.endsWith('.d.ts') || path.endsWith('.d.ts.map')) return false
  if (path.endsWith('.ts.map') || path.endsWith('.tsx.map')) return false
  return FORBIDDEN_EXTENSIONS.some(extension => path.endsWith(extension))
}

/**
 * Judge one exact tarball manifest: every required artifact and declared entry
 * must be present, and no forbidden path may appear. Pure function over the file
 * list so every rule is unit-testable without packing.
 */
export function assertArtifactManifest(paths, required, entries = []) {
  const present = new Set(paths)
  for (const artifact of required) {
    if (!present.has(artifact)) throw new Error(`release artifact is missing required file: ${artifact}`)
  }
  for (const entry of entries) {
    if (entry === undefined || entry === '') continue
    const normalized = entry.replace(/^\.\//, '')
    if (!present.has(normalized)) throw new Error(`release artifact is missing a declared entry: ${normalized}`)
  }
  const forbidden = paths.filter(isForbidden)
  if (forbidden.length > 0) {
    throw new Error(`release artifact contains forbidden path(s): ${forbidden.slice(0, 5).join(', ')}`)
  }
  return paths
}

/** Read the exact file list from a packed tarball. */
function tarballEntries(tarballPath) {
  const listing = execFileSync('tar', ['-tzf', tarballPath], { encoding: 'utf8' })
  return listing.split('\n').map(line => line.trim()).filter(Boolean)
    .filter(line => !line.endsWith('/'))
    .map(line => line.replace(/^package\//, ''))
}

/** Declared entry points that must exist inside the tarball. */
function declaredEntries(manifest) {
  const entries = new Set()
  if (typeof manifest.main === 'string') entries.add(manifest.main)
  if (typeof manifest.types === 'string') entries.add(manifest.types)
  for (const value of Object.values(manifest.bin ?? {})) if (typeof value === 'string') entries.add(value)
  for (const target of Object.values(manifest.exports ?? {})) {
    if (typeof target === 'string') { entries.add(target); continue }
    if (target !== null && typeof target === 'object') {
      for (const value of Object.values(target)) if (typeof value === 'string') entries.add(value)
    }
  }
  return [...entries]
}

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(root, 'packages/dsh-pactflow')

export function checkPackage() {
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'))
const runtimeManifest = JSON.parse(readFileSync(join(packageRoot, 'worker/dsh/runtime-manifest.json'), 'utf8'))
const releaseManifest = JSON.parse(readFileSync(join(packageRoot, 'worker/dsh/release-manifest.json'), 'utf8'))
for (const field of ['protocol', 'adapterVersion', 'dshVersion', 'questionApi']) {
  if (releaseManifest[field] !== runtimeManifest[field]) throw new Error(`worker release manifest disagrees on ${field}`)
}
if (!/^.+@sha256:[a-f0-9]{64}$/.test(releaseManifest.image)) throw new Error('worker release image is not immutable')
const required = [
  'lib/index.js',
  'lib/worker/plugin.js',
  'lib/worker/connect.js',
  'worker/dsh/runtime-manifest.json',
  'worker/dsh/release-manifest.json',
  'worker/dsh/Dockerfile',
  'worker/dsh/runner.mjs',
  'worker/dsh/verification.mjs',
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
  // agent-skill-composition: the skills are package-owned and mounted from the
  // preset's own directory. A tarball without them ships a persona that points
  // at instructions nothing can load.
  'presets/pactflow/skills/pactflow-execution-planning/SKILL.md',
  'presets/pactflow/skills/pactflow-local-recovery/SKILL.md',
  'presets/pactflow/skills/pactflow-autopilot-scope/SKILL.md',
  'presets/pactflow/skills/pactflow-closing-gates/SKILL.md',
  'presets/pactflow/skills/pactflow-infrastructure-resources/SKILL.md',
  'presets/pactflow/skills/pactflow-troubleshooting/SKILL.md',
  'LICENSE',
  'bin/generate-service.mjs',
]

if (manifest.dsh?.bundle?.patch !== './cordis.patch.yml') {
  throw new Error('dsh.bundle.patch must point at ./cordis.patch.yml')
}
if (manifest.dsh?.client?.platform !== 'web') {
  throw new Error('dsh.client.platform must be web')
}
if (manifest.license !== 'Apache-2.0') {
  throw new Error('public package must use Apache-2.0')
}
if (manifest.bin?.['dsh-pactflow-service'] !== 'bin/generate-service.mjs') {
  throw new Error('npm-normalized service bin target must remain bin/generate-service.mjs')
}
for (const dependency of Object.keys(manifest.peerDependencies ?? {})) {
  if (manifest.peerDependenciesMeta?.[dependency]?.optional !== true) {
    throw new Error(`in-box peer ${dependency} must remain optional for public DSH installation`)
  }
}
if (readFileSync(join(packageRoot, 'LICENSE'), 'utf8') !== readFileSync(join(root, 'LICENSE'), 'utf8')) {
  throw new Error('package and repository Apache-2.0 license files must match')
}

// Inspect the exact artifact users install, not just the build directory.
const staging = mkdtempSync(join(tmpdir(), 'pactflow-release-artifact-'))
try {
  execFileSync('npm', ['pack', '--pack-destination', staging], { cwd: packageRoot, stdio: ['ignore', 'ignore', 'inherit'] })
  const tarball = readdirSync(staging).find(name => name.endsWith('.tgz'))
  if (tarball === undefined) throw new Error('npm pack produced no tarball')
  const packedPath = join(staging, tarball)
  const paths = assertArtifactManifest(tarballEntries(packedPath), required, declaredEntries(manifest))
  // Multi-entry builds share chunks. Check the exact packed import closure, so
  // matching entry files alone cannot hide a missing shared runtime chunk.
  const present = new Set(paths)
  for (const file of paths.filter(path => path.endsWith('.js'))) {
    const source = execFileSync('tar', ['-xOf', packedPath, `package/${file}`], { encoding: 'utf8' })
    for (const match of source.matchAll(/(?:from\s*|import\s*)(['"])(\.\.?\/[^'"]+)\1/g)) {
      const dependency = posix.normalize(posix.join(posix.dirname(file), match[2]))
      if (!present.has(dependency)) throw new Error(`packed module ${file} imports missing ${dependency}`)
    }
  }
} finally {
  rmSync(staging, { recursive: true, force: true })
}
console.log(`check-package: ${required.length} required artifact(s) present in the packed tarball`)
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  checkPackage()
}