# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 新鲜度跟踪失败测试 | ✅ | `tests/runtime-freshness.spec.ts` 先因模块不存在失败 |
| 1.2 实现 `runtime-freshness.ts` | ✅ | `createFreshnessTracker`（`shouldRequery`/`onSuccess`/`onFailure`/`state`），默认间隔 20s，注入时钟 |
| 2.1/2.2 浮层有界间隔重查 | ✅ | 就绪期间 `setInterval(PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS)` 触发 `refreshRuntime()`；关闭/卸载/会话或代际变化 `clearInterval` |
| 2.3 成功清 stale、失败置 stale | ✅ | 复用 `request-gate` 顺序保护；成功 `onSuccess`，失败 `onFailure` 并保留旧值 |
| 3.1/3.2 stale 呈现 | ✅ | 浮层运行时区块显示「可能过期 · 最近确认 HH:MM:SS」/「已于 … 确认」/「尚未确认」 |

## Review 发现并修复

初始 `load()` 已取回并展示运行时数据，但 freshness 仅由 `refreshRuntime()` 标记成功——首屏会错误显示「尚未确认」（数据其实是刚取回的）。已让初始 `load` 成功路径同样调用 `onSuccess()`，并加断言防回归。

另外：会话/代际切换时**重置** freshness（新建 tracker），避免把上一个会话的确认时间显示给新会话。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 无投影移动时配置变化最终被反映 | `does not requery before the interval elapses and does after` + 接线守卫（`setInterval`/间隔常量） |
| 关闭浮层后停止重查 | 接线守卫（`clearInterval` 出现在就绪 effect 的清理中） |
| 失败后标记过期 | `marks stale on failure and keeps the previous success time` |
| 成功后清除过期标记 | `clears stale on the next success` |
| 从未成功过时提示无成功记录 | `reports no confirmed data before the first success` + 接线守卫（`尚未确认`） |

## 已知边界（诚实）

- **DSH 未向插件暴露配置变更订阅**（已核对 sibling DSH 开发仓 `client/store` 仅提供通用 snapshot store，无 Settings/Workspace 变更事件）。因此「配置版本驱动」在当前公开能力下退化为**有界间隔重查**（20s），而非事件驱动。若上游将来提供配置事件，应改为事件驱动——已在此记录。
- 纯闸门/追踪逻辑已单测；**浮层真实重查行为**（打开后等一个间隔看到配置变化）属浏览器验收，未在本 change 运行。
- 间隔重查仅在浮层打开时生效，不做后台轮询。

## 验证

`pnpm run check` 通过：44 个测试文件、442 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
