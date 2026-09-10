# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试（先失败） | ✅ | 收窄前，`recovery-retry.spec.ts` 用**不含 `ctx`** 的宿主替身驱动 `isPermanentK3sError` 即抛 `TypeError: Cannot read properties of undefined (reading 'logger')`——证明 `RecoveryHost` 仍依赖整个上下文。（见下「先失败后通过」） |
| `DispatchHost` 收窄 | ✅ | 移除 `ctx: Context`；新增 `agents()` / `subagents()`；`localExecutionImpl` 两处 `host.ctx.get(...)` 改为窄端口 |
| `RecoveryHost` 收窄 | ✅ | 移除 `ctx: Context`；新增 `logger` / `liveSession()`；`recovery.ts` 内 6 处 `host.ctx.logger.warn` + 1 处 `host.ctx.sessions.get` 改为窄端口 |
| 宿主工厂 | ✅ | `dispatchHost()` 提供 `agents()`/`subagents()`；`recoveryHost()` 提供惰性 `logger` getter 与 `liveSession()` |
| `recovery-retry` 契约保持 | ✅ | 工厂 `logger` 改为惰性 getter，纯助手（`isPermanentK3sError`/`retryK3sOperation`）仍可在未接 Context 的宿主视图上运行；13 项转绿 |

## 先失败后通过

- 观测到真实失败：完成接口收窄、但 `recoveryHost()` 的 `logger` 仍是**急切** `this.ctx.logger` 时，`pnpm run check` 中 `recovery-retry.spec.ts` 13 项全部失败，错误为 `TypeError: Cannot read properties of undefined (reading 'logger')`（宿主替身经 `Object.create(prototype)` 构造，无 `ctx`）。这正是「模块仍依赖整个上下文」的失败形态。
- 修复（工厂 `logger` 惰性）后 13 项转绿。
- `dispatch` 侧同机制：新测试的宿主替身不含 `ctx`；收窄前的 `host.ctx.get('agents')` 在该替身上会抛 `Cannot read properties of undefined (reading 'get')`。该断言与 logger 场景同源，但**未单独做收窄前的实跑观测**（诚实标注为推理，而非观测）。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 本地执行仅经 agent/subagent 窄端口解析 | `resolves a local execution from agent/subagent ports without the whole Context`（宿主替身**不含 `ctx`**；含 cwd 能力拒绝分支） |
| 本地租约到期恢复仅经 logger/liveSession 窄端口 | `drives local expiry recovery through logger/liveSession ports only`（宿主替身**不含 `ctx`**；断言定时器登记与经 `logger` 的错误上报） |
| 依赖面收窄后行为不变 | 既有 `recovery-retry`（13）、`host-narrow-ports`（2，cleanup/probe）、`startup-recovery`、`cleanup-retention-guard` 等全绿（`pnpm run check` 500 项） |

## 已知边界（诚实）

- 已完成上一 change 遗留的 `DispatchHost` / `RecoveryHost` 的 `ctx` 依赖剥离，但两者**成员数仍较多**（前者约 31、后者约 36）——成员本身多为「必须回宿主类」的方法（依 `index.ts`「成员保留在服务类、宿主对象回路由实例方法、以便测试覆盖生效」的既定模式），故本 change 只消除 `ctx` 这一「整上下文」依赖，未进一步拆分方法面。
- 未引入「跨进程锁/时钟/环境」的显式可注入端口（D 类设计建议），属更大重构。
- `dispatch` 侧先失败为**同机制推理**，非实跑观测（见上）。

## 验证

`pnpm run check` 通过：61 个测试文件、500 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
