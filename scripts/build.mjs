import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const packageRoot = resolve(root, 'packages/dsh-pactflow')
const node = process.execPath
const tsc = resolve(root, 'node_modules/typescript/bin/tsc')
const tsdown = resolve(root, 'node_modules/tsdown/dist/run.mjs')
const generateTypert = resolve(root, 'scripts/generate-typert.mjs')
const lib = resolve(packageRoot, 'lib')

if (existsSync(lib)) rmSync(lib, { recursive: true })

run(tsc, ['-b', 'tsconfig.host.json'])
run(generateTypert, [])
run(tsdown, ['--config', 'tsdown.host.config.ts'], packageRoot)
run(tsdown, ['--config', 'tsdown.agent.config.ts'], packageRoot)
run(tsc, ['-b', 'tsconfig.client.json'])
run(tsdown, ['--config', 'tsdown.client.config.ts'], packageRoot)

function run(entry, args, cwd = root) {
  execFileSync(node, [entry, ...args], { cwd, stdio: 'inherit' })
}
