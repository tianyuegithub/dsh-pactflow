## Context

见 proposal.md（Why）。关键事实：

- `overlay.tsx`：`isCurrent(sessionId, generation)` 只用会话/代际判定；`loadRuntime` 刷新由投影签名驱动，同一代际内多次触发无序号；`startRequest` 会注册 `AbortController`，但刷新路径签发新请求前未中止旧请求。
- `project-panel.tsx`：`refresh()` 用 `Promise.all([list(), catalogs()])` 后无条件 `setRows/setCatalog`；`gitSecrets(clusterId)` 的 `.then` 无条件 `setGitSecretOptions`。快速切换工作区/集群时旧响应会覆盖新选择。
- 前端组件缺乏组件级单测基建（渲染依赖 DSH 槽位/Remote 注入与浏览器脚手架）。因此把「顺序判定」抽成**纯模块**，由单测直接覆盖；组件接入保持薄。

约束：不改 UI 布局、文案、槽位；不改 Host/Remote 合同；不引入新依赖。

## Goals / Non-Goals

**Goals:**
- 同一上下文内只有最新请求可写入状态；被取代/迟到响应被丢弃。
- 可单测（纯逻辑），组件接入最小。

**Non-Goals:**
- 不重构组件状态管理（不做全局 store 化）。
- 不实现请求缓存/去重优化。
- 不改配置版本驱动刷新的语义（本 change 只加乱序保护；版本驱动刷新属下一批）。

## Decisions

### D1：抽出纯序号闸门 `createRequestGate()`（可单测）

接口：`next()` 返回带 `seq` 的令牌与 `isLatest()`；`invalidate()` 使全部在途令牌失效（并把「最新」推进到不可能匹配的值）。响应返回时调用 `isLatest(token)` 决定是否写入。

- 备选：在每个组件里各写一遍序号变量。否决——重复且易漏；纯模块可统一测试乱序语义。

### D2：overlay 运行时刷新：新请求前中止旧请求

`loadRuntime` 刷新签发新请求前调用 `abortOutstanding()`（或只中止上一次运行时刷新控制器），再用闸门判定应用结果。这样既减少无谓传输，也保证迟到的旧响应不覆盖。

### D3：project-panel：上下文变更令牌 + 响应守卫

`refresh()` 与 `gitSecrets` 各持令牌：签发时 `next()`，`.then` 中 `isLatest(token)` 才 `setState`；工作区/集群变化触发的重跑自然使旧令牌失效。

### D4：接入保持薄，行为不变（正常单请求路径）

不改变成功/失败的用户可见行为；仅在被取代时丢弃。既有「失败保留旧值」语义保留。

## Risks / Trade-offs

- [闸门逻辑错误会误丢最新响应] → 单测覆盖单请求、多请求乱序、失效三种情况；组件接入只做 `isLatest` 判定。
- [组件接入无法直接单测] → 用纯模块测试保证语义；组件层面由既有浏览器 e2e（已覆盖实时投影与配置刷新）验证未回归。
- [中止旧请求可能改变错误呈现] → AbortError 本就被忽略，保持忽略。

## Open Questions

（无。）
