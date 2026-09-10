## 1. 守护发布门禁的前置检查

- [x] 1.1 发现：`checkWebGatePrerequisites()`（网页零跳过门禁的武装检查）此前**零测试**
- [x] 1.2 判定其确定性分支：`DSH_SNAPSHOT` 检查不依赖集群/凭据，可离线断言
- [x] 1.3 新增 `tests/real-web-gate-prerequisites.spec.ts`（2 项）：未武装须报告；已武装不得报告且返回值恒为非空字符串数组
- [x] 1.4 对抗性验证：把 `DSH_SNAPSHOT` 分支短路为 `&& false` → 测试失败；已还原
- [x] 1.5 验证：`pnpm run check` 全绿（66 文件 / 530 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-web-gate-prereq-coverage --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
