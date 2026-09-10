import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, join, resolve } from 'node:path'

/** 持久报告目录：临时工作目录会被清理，唯一证据不能只在其中。 */
export function reportStoreDir() {
  return process.env.PACTFLOW_REPORT_DIR ?? resolve(homedir(), '.pactflow-reports')
}

function stamp() {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

/**
 * 在清理临时目录之前，把报告复制到持久目录。最佳努力：报告不存在时返回 undefined，
 * 不因保全失败掩盖原始验收结论。
 */
export function preserveReport(reportPath, label) {
  try {
    if (!existsSync(reportPath)) return undefined
    const directory = reportStoreDir()
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const target = join(directory, `${label}-${stamp()}-${basename(reportPath)}`)
    copyFileSync(reportPath, target)
    return target
  } catch {
    return undefined
  }
}
