import { execFileSync } from 'node:child_process'
import { mkdtempSync, copyFileSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve, join } from 'node:path'
const root = resolve(import.meta.dirname, '..')
const pkg = join(root, 'packages/dsh-pactflow')
const acceptance = process.argv.includes('--acceptance')
const image = acceptance ? 'pactflow-dsh-interactions:acceptance' : 'pactflow-dsh-interactions:dev'
execFileSync('docker', ['build', '--platform', 'linux/amd64', '-f', join(pkg, 'worker/dsh/Dockerfile'), '-t', 'pactflow-dsh-interactions:dev', pkg], { stdio: 'inherit' })
if (acceptance) {
  const stage = mkdtempSync(join(tmpdir(), 'pactflow-relay-image-'))
  try {
    copyFileSync(join(pkg, 'e2e/fixtures/worker-interaction-acceptance.mjs'), join(stage, 'acceptance.mjs'))
    const runner = readFileSync(join(pkg, 'worker/dsh/runner.mjs'), 'utf8').replace('const patch = `', 'const patch = `- insert:\n    - id: relay-acceptance-hook\n      name: /opt/pactflow-worker/acceptance.mjs\n')
    writeFileSync(join(stage, 'runner.mjs'), runner)
    writeFileSync(join(stage, 'Dockerfile'), 'FROM pactflow-dsh-interactions:dev\nUSER root\nCOPY acceptance.mjs runner.mjs /opt/pactflow-worker/\nRUN chmod -R go-w /opt/pactflow-worker\nUSER 1001:1001\n')
    execFileSync('docker', ['build', '--platform', 'linux/amd64', '-t', image, stage], { stdio: 'inherit' })
  } finally { rmSync(stage, { recursive: true, force: true }) }
}
process.stdout.write(`Built ${image}; no registry push performed by this command\n`)
