import { execFileSync } from 'node:child_process'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Pure type checking: never deletes build output, never bundles. The exit code
// reflects type errors only, so `typecheck` and `build` are not the same thing.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const node = process.execPath
const tsc = resolve(root, 'node_modules/typescript/bin/tsc')

for (const project of ['tsconfig.host.json', 'tsconfig.client.json']) {
  execFileSync(node, [tsc, '--noEmit', '-p', project], { cwd: root, stdio: 'inherit' })
}
console.log('typecheck: host and client projects type-check cleanly')
