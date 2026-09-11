import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import yaml from 'js-yaml'

// One reader for the on-machine credential store, shared by every real suite
// runner and both release gates. Values are only ever handed to a child process
// through its environment (never argv, never a log line), matching
// `scripts/run-real-worker-e2e.mjs`.

/** The credential file (env override honored, matching the product's own layering). */
export function credentialFilePath() {
  return resolve(process.env.DSH_CREDENTIAL_FILE ?? resolve(homedir(), '.dsh/.credentials.yaml'))
}

/** One credential value from the store alone, or undefined. Never throws. */
export function storedCredential(name) {
  try {
    const document = yaml.load(readFileSync(credentialFilePath(), 'utf8'))
    const value = document?.refs?.[name] ?? document?.[name]
    return typeof value === 'string' && value.length > 0 ? value : undefined
  } catch {
    return undefined
  }
}

/** One credential the launching environment wins, then the store — the product's resolution order. */
export function resolveCredential(name) {
  const fromEnvironment = process.env[name]
  if (typeof fromEnvironment === 'string' && fromEnvironment.length > 0) return fromEnvironment
  return storedCredential(name)
}
