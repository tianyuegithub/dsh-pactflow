## Why

GPT 全面评审 FULL:F04（复现 R08）指出：批准摘要只绑定「批准文本」，不绑定「批准的是哪一份成果」。`pactFlowReviewEvidenceDigest` 只包含 sessionId/needId/needRevision/kind/decision/note；而 `createNode` **不推进 Need 修订**。因此：

- 在 verification 批准之后、收口之前新增任务节点（甚至已 deployed 后），批准摘要不变、旧批准仍然有效——收口将合并一个**用户从未批准过**的更大任务集合。
- 真正风险不是「调研节点能否提前执行」（那是已裁决的 1B 灵活性），而是**用户批准的一个集合可能在外部合并前已不是当初验证的同一个集合**。

## What Changes

- 新增「交付对象摘要」：由本次交付的任务集合（节点编号 + 各自成功的精确提交）确定性计算。
- `verification` 批准记录该摘要（新增可选字段 `subjectDigest`，旧记录兼容）。
- 收口时要求「最新 verification 批准记录的交付对象摘要」等于「当前计算出的交付对象摘要」；不一致即拒绝自动收口，要求重新确认。这样新增/替换/变更成功提交都会使旧批准失效。

## Capabilities

### New Capabilities
- `review-subject-binding`: verification 批准必须绑定其批准的精确交付对象（任务集合与各自成功提交）；收口前若交付对象已变，旧批准不得继续生效。

### Modified Capabilities
（无。）

## Impact

- **领域层**：`src/types.ts`（`PactFlowReview.subjectDigest?`）、`src/domain.ts`（review schema 可选字段）。
- **Host**：`src/review-authorization.ts`（新增对象摘要函数）、`src/index.ts`（`recordReview` 记录摘要；`closeGitNeed` 校验）。
- **测试**：新增/扩展 `tests/review-authorization.spec.ts` 与 `tests/closing.spec.ts`。
- **兼容**：`subjectDigest` 可选，旧事件仍可读；不含该字段的历史 verification 批准在收口时按「无法证明对象一致」失败关闭并给出可操作提示。
