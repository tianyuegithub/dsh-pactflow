## 1. 接线零验证信号

- [x] 1.1 复核合同：`validation-integrity-signals` 的「零自动验证必须可识别」早要求「可查询到执行数量」——故本项属**既有合同未接线**，非新目标（更正 A03 提案中的归类）
- [x] 1.2 `validationExecutedCount` 零生产引用（导出且被单测引用，属本批同类）
- [x] 1.3 接线：移交摘要的每个交付构件增 `validationsExecuted`
- [x] 1.4 类型：`PactFlowHandoverSummary.artifacts[]` 增字段并注明零的含义
- [x] 1.5 测试：既有断言更新为含该字段（0）；新增「两条验证 → 2」
- [x] 1.6 验证：`pnpm run check` 全绿（65 文件 / 526 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-wire-validation-count --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
