## 1. 能力级别诚实性（A10 有界增量）

- [x] 1.1 先写失败测试：不可证级别不被声称、未知阶段不被推断、级别取成功阶段最高
- [x] 1.2 新增 `PACTFLOW_HOST_ATTESTABLE_LEVELS` / `PACTFLOW_PROBE_STAGE_LEVEL` / `harnessProbeMaxLevel()`
- [x] 1.3 `harnessAchievedLevel` 改为按显式映射取最高成功阶段；未知阶段忽略
- [x] 1.4 `k3s-worker.ts` 删除本地重复推导并委托共享函数
- [x] 1.5 镜像/API 探针补报 `achievedLevel`/`maxLevel`；`PactFlowApiProbeResult` 补字段
- [x] 1.6 对抗性验证：把 `verification` 加回映射后，诚实性测试失败；已还原
- [x] 1.7 验证：1.1 转绿且既有测试不回归

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 511 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-harness-capability-honesty --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
