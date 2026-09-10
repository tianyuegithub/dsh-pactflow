## Why

GPT 评审附录 A12 指出：即使插件不再启动，也应能**导出只读项目摘要、精确 Git 产物引用与未完成责任**，避免「数据还在但没有兼容 reader」成为事实上的丢失。

## What Changes

- 新增纯模块 `src/project-handover.ts`：`projectHandoverSummary(snapshot)` 从项目投影快照派生只读摘要——项目身份与修订、Git 远端与默认分支、各需求当前阶段与修订、DAG 节点状态、**精确 Git 产物（runId/分支/提交）**、以及**未完成清理责任**（含保留的失败现场）。确定性排序，不修改任何状态。
- 新增只读 Remote `projectHandover(sessionId)`：对**在线或冷会话**都经既有 `snapshot` 路径工作，返回该摘要。
- `PactFlowHandoverSummary` 定义在公开类型子路径（`types.ts`），满足 Remote 边界类型导出的 Typert 约束。

## Capabilities

### New Capabilities
- `project-handover`: 项目必须可导出只读移交摘要——包含当前阶段、精确 Git 产物引用与未完成责任，且不依赖插件继续运行、不修改任何状态。

### Modified Capabilities
（无。）

## Impact

- **Host**：新增 `src/project-handover.ts`、只读 Remote `projectHandover`；`src/types.ts`（公开摘要类型）；`tsconfig.host.json`。
- **测试**：新增 `tests/project-handover.spec.ts`（含项目/产物/未完成责任、无项目、已完成清理被排除）。
- **兼容**：新增只读入口，不改变既有字段与行为。
