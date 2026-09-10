## 1. A05 容量增量

- [x] 1.1 先写失败测试：容量汇总（全测量/部分测量/空）与有界测量
- [x] 1.2 `retention-policy.ts` 新增 `summarizeRetentionCapacity` 与 `measureRetainedSceneBytes`；`PactFlowRetainedScene` 增 `sizeBytes`
- [x] 1.3 `types.ts` / `domain.ts`（schema + `cleanupIdentity` 排除集）增 `sizeBytes`；`PactFlowRetentionSummary` 增容量字段
- [x] 1.4 `index.ts`：`retainLocalFailure` 测量并写入；`retentionStatus` 返回容量字段
- [x] 1.5 端到端断言 `sizeBytes` 与容量报告；对抗性验证（将 `measured` 硬改为 true 时测试失败）
- [x] 1.6 验证：`pnpm run check` 全绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 504 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-retention-capacity --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
