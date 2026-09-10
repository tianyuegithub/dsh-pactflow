## 1. F07 本地派发接入统一准入

- [x] 1.1 先写失败测试：断言本地 Git 派发经过共享准入器；并断言准入屏障生效期间不 claim、不执行
- [x] 1.2 实现：本地派发登记 `run-queued`、经 `acquireExecutionOrCancel` 取得槽位
- [x] 1.3 实现：准入后重核取消、节点/项目修订与工作区配置快照；失败登记 `run-queue-cancelled` 并释放槽位
- [x] 1.4 `finally` 释放槽位；验证：1.1 转绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（45 文件 / 444 测试）
- [x] 2.2 运行 `openspec validate harden-local-admission --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖（本地不消耗 Profile/池槽位的语义边界）
