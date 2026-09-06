import { dirname, resolve } from 'node:path'

export function resolveProfileRuntime({ development = false, source, cliEntry } = {}) {
  if (development) {
    const cwd = resolve(source ?? resolve(import.meta.dirname, '../../deepseek-harness-pactflow-p0'))
    const entry = resolve(cwd, 'apps/cli/src/bin.ts')
    return { kind: 'development', cwd, entry, args: ['--import', 'tsx/esm', entry] }
  }
  if (source !== undefined) throw new Error('DSH_SOURCE is allowed only for explicit development verification')
  if (typeof cliEntry !== 'string' || cliEntry.trim() === '') {
    throw new Error('Set DSH_CLI_ENTRY to the installed DSH JavaScript CLI; source fallback is disabled')
  }
  const entry = resolve(cliEntry)
  if (!/\.[cm]?js$/.test(entry)) throw new Error('DSH_CLI_ENTRY must be an installed JavaScript entry, not TypeScript source')
  return { kind: 'installed-cli', cwd: dirname(entry), entry, args: [entry] }
}
