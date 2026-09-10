import { readFileSync } from 'node:fs'

export const ACCEPTANCE_EVIDENCE_TARGETS = ['5.1', '5.2', '5.3', '5.4', '5.5', '5.6', '5.7']
export const ACCEPTANCE_EVIDENCE_VERDICTS = ['passed', 'failed', 'blocked', 'open']
export const ACCEPTANCE_EVIDENCE_CONCLUSIONS = ['verified-fact', 'working-assumption', 'unknown']

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

/** 区分必填与可选字段：可选字段允许缺失，但不允许出现未知字段。 */
function hasAllowedKeys(value, required, optional, label) {
  const allowed = [...required, ...optional]
  const actual = Object.keys(value)
  const extra = actual.filter(key => !allowed.includes(key))
  if (extra.length > 0) throw new Error(`${label}: unexpected fields ${extra.join(', ')}`)
  const missing = required.filter(key => !(key in value))
  if (missing.length > 0) throw new Error(`${label}: missing required fields ${missing.join(', ')}`)
}

/** AcceptanceEvidence 结构校验（spec 6.2 五必填 + verdict/conclusion 枚举 + 可选 blocking）。 */
export function validateAcceptanceEvidence(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('acceptance evidence: must be a non-null object')
  }
  hasAllowedKeys(input, ['target', 'command', 'verdict', 'evidencePath', 'elapsedMs', 'conclusion'], ['blocking'], 'acceptance evidence')
  if (!ACCEPTANCE_EVIDENCE_TARGETS.includes(input.target)) {
    throw new Error(`acceptance evidence: target must be one of ${ACCEPTANCE_EVIDENCE_TARGETS.join('|')}`)
  }
  if (!isStringArray(input.command)) throw new Error('acceptance evidence: command must be a non-empty string array')
  if (!ACCEPTANCE_EVIDENCE_VERDICTS.includes(input.verdict)) {
    throw new Error(`acceptance evidence: verdict must be one of ${ACCEPTANCE_EVIDENCE_VERDICTS.join('|')}`)
  }
  if (!isNonEmptyString(input.evidencePath)) throw new Error('acceptance evidence: evidencePath must be a non-empty string')
  if (!Number.isSafeInteger(input.elapsedMs) || input.elapsedMs < 0) {
    throw new Error('acceptance evidence: elapsedMs must be a non-negative integer')
  }
  if (!ACCEPTANCE_EVIDENCE_CONCLUSIONS.includes(input.conclusion)) {
    throw new Error(`acceptance evidence: conclusion must be one of ${ACCEPTANCE_EVIDENCE_CONCLUSIONS.join('|')}`)
  }
  if (input.blocking !== undefined && !isNonEmptyString(input.blocking)) {
    throw new Error('acceptance evidence: blocking must be a non-empty string when present')
  }
  return input
}

export function validateAcceptanceEvidenceFile(path) {
  return validateAcceptanceEvidence(JSON.parse(readFileSync(path, 'utf8')))
}

/** ZeroProof 结构校验：batchId + before/after 资源计数 + 清理清单。 */
export function validateZeroProof(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('zero proof: must be a non-null object')
  }
  hasExactlyKeys(input, ['batchId', 'before', 'after', 'cleaning'], 'zero proof')
  if (!isNonEmptyString(input.batchId)) throw new Error('zero proof: batchId must be a non-empty string')
  for (const key of ['before', 'after']) {
    if (!Array.isArray(input[key]) || input[key].some(entry =>
      !entry || typeof entry.kind !== 'string' || !Number.isSafeInteger(entry.count) || entry.count < 0)) {
      throw new Error(`zero proof: ${key} must be an array of {kind, count}`)
    }
  }
  if (!Array.isArray(input.cleaning) || input.cleaning.some(entry =>
    !entry || typeof entry.kind !== 'string' || !isNonEmptyString(entry.identity) || !isNonEmptyString(entry.precondition))) {
    throw new Error('zero proof: cleaning must be an array of {kind, identity, precondition}')
  }
  return input
}