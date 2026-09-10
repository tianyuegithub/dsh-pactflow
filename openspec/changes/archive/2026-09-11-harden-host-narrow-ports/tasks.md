## 1. 宿主窄端口

- [x] 1.1 先写失败测试：用不含 `ctx` 的宿主替身驱动清理对账
- [x] 1.2 `CleanupHost` 收窄为 logger + delivery；改调用点与工厂
- [x] 1.3 `ProbeRecoveryHost` 收窄为 logger；改调用点与工厂
- [x] 1.4 更新既有替身；验证：1.1 转绿且既有测试不回归

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（59 文件 / 488 测试）
- [x] 2.2 运行 `openspec validate harden-host-narrow-ports --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
