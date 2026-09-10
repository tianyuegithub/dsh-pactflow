## 1. 跨进程锁真实验证

- [x] 1.1 先写测试：4 真实子进程 × 15 次迭代经锁递增共享计数，断言精确 60
- [x] 1.2 实现驱动 `scripts/multi-process-lock-driver.mjs`（读→等→写回；环境变量入参，argv 字面量）
- [x] 1.3 加对照用例：同负载无锁必须 < 60
- [x] 1.4 修正测试自身缺陷：`execFileSync` 顺序执行 → 改为并发 `spawn` + `Promise.all`
- [x] 1.5 稳定性：连续 3 次运行均 2/2 通过

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（62 文件 / 514 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-multiprocess-lock-verification --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
