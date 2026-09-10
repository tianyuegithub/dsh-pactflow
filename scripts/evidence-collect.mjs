import { readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve } from 'node:path'
import {
  ACCEPTANCE_EVIDENCE_TARGETS,
  validateAcceptanceEvidenceFile,
  validateZeroProof,
} from './evidence-schema.mjs'
import { resolveEvidenceBatch, walkEvidence } from './evidence-path.mjs'

function evidenceRoot() {
  return process.env.PACTFLOW_ACCEPTANCE_EVIDENCE_DIR
    ?? resolve(homedir(), '.pactflow-acceptance-evidence/real_acceptance')
}

function readEvidenceFile(path) {
  return validateAcceptanceEvidenceFile(path)
}

/** 扫描某批次证据目录，汇总每个 target 的证据；缺字段/出枚举即抛错（复用 release-web-report 严格语义）。 */
export function collectEvidence(batch) {
  const batchDir = resolveEvidenceBatch(evidenceRoot(), batch)
  let directoryStat
  try {
    directoryStat = statSync(batchDir)
  } catch {
    directoryStat = undefined
  }
  if (!directoryStat?.isDirectory()) {
    throw new Error(`evidence directory not found: ${batchDir}`)
  }
  const entries = []
  walkEvidence(batchDir, (name, full) => {
    if (name === 'evidence.json') {
      entries.push(readEvidenceFile(full))
    } else if (name === 'zero-proof.json') {
      validateZeroProof(JSON.parse(readFileSync(full, 'utf8')))
    }
  })
  const byTarget = new Map()
  for (const evidence of entries) {
    const existing = byTarget.get(evidence.target)
    if (existing) throw new Error(`duplicate evidence for target ${evidence.target}`)
    byTarget.set(evidence.target, evidence)
  }
  const missing = ACCEPTANCE_EVIDENCE_TARGETS.filter(target => !byTarget.has(target))
  return { batchDir, evidences: entries, missing }
}

function main() {
  const batch = process.argv[2]
  if (!batch) {
    process.stderr.write('usage: node scripts/evidence-collect.mjs <batch-directory-name>\n')
    process.exitCode = 1
    return
  }
  try {
    const { batchDir, evidences, missing } = collectEvidence(batch)
    for (const evidence of evidences) {
      process.stdout.write(`${evidence.target}\t${evidence.verdict}\t${evidence.conclusion}\t${evidence.elapsedMs}ms\t${evidence.evidencePath}\n`)
    }
    if (missing.length > 0) {
      process.stderr.write(`\nmissing evidence (not counted as passed): ${missing.join(', ')}\n`)
      process.exitCode = 1
    }
    process.stdout.write(`\ncollected ${evidences.length}/${ACCEPTANCE_EVIDENCE_TARGETS.length} targets from ${batchDir}\n`)
  } catch (error) {
    process.stderr.write(`[evidence-collect] failed\n${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
  main()
}