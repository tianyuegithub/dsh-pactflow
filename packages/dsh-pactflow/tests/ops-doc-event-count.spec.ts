import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  PACTFLOW_EVENT_TYPES,
  PACTFLOW_EVENT_TYPES_V0_1,
  PACTFLOW_EVENT_TYPES_V0_2,
  PACTFLOW_EVENT_TYPES_V0_3,
} from '../src/domain.ts'

// The operator manual states how many external event types each release writes and
// reads. That number is a compatibility contract for anyone reading old logs, so a
// stale figure is a real defect (the 0.2.1 line said 13 while the code writes 17).
// This ties the documented counts to the actual tuples.
const opsDoc = readFileSync(
  resolve(import.meta.dirname, '..', '..', '..', 'docs', 'installation-operations-安装运维.md'),
  'utf8',
)

describe('PactFlow operator manual event-count accuracy', () => {
  it('documents the current writer count matching the shipped tuple', () => {
    // "0.2.1 当前写入 **17** 类外部事件（PACTFLOW_EVENT_TYPES_V0_3）"
    expect(PACTFLOW_EVENT_TYPES).toBe(PACTFLOW_EVENT_TYPES_V0_3)
    expect(opsDoc).toContain(`当前写入 **${String(PACTFLOW_EVENT_TYPES_V0_3.length)}** 类外部事件`)
  })

  it('documents the read-only legacy reader counts matching their tuples', () => {
    expect(opsDoc).toContain(`0.1.0 的 ${String(PACTFLOW_EVENT_TYPES_V0_1.length)} 类词汇`)
    expect(opsDoc).toContain(`0.2.0 的 ${String(PACTFLOW_EVENT_TYPES_V0_2.length)} 类词汇`)
  })

  it('keeps all documented event counts mutually consistent with the tuples', () => {
    // Guard the historical tuples themselves: 0.1.0=12 and 0.2.0=13 are the
    // compatibility baseline and must not silently change.
    expect(PACTFLOW_EVENT_TYPES_V0_1.length).toBe(12)
    expect(PACTFLOW_EVENT_TYPES_V0_2.length).toBe(13)
    // Every legacy vocabulary must be a subset of what the current release can read.
    for (const legacy of [PACTFLOW_EVENT_TYPES_V0_1, PACTFLOW_EVENT_TYPES_V0_2]) {
      for (const type of legacy) expect(PACTFLOW_EVENT_TYPES).toContain(type)
    }
  })
})
