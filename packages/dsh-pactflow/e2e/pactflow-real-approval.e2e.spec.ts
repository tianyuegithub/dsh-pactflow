import { describe, expect, it } from 'vitest'

const enabled = process.env.DSH_REAL_APPROVAL === '1'

describe.skipIf(!enabled)('PactFlow real human approval in the native DSH UI', { timeout: 300_000 }, () => {
  it('records a user-approved review through DSH Approval and advances the durable gate', async () => {
    // 骨架（task 7.1 充实）：
    // 1. 真实 web scaffold 中 Agent 调用 pactflow_record_review → DSH Approval 弹窗；
    // 2. 🤝 由用户本人在真实界面批准（allowed-once），唯一写入方不代按、不存在自动批准路径；
    // 3. 断言 pactflow/review-recorded 落账字段：决定、需求修订、有界证据正文、digest、source:'dsh-approval'；
    // 4. 门禁状态真实推进（approval/asked + approval/decided(allowed-once) + review-recorded 一一对应）；
    // 5. 旧 0.1/0.2 批准事件只读展示不解锁新门禁；无授权上下文/内容不全的批准被拒绝。
    expect.fail('skeleton: real approval assertions are implemented in task 7.1 and require a human approver')
  })
})