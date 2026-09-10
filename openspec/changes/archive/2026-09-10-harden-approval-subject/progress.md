# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 摘要失败测试 | ✅ | `tests/approval-subject.spec.ts` 4 项先因函数不存在失败 |
| 1.2 实现摘要纯函数 | ✅ | `pactFlowDeliverySubjectDigest`（排序后 (remoteRef, commit) 集合 → SHA-256） |
| 2.1/2.2 记录时绑定 | ✅ | `PactFlowReview.subjectDigest?` + schema 可选；`recordReview` 对 `verification` 写入当前交付对象摘要 |
| 3.1 收口失败测试 | ✅ | `closing.spec.ts` 新增 `subject-drift` 模式：批准后新增并成功一个节点 |
| 3.2 收口校验 | ✅ | `closeGitNeed` 要求最新 verification 批准摘要等于当前交付对象摘要，否则拒绝 |

## 关键验证：fail-first 两次

1. **纯函数**：4 项测试先因模块导出不存在失败。
2. **收口校验**：临时用 `if (false && …)` 禁用绑定后，`subject-drift` 用例 **收口成功**（`promise resolved instead of rejecting`）——直接证明「旧批准会放行一个更大的交付集合」，恢复实现后转绿。

## Review 发现并修复

`latestVerificationSubject` 初版用投影里的 `currentNeed.revision - 1`，而 `latestReviewApproved` 用 `need.revision - 1`——两处来源虽当前一致，但存在漂移风险。改为**显式传入 `needRevision`**，使两处基准同一。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 记录批准时绑定当前交付对象 | `closing.spec.ts` 各模式（fixture 走真实 `recordReview`，含摘要） |
| 摘要与顺序无关 | `is order-independent for the same task set` |
| 批准后新增任务导致拒绝收口 | `checks subject-drift …`（新增并成功一个节点） |
| 批准后成功提交变化导致拒绝收口 | `changes when a successful commit is replaced`（摘要函数层）+ 收口比对同一函数 |
| 交付对象未变时正常收口 | 既有 11 个 closing 用例继续通过 |
| 缺少摘要的历史批准不放行 | `closeGitNeed` 在 `latestVerificationSubject === undefined` 时抛错并提示重新确认 |

## 已知边界（诚实）

- 「成功提交变化」在收口层的端到端用例未单独构造（需替换某 Run 的成功提交后再收口）；该分支由摘要函数的 `changes when a successful commit is replaced` 单测 + 收口对同一函数的比对共同覆盖，但**未做真实替换提交的收口级复现**。
- 旧 verification 批准无 `subjectDigest` 时收口失败关闭（不默认放行），已 deployed 的旧 Need 若需重跑须重新确认——属期望的保守行为。

## 验证

`pnpm run check` 通过：46 个测试文件、449 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
