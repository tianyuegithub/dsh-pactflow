## 1. 接线 B 类影响清单门禁

- [x] 1.1 穷尽扫描发现：`impact-list.schema.mjs` 全仓零导入、不在 package.json scripts（计划 §380 只有工具、无执行）
- [x] 1.2 契约对照：§380 要求「B 类执行前给出精确影响清单并取得授权」→ 有契约要求，正确处置是**接线**
- [x] 1.3 新增 `requireGrantedImpactList` / `loadAndRequireGrantedImpactList`：结构校验 + **必须 granted**
- [x] 1.4 `run-real-k3s-batch.mjs` 接线：提供清单则强制已授权；未提供则**显式告警**门禁未施加
- [x] 1.5 测试：5 项（结构/未知字段/空数组/枚举、well-formed 但 pending 被拒、从文件加载并门禁、非法 JSON）
- [x] 1.6 验证：`pnpm run check` 全绿（63 文件 / 519 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-enforce-impact-list-gate --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
