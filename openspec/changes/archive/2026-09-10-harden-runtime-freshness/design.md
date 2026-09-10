## Context

见 proposal.md（Why）。关键事实：

- `overlay.tsx` 的运行时刷新由投影签名驱动（runs/cleanups/needs 形状）；签名不变则不重查。
- DSH 未向插件暴露 Settings/Workspace 配置的客户端订阅（已核对 sibling DSH 开发仓的 client packages：`client/store` 只提供通用 snapshot store，无 Settings 变更事件）。因此「配置变更由自身版本驱动」在当前公开能力下只能退化为**有界重查**感知。
- 运行时数据来自 `listWorkerPools` 与 `workspaceProjectForSession`；两者都是只读查询，重查成本低。
- 上一 change 已引入 `request-gate`，重查可直接复用其顺序保护。

约束：不改 Host/Remote 合同；不引入新依赖；重查必须有界、可停止。

## Goals / Non-Goals

**Goals:**
- 投影之外的变化最终被反映（有界间隔重查）。
- 失败显式 stale，不把旧值当新鲜。
- 关闭/卸载后停止重查，无泄漏计时器。

**Non-Goals:**
- 不实现真正的配置事件订阅（当前 DSH 未暴露；若上游提供应改为事件驱动）。
- 不做后台轮询式的全量刷新（仅在浮层打开时重查）。

## Decisions

### D1：抽纯模块 `createFreshnessTracker()`（可单测）

职责：记录最近成功时间与 stale 状态；`shouldRequery(now)` 判定是否到期；`onSuccess(now)` 清 stale 并更新成功时间；`onFailure()` 置 stale。纯逻辑、注入时钟，便于单测到期/标记语义。

- 备选：在组件里直接写 `setInterval` + 布尔量。否决——无法单测，且到期语义易写错。

### D2：浮层以有界间隔重查（如 20s），并复用序号闸门

在 `state.open && phase === 'ready'` 时设置间隔计时器；到点触发一次运行时重查（与投影驱动的重查共用同一路径与闸门）。关闭/卸载/会话或代际变化时清除计时器。间隔取常量并有上限。

### D3：失败 stale 呈现（最小 UI）

浮层在 stale 时于运行时区块显示「可能过期 · 最近成功 HH:MM:SS」；从未成功过则显示「尚未确认」。仅在 stale 时出现，不改变正常布局。

### D4：不改变既有投影驱动刷新

投影移动仍立即重查；间隔重查是其补充，而非替代。两者共享闸门，不会互相覆盖。

## Risks / Trade-offs

- [固定间隔增加查询频率] → 仅在浮层打开时生效；间隔取 20s 级别，且查询只读轻量。
- [间隔到期与投影触发同时发生] → 共用闸门，后者使前者失效，最多多一次被丢弃的响应。
- [上游将来提供配置事件] → D3/D2 的实现应便于替换为事件驱动；本 change 在 known-gaps 记录该边界。

## Open Questions

（无。）
