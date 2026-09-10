## Why

GPT 评审静态审查项 FULL:A06 指出前端存在「同一代际内的请求竞态」：

- `src/client/overlay.tsx` 的运行时刷新（`loadRuntime`）只有会话/代际级别的 `isCurrent` 检查，**没有请求序号**：同一代际内两次刷新若旧请求晚返回，其响应会覆盖较新请求的结果。且新刷新不会中止上一次在途刷新。
- `src/client/project-panel.tsx` 的 `refresh()` 与 `gitSecrets` 副作用同样没有请求身份/取消检查：快速切换工作区或集群时，旧响应可能回填到新选择上。

这类竞态会让界面把**过期的响应当作最新事实**呈现，与「界面只呈现可重建的真实投影」的意图相悖。修复自包含、可单测，应先于更重的前端改动。

## What Changes

- 新增纯模块 `src/client/request-gate.ts`：单调请求序号闸门，只有最新签发的令牌才允许应用结果；支持使全部在途请求失效。
- `overlay.tsx`：运行时刷新使用序号闸门，签发新刷新前中止上一次在途刷新；被取代的响应一律丢弃。
- `project-panel.tsx`：`refresh()` 与 `gitSecrets` 副作用使用序号闸门，被取代的响应丢弃（含工作区/集群快速切换）。

## Capabilities

### New Capabilities
- `client-request-ordering`: 客户端在同一代际/同一选择上下文内必须以请求序号判定是否应用响应，被取代的在途请求其结果不得覆盖较新的状态；签发新请求时应使被取代的旧请求失效。

### Modified Capabilities
（无；本 change 不改变任何既有 spec 的既有 requirement，只新增竞态约束。）

## Impact

- **Client**：新增 `src/client/request-gate.ts`；`src/client/overlay.tsx`、`src/client/project-panel.tsx` 接入。
- **测试**：新增 `tests/client-request-ordering.spec.ts`（闸门纯逻辑 + 乱序到达丢弃 + 失效语义）。
- **兼容**：不改 UI 布局、文案、槽位；不改 Host/Remote 合同。
