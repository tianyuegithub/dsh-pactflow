## 1. 派发与恢复宿主窄端口

- [x] 1.1 先写失败测试：用不含 `ctx` 的宿主替身解析本地执行、驱动本地租约恢复
- [x] 1.2 `DispatchHost` 移除 `ctx`，改 `agents()` / `subagents()`；改 `localExecutionImpl` 调用点与工厂
- [x] 1.3 `RecoveryHost` 移除 `ctx`，改 `logger` / `liveSession()`；改 `recovery.ts` 6 处调用点与工厂
- [x] 1.4 使宿主工厂 `logger` 惰性，保留 `recovery-retry.spec.ts` 纯助手契约
- [x] 1.5 验证：1.1 转绿且既有测试不回归

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 500 测试 / 13 包产物）
- [x] 2.2 运行 `openspec validate harden-host-narrow-ports-dispatch-recovery --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
