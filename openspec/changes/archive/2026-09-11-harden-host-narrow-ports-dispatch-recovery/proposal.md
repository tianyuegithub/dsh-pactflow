## Why

GPT 评审 R12（对应 FULL:J9）要求宿主模块通过**窄端口**获取能力，而不是接收整个 Cordis Context。
上一个 change `harden-host-narrow-ports` 只处理了「已经窄用」的两个模块（cleanup、probe-recovery），并**明确记录**：`DispatchHost`（约 31 个实用成员）与 `RecoveryHost`（约 36 个）仍是较大宿主对象，未在本 change 收窄，因为「它们支撑多条执行链，收窄风险显著更高」。

本 change 完成该遗留切片：这两个宿主对象**实际只用到 `ctx` 的两个能力**——
`DispatchHost`：`ctx.get('agents')` / `ctx.get('subagents')`（本地执行解析）；
`RecoveryHost`：`ctx.logger.warn(...)`（诊断）与 `ctx.sessions.get(id)`（本地租约到期重入）——其余成员早已是显式方法。
因此可以把 `ctx` 从这两个端口移除，换成 `agents()` / `subagents()` / `logger` / `liveSession()` 窄端口，并用「不含 `ctx` 的宿主替身」证明依赖真正解耦。

## What Changes

- `DispatchHost`：移除 `ctx: Context`，新增窄端口 `agents(): AgentRegistry | undefined`、`subagents(): SubagentRuntime | undefined`。
- `RecoveryHost`：移除 `ctx: Context`，新增窄端口 `logger`、`liveSession(sessionId): Session | undefined`。
- `src/host/dispatch.ts`：`localExecutionImpl` 的两处 `host.ctx.get(...)` 改为 `host.agents()` / `host.subagents()`。
- `src/host/recovery.ts`：`host.ctx.logger.warn` 改为 `host.logger.warn`；`host.ctx.sessions.get(sessionId)` 改为 `host.liveSession(sessionId)`。
- `index.ts` 的两个宿主工厂提供窄端口实现；`logger` 用惰性 getter，使 `isPermanentK3sError` / `retryK3sOperation` 等纯助手能在未接 Context 的宿主视图上运行（保留 `recovery-retry.spec.ts` 的既有契约）。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `host-narrow-ports`: 扩展该既有能力，新增「派发与恢复宿主亦不得依赖整个上下文」的合同与场景。

## Impact

- **Host**：`src/host/dispatch.ts`（接口与 `localExecutionImpl`）、`src/host/recovery.ts`（接口与 6 处日志/会话调用）、`src/index.ts`（`dispatchHost()` / `recoveryHost()` 工厂）。
- **测试**：`tests/host-narrow-ports.spec.ts` 新增两个场景（本地执行仅经 agent/subagent 端口；恢复仅经 logger/liveSession 端口）。
- **兼容**：纯内部接口收窄，行为不变；`pnpm run check`、`pnpm run typecheck` 全绿。
