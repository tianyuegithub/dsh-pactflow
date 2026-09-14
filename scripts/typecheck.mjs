import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pure type checking: never deletes build output, never bundles. The exit code
// reflects type errors only, so `typecheck` and `build` are not the same thing.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const node = process.execPath
const tsc = resolve(root, 'node_modules/typescript/bin/tsc')

// Check the LEAF projects, not the solution files at the root. The root configs
// are `{"files": [], "references": [...]}`; `tsc --noEmit -p` on one of those
// checks the empty file list and exits 0 without ever descending into the
// referenced project, so this script used to report "type-check cleanly" while
// src/index.ts held real errors. Build mode (`-b`) would follow references but
// writes output, which this script must not do.
const PROJECTS = [
  'packages/dsh-pactflow/tsconfig.host.json',
  'packages/dsh-pactflow/tsconfig.client.json',
]

for (const project of PROJECTS) {
  execFileSync(node, [tsc, '--noEmit', '-p', project], { cwd: root, stdio: 'inherit' })
}
console.log(`typecheck: ${String(PROJECTS.length)} project(s) type-check cleanly`)
