## 1. 保留策略

- [x] 1.1 先写失败测试：剩余窗口、超期判定、非保留永不超期、汇总、默认窗口有界
- [x] 1.2 实现 `src/retention-policy.ts`；验证：1.1 转绿
- [x] 1.3 `CleanupRecord.retainUntil?`（类型 + schema）；`cleanupIdentity` 排除集；`retainLocalFailure` 写入
- [x] 1.4 只读 Remote `retentionStatus`；端到端验证登记与查询

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 499 测试）
- [x] 2.2 运行 `openspec validate harden-retention-policy --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
