## 1. 时间合同分离

- [x] 1.1 先写失败测试：短租约不缩短墙钟预算、显式预算被采用、极小预算有下限
- [x] 1.2 新增配置 `jobMaxWallClockSeconds`；`plan` 的 `activeDeadlineSeconds` 不再由租约推导
- [x] 1.3 修正既有 `k3s-worker.spec.ts` 中固化缺陷行为的断言；验证：1.1 转绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（50 文件 / 459 测试）
- [x] 2.2 运行 `openspec validate harden-run-time-contracts --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
