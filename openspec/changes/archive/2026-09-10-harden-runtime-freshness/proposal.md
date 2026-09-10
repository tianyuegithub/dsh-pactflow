## Why

GPT 评审附录 A06/R11 指出：浮层的「容量与工作区配置」数据来自 Session 投影之外。之前的 A5 改动只在**会话投影签名移动**（运行状态/清理状态/需求数变化）时重查。因此：

- 纯配置变化（另一窗口改了 Workspace 配置修订、Pool 容量、Settings）若不伴随投影移动，浮层会**一直显示旧值**——评审原文：只有「碰巧发生」的需求变化才会刷新。
- 刷新失败时静默保留旧值，界面**无法区分「刚确认的新值」与「可能已过期的旧值」**。

这是「旧缓存不得显示为新鲜已确认事实」（目标架构 §4 不变量）的残余缺口。

## What Changes

- 新增纯模块 `src/client/runtime-freshness.ts`：跟踪最近一次成功/尝试时间，判定是否到了有界重查时机，并在刷新失败时标记为 stale；成功时清除 stale。
- 浮层在打开且就绪期间按有界间隔重查运行时数据（不再只依赖投影移动）；重查仍受既有请求序号闸门保护，不产生乱序覆盖。
- 重查失败在界面呈现 stale 指示（含最近成功时间），而不是无声保留旧值。

## Capabilities

### New Capabilities
- `runtime-data-freshness`: 浮层展示的容量与工作区配置必须区分「已确认新鲜」与「可能过期」：在打开期间以有界间隔重查以感知投影之外的配置变化；刷新失败必须显式标记 stale，不得把旧值继续呈现为新鲜事实。

### Modified Capabilities
（无。）

## Impact

- **Client**：新增 `src/client/runtime-freshness.ts`；`src/client/overlay.tsx` 接入（重查调度 + stale 呈现）；`tsconfig.client.json`、`client/styles.ts` 或 `locale.ts` 按需最小扩展。
- **测试**：新增 `tests/runtime-freshness.spec.ts`（到期判定、失败标 stale、成功清除、卸载停止）。
- **兼容**：不改 Host/Remote 合同；不改既有投影驱动刷新语义；不引入新依赖。
