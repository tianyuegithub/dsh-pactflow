## Why

GPT 全面评审 FULL:F07（复现 R04）指出：**本地 Git 派发绕过统一准入**。K3s 路径会排队、获取容量、重核配置、claim 再执行；而 `dispatchGitNodeWithSignal` 直接 `plan → claim → materialize → executeClaimed`，完全不经过 `acquireExecutionOrCancel`。后果：会话恢复的**准入屏障**（盘点期间暂停准入）挡不住本地派发，恢复期的容量/一致性约束对本地路径失效。

## What Changes

- 本地 Git 派发改为与 K3s 相同的准入序列：先登记 `run-queued`、经 `acquireExecutionOrCancel` 取得槽位，再重核取消、节点/项目修订与工作区配置，然后才 claim/执行；无论成功失败都在 `finally` 释放槽位。
- 被屏障/漂移/取消拒绝时登记 `run-queue-cancelled`，不产生 claim。

## Capabilities

### New Capabilities
- `worker-admission-uniformity`: 所有 Worker 入口（本地 Git 与 K3s）必须经过同一准入点：在恢复盘点等屏障生效期间不得 claim 或执行；准入后必须重核取消与版本，失败即释放槽位。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/host/dispatch.ts` 的 `dispatchGitNodeWithSignalImpl`。
- **测试**：新增 `tests/local-admission.spec.ts`（派发经过准入器、暂停期间不 claim/不执行）。
- **兼容**：不改 Remote 合同与请求结构；本地派发仍不使用 K3s pool 或 Agent Profile。
