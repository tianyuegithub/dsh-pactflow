# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/host-narrow-ports.spec.ts` 先失败：`Cannot read properties of undefined (reading 'sessionProjections')`（模块仍依赖整个 `ctx`） |
| `CleanupHost` 收窄 | ✅ | 移除 `ctx: Context`；改 `logger` + `delivery(session)`；`cleanup.ts` 内 10 处 `host.ctx.*` 改为窄端口 |
| `ProbeRecoveryHost` 收窄 | ✅ | 移除 `ctx: Context`；改 `logger`；`probe-recovery.ts` 内 5 处 `host.ctx.logger` 改为 `host.logger` |
| 宿主工厂 | ✅ | `cleanupHost()` / `probeHost()` 提供窄端口实现 |
| 既有测试替身更新 | ✅ | `cleanup-retention-guard.spec.ts` 替身改为窄端口（不再伪造 `ctx`） |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 模块可在无上下文的宿主上运行 | `reconciles cleanups through narrow ports without the whole Context`（宿主替身**不含 `ctx`**） |
| 依赖面收窄后行为不变 | 既有 `cleanup-retention-guard`、`probe-recovery`、`startup-recovery` 等测试全绿（`pnpm run check` 488 项） |
| 保留责任仍被跳过 | `still skips retained records through narrow ports` |

## 已知边界（诚实）

- 只收窄了**两个已经窄用的模块**（cleanup、probe-recovery）。`DispatchHost`（31 个实用成员）与 `RecoveryHost`（36 个）仍是较大的宿主对象，未在本 change 收窄——它们支撑多条执行链，收窄风险显著更高。
- 「纯 reducer 不接触 I/O」：`domain.ts` 已核实为纯逻辑（无 `node:fs`/`child_process`/`ctx.get`/`async`），本 change 未改动它，但该性质此前已成立。
- 未引入「跨进程锁/时钟/环境」的显式可注入端口（D 类设计建议），属更大重构。

## 验证

`pnpm run check` 通过：59 个测试文件、488 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
