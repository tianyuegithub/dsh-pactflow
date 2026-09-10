## 1. 定位并修复 Worker 被编排器守卫拦截

- [x] 1.1 先补可诊断性：Git 侧结算失败时折入 Worker 自身报告（先把失败原因从「produced no commit」变为可读）
- [x] 1.2 由 Worker 报告定位真因：「every mutating tool in my scope is blocked by the orchestrator guard」
- [x] 1.3 修复：`agent/session-start` 守卫对 `origin='subagent'` 的子会话直接返回（编排器自身行为不变）
- [x] 1.4 回归测试：Worker 子会话保留 bash/write/edit 且 `write` 实际可执行；编排器仍被拒
- [x] 1.5 对抗性验证：移除 origin 判定后该断言失败（isError true）→ 证明非空转；已还原
- [x] 1.6 真实复跑：`pnpm run test:real-worker` **由失败转为通过**

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（62 文件 / 514 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-worker-tool-scope --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
