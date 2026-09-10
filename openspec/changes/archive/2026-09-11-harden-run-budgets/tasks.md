## 1. 运行预算

- [x] 1.1 先写失败测试：尝试预算内/越界、输出预算内/截断可见、默认预算有界
- [x] 1.2 实现 `src/run-budget.ts`；验证：1.1 转绿
- [x] 1.3 `retryNode` 在重试前评估尝试预算并显式拒绝
- [x] 1.4 fail-first：临时抬高预算证实强制路径生效

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（54 文件 / 473 测试）
- [x] 2.2 运行 `openspec validate harden-run-budgets --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
