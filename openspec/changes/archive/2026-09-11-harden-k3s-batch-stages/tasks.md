## 1. K3s 批次收尾阶段

- [x] 1.1 先写失败测试：TTL 完成/未完成/仍在、归零按 UID、同名不同 UID、未武装失败关闭
- [x] 1.2 实现 `scripts/k3s-batch-stages.mjs` 纯判定
- [x] 1.3 `run-real-k3s-batch.mjs` 的 `ttlStage`/`zeroProofStage` 由占位改为实现
- [x] 1.4 对 UID 分支做 fail-first；验证：转绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`git diff --check`，验证：全绿（60 文件 / 493 测试）
- [x] 2.2 运行 `openspec validate harden-k3s-batch-stages --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
