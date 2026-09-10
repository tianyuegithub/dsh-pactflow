import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import { ACCEPTANCE_EVIDENCE_TARGETS, validateAcceptanceEvidenceFile, validateZeroProof } from './evidence-schema.mjs'
import { resolveEvidenceBatch, walkEvidence } from './evidence-path.mjs'

function evidenceRoot() {
  return process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR
    ?? resolve(homedir(), '.pactflow-acceptance-evidence/real_acceptance')
}

/**
 * 验收门禁的纯判定核心：与「采集」分离。采集到失败证据本身成功是合理行为；
 * 门禁才负责「本批验收是否成立」。任何非 passed 的 verdict、非 verified-fact 的
 * conclusion、缺失 target 或缺 zero-proof 都失败关闭。
 */
export function assertAcceptanceResult(result) {
  const { evidences, missing, zeroProof, batchDir } = result
  if (missing.length > 0) {
    throw new Error(`acceptance gate: missing evidence for targets ${missing.join(', ')} (${batchDir ?? 'unknown batch'})`)
  }
  for (const evidence of evidences) {
    if (evidence.verdict !== 'passed') {
      throw new Error(`acceptance gate: target ${evidence.target} verdict is "${evidence.verdict}", not passed`)
    }
    if (evidence.conclusion !== 'verified-fact') {
      throw new Error(`acceptance gate: target ${evidence.target} conclusion is "${evidence.conclusion}", not verified-fact`)
    }
  }
  if (zeroProof === undefined) {
    throw new Error(`acceptance gate: missing zero-proof evidence (${batchDir ?? 'unknown batch'})`)
  }
  return result
}

/** 扫描批次目录，收集证据与 zero-proof（不修改文件）。 */
export function collectForGate(batch) {
  const batchDir = resolveEvidenceBatch(evidenceRoot(), batch)
  let stat
  try {
    stat = statSync(batchDir)
  } catch {
    stat = undefined
  }
  if (!stat?.isDirectory()) throw new Error(`acceptance gate: evidence directory not found: ${batchDir}`)
  const evidences = []
  let zeroProof
  walkEvidence(batchDir, (name, full) => {
    if (name === 'evidence.json') {
      evidences.push(validateAcceptanceEvidenceFile(full))
    } else if (name === 'zero-proof.json') {
      const parsed = JSON.parse(readFileSync(full, 'utf8'))
      validateZeroProof(parsed)
      zeroProof = parsed
    }
  })
  const seen = new Set()
  for (const evidence of evidences) {
    if (seen.has(evidence.target)) throw new Error(`acceptance gate: duplicate evidence for target ${evidence.target}`)
    seen.add(evidence.target)
  }
  const missing = ACCEPTANCE_EVIDENCE_TARGETS.filter(target => !seen.has(target))
  return { batchDir, evidences, missing, zeroProof }
}

export function runAcceptanceGate(batch) {
  return assertAcceptanceResult(collectForGate(batch))
}

function main() {
  const batch = process.argv[2]
  if (!batch) {
    process.stderr.write('usage: node scripts/acceptance-gate.mjs <batch-directory-name>\n')
    process.exitCode = 1
    return
  }
  try {
    const result = runAcceptanceGate(batch)
    process.stdout.write(`acceptance gate: ${result.evidences.length} targets verified in ${result.batchDir}\n`)
  } catch (error) {
    process.stderr.write(`[acceptance-gate] failed\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}
