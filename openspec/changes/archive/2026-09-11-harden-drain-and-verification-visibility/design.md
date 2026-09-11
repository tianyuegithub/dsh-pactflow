## Context

见 `proposal.md · Why`。相关约束与既有事实：

- `PactFlowHandoverSummary` 是 Typert Remote 边界返回类型，**必须**从 `src/types.ts` 这一公开类型子路径导出（否则 Remote 反序列化失败）。
- 已有跨会话只读查询的先例：`listProjects()` 同时处理 live 与 cold 会话（live 走 `sessionProjections.snapshot`，cold 走 `restore`），并已在启动恢复里用同一判据（非终态 Run / 未成功清理）筛选候选会话。
- 客户端已有「纯函数 + 单测」模式（`dag-graph-model.ts`、`runtime-freshness.ts`、`request-gate.ts`），界面文案走 `locale.ts` 的中英双字典。

## Goals / Non-Goals

**Goals**

- `drainStatus()` 只在**只读**前提下回答「现在能否安全卸载」，并在不宜卸载时逐项列出责任。
- 零验证在界面上以「无自动验证」呈现，而不是 `0`。
- 移交摘要携带包版本与 reader 版本，可追溯旧日志读取版本。
- 手册卸载步骤与实现名绑定，由测试防漂移。

**Non-Goals**

- 不做自动清理、不做强制卸载、不阻断 DSH 自身的 `plugin remove`（插件无法拦截官方 CLI 的卸载动作；本 change 只提供**可查询的前置事实**与文档步骤）。
- 不新增领域状态、不改任何事件词汇或 payload。
- 不引入第二控制面。

## Decisions

### 决策 1：`drainStatus()` 复用 `listProjects()` 的 live/cold 双路径，而非只读 live 会话

- **理由**：卸载场景下会话多半**不 live**（正是要卸载时）。若只查 live，检查会静默漏报，与「安全前置」目标相反。
- **做法**：遍历 `listProjects()` 得到的会话，逐个取投影（live 用 snapshot，cold 用 restore），筛非终态 Run 与未成功清理。
- **备选**：只查当前会话——被否，卸载是全局动作。

### 决策 2：`safeToUninstall` 是派生布尔，不是调用方输入

- **理由**：与会话/清理事实一一对应，避免「调用方说安全就安全」。
- **做法**：`safeToUninstall = activeRuns.length === 0 && pendingCleanups.length === 0`。

### 决策 3：版本可追溯取自构建常量与已注册事件生产者，不接受调用方输入

- **理由**：版本必须反映**真实运行的这个包**与**它注册的 reader**，否则可追溯性无意义。
- **做法**：`packageVersion` 用 `VERSION` 常量；`eventProducerVersion` 用 `EVENT_PRODUCER_VERSION`（即 `this.events.declaration` 里注册的版本）。`projectHandoverSummary` 是纯函数、当前只吃 snapshot，故版本由 `index.ts` 在调用处注入，保持纯函数可测。

### 决策 4：零验证标注放在客户端纯函数 `pactFlowVerificationLabel(count)`

- **理由**：可离线单测、与渲染解耦；界面只负责显示返回值。
- **做法**：返回 `{ key: 'noVerification' } | { key: 'validations', count }` 形态或直接返回本地化键与参数；`count===0` → `noVerification`。

## Risks / Trade-offs

- [`drainStatus()` 遍历全部会话可能有成本] → 与会话数同阶且都是投影读取（无外部 I/O）；与既有 `listProjects()` 同量级。
- [插件无法拦截官方 `plugin remove`，因此「阻断卸载」只能靠文档 + 可查询事实] → 这是 DSH 平台边界；本 change 明确把它记为 Non-Goal，避免宣称做不到的强制力。
- [客户端标注改动可能影响现有 e2e 金标] → 只改运行行的验证列文案；现有客户端 e2e 若断言该列需同步；先跑 `test:web` 核对。
- [移交新增字段改变返回形状] → 纯新增可选/只读字段，旧读者忽略即可；Remote 类型从 `types.ts` 导出。

## Migration Plan

1. 先在 `types.ts` 落合同（`PactFlowDrainStatus` + 移交版本字段），再实现 `drainStatus()` 与 `projectHandoverSummary` 注入。
2. 客户端纯函数 + 本地化键 + 面板接线，跑客户端相关单测与 `test:web`。
3. 文档 §7 更新并加绑定守卫。
4. 全量 `pnpm run check` + `openspec validate --all --strict`；失败可回退（均为新增，回退即恢复原状）。

## Open Questions

（无。）
