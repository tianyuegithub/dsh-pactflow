## 1. 接线 Harness 能力声明查询

- [x] 1.1 排查「导出且被单测引用、但生产未接线」的助手（对照基线：此前发现死代码 `maxOutputBytes`）
- [x] 1.2 判定：`validationExecutedCount`、`retentionRemainingMs` 不构成缺口（数据已由 snapshot/retentionStatus 暴露），不新增冗余字段
- [x] 1.3 接线真正缺口：`harnessCapabilityProfile` 新增 `@Remote('harnessCapabilities')`
- [x] 1.4 新增 `PactFlowHarnessCapabilityView`（可序列化）供 Remote 边界
- [x] 1.5 测试：断言服务暴露每个已配置 Harness 的声明（含 `structuredOutput` 与上限）
- [x] 1.6 验证：`pnpm run check` 全绿（62 文件 / 515 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-harness-capability-query --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
