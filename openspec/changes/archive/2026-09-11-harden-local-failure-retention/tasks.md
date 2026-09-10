## 1. 本地失败保留责任

- [x] 1.1 先写失败测试：失败后 worktree 仍在、存在保留责任、重结算不重复
- [x] 1.2 `PactFlowCleanupRecord.retain?` 与 schema
- [x] 1.3 `retainLocalFailure` 登记保留责任；本地四处失败结算调用
- [x] 1.4 `reconcileCleanupsImpl` 跳过 retain 记录（确定性守卫测试）；验证：1.1 转绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（53 文件 / 468 测试）
- [x] 2.2 运行 `openspec validate harden-local-failure-retention --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
