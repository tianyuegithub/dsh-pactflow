## Why

GPT 评审附录 A02 指出运行时**时间合同被混为一谈**：`plan()` 把 `activeDeadlineSeconds` 由 `leaseDurationMs / 1000` 推导（`src/k3s-worker.ts`），而 Host 只是周期性**续租**——续租延长的是所有权，**不会延长 Job 的 activeDeadlineSeconds**。后果：一个健康的长时间任务会在最初的租赁间隔（例如提交的 5 秒/60 秒）就被 K3s 终止。

所有权租约、任务墙钟预算、心跳停滞、API 请求超时、清理时限是**不同的**时间合同，必须分开。

## What Changes

- 新增 K3s 配置 `jobMaxWallClockSeconds`（可选），作为 Job 的墙钟预算，**独立于**所有权租约。
- `plan()` 的 `activeDeadlineSeconds` 改为取该配置（默认 3600 秒），并设下限 60 秒防止极小值立即杀任务；不再由租约推导。
- 明确保留 `leaseDurationMs` 参数语义（所有权续租间隔），并在代码注释中说明其**不**用于墙钟预算。

## Capabilities

### New Capabilities
- `run-time-contracts`: K3s 任务的所有权租约（续租间隔）与 Job 墙钟预算必须是**独立**的时间合同；墙钟预算不得由租约推导，且必须有下限。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/k3s-worker.ts`（`plan` 的 deadline 推导与常量）、`src/types.ts`（`jobMaxWallClockSeconds?`）。
- **测试**：新增 `tests/run-time-contracts.spec.ts`；既有 `tests/k3s-worker.spec.ts` 中「租约=60s → deadline=60」的断言按新合同修正（该断言原本固化的是缺陷行为）。
- **兼容**：未配置时使用 3600 秒默认；不再随租约变化。
