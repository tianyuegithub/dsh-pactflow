import { readFileSync } from 'node:fs'

const BRANCH_ACTIONS = ['create', 'delete', 'read-only']
const CLEANUP_KINDS = ['job', 'pod', 'configmap', 'secret', 'git-ref', 'temp-dir']
const CLEANUP_PRECONDITIONS = ['uid', 'commit', 'name']

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0
}

function isStringArray(value) {
  return Array.isArray(value) && value.length > 0 && value.every(isNonEmptyString)
}

function hasExactlyKeys(value, keys, label) {
  const actual = Object.keys(value)
  const extra = actual.filter(key => !keys.includes(key))
  if (extra.length > 0) throw new Error(`${label}: unexpected fields ${extra.join(', ')}`)
  const missing = keys.filter(key => !(key in value))
  if (missing.length > 0) throw new Error(`${label}: missing required fields ${missing.join(', ')}`)
}

/** PreciseImpactList 结构校验（spec 6.1 五块 + 分支/清理身份前置）。 */
export function validatePreciseImpactList(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('precise impact list: must be a non-null object')
  }
  hasExactlyKeys(input, ['targets', 'branches', 'merges', 'cleanups', 'authorization'], 'precise impact list')
  if (!isStringArray(input.targets)) throw new Error('precise impact list: targets must be a non-empty string array')
  if (!Array.isArray(input.branches) || input.branches.length === 0) {
    throw new Error('precise impact list: branches must be a non-empty array')
  }
  for (const branch of input.branches) {
    hasExactlyKeys(branch, ['name', 'action', 'expectedHead'], 'branch')
    if (!isNonEmptyString(branch.name)) throw new Error('branch: name must be a non-empty string')
    if (!BRANCH_ACTIONS.includes(branch.action)) {
      throw new Error(`branch: action must be one of ${BRANCH_ACTIONS.join('|')}`)
    }
    if (branch.expectedHead !== undefined && !isNonEmptyString(branch.expectedHead)) {
      throw new Error('branch: expectedHead must be a non-empty string when present')
    }
  }
  if (!Array.isArray(input.merges) || input.merges.length === 0) {
    throw new Error('precise impact list: merges must be a non-empty array')
  }
  for (const merge of input.merges) {
    hasExactlyKeys(merge, ['into', 'from', 'protective'], 'merge')
    if (!isNonEmptyString(merge.into) || !isNonEmptyString(merge.from)) {
      throw new Error('merge: into and from must be non-empty strings')
    }
    if (typeof merge.protective !== 'boolean') throw new Error('merge: protective must be a boolean')
  }
  if (!Array.isArray(input.cleanups) || input.cleanups.length === 0) {
    throw new Error('precise impact list: cleanups must be a non-empty array')
  }
  for (const cleanup of input.cleanups) {
    hasExactlyKeys(cleanup, ['kind', 'identity', 'precondition'], 'cleanup')
    if (!CLEANUP_KINDS.includes(cleanup.kind)) {
      throw new Error(`cleanup: kind must be one of ${CLEANUP_KINDS.join('|')}`)
    }
    if (!isNonEmptyString(cleanup.identity)) throw new Error('cleanup: identity must be a non-empty string')
    if (!CLEANUP_PRECONDITIONS.includes(cleanup.precondition)) {
      throw new Error(`cleanup: precondition must be one of ${CLEANUP_PRECONDITIONS.join('|')}`)
    }
  }
  if (input.authorization !== 'pending' && input.authorization !== 'granted') {
    throw new Error("precise impact list: authorization must be 'pending' or 'granted'")
  }
  return input
}

export function validatePreciseImpactListFile(path) {
  return validatePreciseImpactList(JSON.parse(readFileSync(path, 'utf8')))
}