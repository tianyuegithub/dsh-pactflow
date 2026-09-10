## Why

真实本地 Worker 验收（`test:real-worker`）长期稳定失败于 `PactFlow Worker produced no commit`，且插件只报这一句、丢掉了 Worker 自己的说明，使根因难以定位。

本轮先补上**可诊断性**，立刻拿到 Worker 自己的报告：

> every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem.

由此定位到一个**本仓真实缺陷**：`src/agent/index.ts` 在 `agent/session-start` 上注册「编排器只读守卫」，对**每一个**启动会话的 Agent 生效——包括被委派的 **Worker 子会话**。于是 Worker 的 `bash`/`write`/`edit` 在到达文件系统前就被拒绝，永远无法产出提交；而 Worker 报告说工具「在作用域内」也说明它的工具可见性正常，唯独交互被守卫拦下。

（此前一次结论把根因归为「宿主沙箱/批准策略」，那是不成立的：base bundle 默认 `workspace-write`，边界取会话 cwd，而子会话 cwd 即任务工作树。该错误结论已在 `6518f37` 更正。）

## What Changes

- `src/agent/index.ts`：`agent/session-start` 守卫在 `agent.session.header.origin === 'subagent'` 时直接返回——委派的 Worker 子会话**不**套用编排器只读守卫；编排器自身（根会话，无 `origin`）行为不变。
- `src/host/dispatch.ts`：Worker 已 `completed` 但 Git 侧拒绝结算时，把 Worker 自身的有界 outcome 折入失败原因（`<原因> — Worker reported: <报告>`），使静默空转与「自称完成」可区分。
- `tests/domain.spec.ts`：新增「Worker 子会话（origin=subagent）保留 bash/write/edit 且 `write` 实际可执行」的断言，并保留编排器仍被拒绝的既有断言。

## Capabilities

### New Capabilities
- `worker-tool-scope`: 编排器只读守卫必须只作用于编排器会话，MUST NOT 泄漏到被委派的 Worker 子会话；且 Worker 未产出提交时的失败 MUST 携带 Worker 自身的报告以便诊断。

### Modified Capabilities
（无。）

## Impact

- **Host / Agent**：`src/agent/index.ts`（守卫作用域）、`src/host/dispatch.ts`（失败原因可诊断）。
- **测试**：`tests/domain.spec.ts` 扩展既有的编排器只读用例（含对抗性验证：移除 origin 判定后该断言失败）。
- **兼容**：编排器只读语义不变；变更只影响 `origin='subagent'` 的子会话。真实 `test:real-worker` 由失败转为**通过**。`pnpm run check` 全绿。
