#!/usr/bin/env node
/**
 * Build the offline distribution directory for the current plugin version:
 *
 *   dist/distribution-<version>/
 *     dsh-pactflow-<version>.tgz                             (plugin package, from `pnpm run pack`)
 *     pactflow-worker-images-<adapter>.docker.tar.gz         (both pinned release-manifest images)
 *     dsh-pactflow-<version>-source.bundle                   (full git history of this repo)
 *     deepseek-harness-pactflow-prerequisites-<hash>.bundle  (verified upstream branch)
 *     SHA256SUMS
 *
 * Run `pnpm run pack` first. Every artifact is regenerated from scratch on each
 * run; verify an extracted copy with `shasum -a 256 -c SHA256SUMS`.
 */
import { execFileSync, execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const pkg = JSON.parse(readFileSync(join(root, 'packages/dsh-pactflow/package.json'), 'utf8'))
const version = pkg.version
const releaseManifest = JSON.parse(readFileSync(join(root, 'packages/dsh-pactflow/worker/dsh/release-manifest.json'), 'utf8'))
const dist = join(root, 'dist')
const out = join(dist, `distribution-${version}`)

const tarballName = `dsh-pactflow-${version}.tgz`
if (!existsSync(join(dist, tarballName))) {
  console.error(`missing ${tarballName} — run \`pnpm run pack\` first`)
  process.exit(1)
}

rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })
copyFileSync(join(dist, tarballName), join(out, tarballName))

// Business and acceptance images share the DSH base layers, so saving both
// pinned refs together costs little beyond a single image. Digest refs from
// release-manifest.json (never mutable tags) keep the archive byte-traceable
// to what the plugin pins at runtime.
const imagesArchive = join(out, `pactflow-worker-images-${releaseManifest.adapterVersion}.docker.tar.gz`)
execSync(`docker save ${releaseManifest.image} ${releaseManifest.acceptanceImage} | gzip > '${imagesArchive}'`, { stdio: 'inherit' })

execFileSync('git', ['bundle', 'create', join(out, `dsh-pactflow-${version}-source.bundle`), '--all'], { cwd: root, stdio: 'inherit' })

// The three upstream capabilities the official DSH release does not carry yet
// (see docs/installation-operations-安装运维.md §1). Skipped with a warning when
// the verified branch is not available locally, so the directory can still be
// rebuilt for recipients who already run a supported host.
const prereqRepo = process.env.DSH_PREREQ_REPO ?? '/Users/ty/Codes/deepseek-harness-pactflow-upstream-pr'
const prereqBranch = 'codex/external-session-event-producers-clean'
try {
  const head = execFileSync('git', ['-C', prereqRepo, 'rev-parse', '--short=10', prereqBranch], { encoding: 'utf8' }).trim()
  execFileSync('git', ['-C', prereqRepo, 'bundle', 'create', join(out, `deepseek-harness-pactflow-prerequisites-${head}.bundle`), prereqBranch], { stdio: 'inherit' })
} catch {
  console.warn(`prerequisites bundle skipped: ${prereqBranch} not found in ${prereqRepo}`)
}

const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')
const entries = readdirSync(out).sort()
const sums = entries.map(name => `${sha256(join(out, name))}  ${name}`).join('\n') + '\n'
writeFileSync(join(out, 'SHA256SUMS'), sums)

for (const name of [...entries, 'SHA256SUMS']) {
  const size = (statSync(join(out, name)).size / (1024 * 1024)).toFixed(1)
  console.log(`${name}  ${size} MB`)
}
console.log(`\nverify: cd dist/distribution-${version} && shasum -a 256 -c SHA256SUMS`)
