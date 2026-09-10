## 1. 守护 B 类阶段的武装闸门

- [x] 1.1 发现：`ttlStage` / `zeroProofStage` 的「未武装即拒绝」守卫在 `tests/` 中零引用
- [x] 1.2 确认可离线验证：未武装时两 stage 在**接触集群前**即抛错（实跑确认）
- [x] 1.3 新增 `tests/k3s-batch-stage-guards.spec.ts`（2 项）：未设置 / `0` / `true` 均拒绝，只有精确 `1` 才算武装
- [x] 1.4 对抗性验证：将 `ttlStage` 守卫改为 `&& false` → 用例失败且**实际访问了真实集群**（耗时 64s），证明该守卫是唯一闸门；已还原
- [x] 1.5 残留核对：该次意外运行的 `finally` 自行清理，`pactflow` namespace 无 `ttl-probe` 残留
- [x] 1.6 验证：`pnpm run check` 全绿（68 文件 / 536 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-batch-stage-guards --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
