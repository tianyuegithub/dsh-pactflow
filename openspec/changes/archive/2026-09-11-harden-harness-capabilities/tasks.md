## 1. Harness 能力分级

- [x] 1.1 先写失败测试：级别顺序、声明契约、按 stages 推导、cleanup 失败不得声称 cancellation
- [x] 1.2 实现 `src/harness-capabilities.ts`；验证：1.1 转绿
- [x] 1.3 探针结果附 `achievedLevel`/`maxLevel`（`types.ts` + `k3s-worker.ts` 本地镜像函数）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（55 文件 / 478 测试）
- [x] 2.2 运行 `openspec validate harden-harness-capabilities --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
