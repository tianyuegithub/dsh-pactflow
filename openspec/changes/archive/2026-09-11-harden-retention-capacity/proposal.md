## Why

A05 已交付「保留失败现场、绝不自动删除」+「有界时间窗口 + 陈旧标记 + 只读查询」。
GPT 评审 J13（来源 FULL:A05）进一步要求：保留现场必须有**容量**维度——「保留不等于泄漏」，但同时要能看见保留占用了多少磁盘，避免保留成为无界沉默残留。

本 change 补上**磁盘体积预算与容量呈现**：保留时测量现场大小（有界测量，不阻塞失败路径），只读状态额外报告已测量总字节、总量是否完整、是否超预算。**绝不自动删除任何现场**，也不把部分和伪装成完整总量。

## What Changes

- `src/retention-policy.ts`：新增 `summarizeRetentionCapacity`（在时间窗口基础上叠加字节预算；未测量场景不贡献字节，且当存在未测量场景时 `measured=false`，不把部分和当完整总量；`overBudget` 仅在完整测量且达到预算时为真）；新增 `measureRetainedSceneBytes`（有界目录遍历：最多 `maxEntries` 个条目 / `maxBytes` 字节即停，返回 `{bytes, capped}`，缺失根视为 0 不抛错）；`PactFlowRetainedScene` 增 `sizeBytes`。
- `src/types.ts`：`PactFlowCleanupRecord` 增 `sizeBytes`；`PactFlowRetentionSummary` 增 `retainedBytes` / `measured` / `overBudget` / `maxBytes`。
- `src/domain.ts`：`sizeBytes` 加入 `cleanupIdentity` 可变字段排除集；schema 增 `sizeBytes`。
- `src/index.ts`：`retainLocalFailure` 测量现场并写入 `sizeBytes`；`retentionStatus` Remote 改用 `summarizeRetentionCapacity` 并返回新增字段。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `failure-scene-retention-policy`: 新增「保留现场必须有界可计量且不自动删除」的容量要求与场景。

## Impact

- **Host**：`src/retention-policy.ts`、`src/types.ts`、`src/domain.ts`、`src/index.ts`（`retainLocalFailure`、`retentionStatus` Remote）。
- **测试**：`tests/retention-policy.spec.ts` 新增容量汇总、有界测量、端到端 `sizeBytes`/容量报告断言。
- **兼容**：新增可选字段，旧记录无 `sizeBytes` 时视为未测量（`measured=false`），不误报为 0；`pnpm run check`、`pnpm run typecheck` 全绿。
