## 1. 交付对象摘要（纯函数）

- [x] 1.1 先写失败测试：同一集合不同顺序得到相同摘要；集合或提交变化得到不同摘要
- [x] 1.2 实现 `pactFlowDeliverySubjectDigest`；验证：1.1 转绿

## 2. 记录时绑定

- [x] 2.1 `PactFlowReview.subjectDigest?` 类型与 schema（可选）
- [x] 2.2 `recordReview` 对 `verification` 计算并写入摘要；验证：记录携带摘要

## 3. 收口时校验

- [x] 3.1 先写失败测试：批准后新增节点导致收口拒绝；批准后提交变化导致拒绝；对象未变正常收口；缺摘要历史批准拒绝
- [x] 3.2 `closeGitNeed` 校验最新 verification 批准摘要与当前交付对象一致；验证：3.1 转绿

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [x] 4.2 运行 `openspec validate harden-approval-subject --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射与已知未覆盖
