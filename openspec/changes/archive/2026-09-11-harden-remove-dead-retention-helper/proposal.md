## Why

`retentionRemainingMs` 由已归档 change `harden-retention-policy` 作为交付物声明，但**全仓无人调用**——既无生产引用，也无模块内引用（`grep -rn retentionRemainingMs src/ tests/` 仅命中自身定义与其单测）。即：它是一处「被声明的能力，实际不存在」。

这正是本批反复出现的**假绿**形态（对照：死代码 `maxOutputBytes`、未接线的 `harnessCapabilityProfile`）。区别在于 `harnessCapabilityProfile` 有契约场景要求它可查询（故**接线**），而剩余时间**没有任何契约要求**：`failure-scene-retention-policy` 只要求「保留总数 + 超期清单」，二者均已交付。因此本处正确处置是**删除**，而非新增无契约的字段。

## What Changes

- `src/retention-policy.ts`：删除 `retentionRemainingMs`（无契约、无调用）。
- `tests/retention-policy.spec.ts`：删除仅覆盖该函数的用例与其导入。

保留 `isRetentionOverdue` / `summarizeRetainedScenes` / `summarizeRetentionCapacity` / `measureRetainedSceneBytes`——它们均有真实调用或有契约要求。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `failure-scene-retention-policy`: 明确该能力的查询面**只**包含「保留总数」与「超期清单」（不要求剩余时间），使被声明却不存在的助手不再被视为交付的一部分。

## Impact

- **模块/测试**：`src/retention-policy.ts`、`tests/retention-policy.spec.ts`（净删除 1 个导出与 1 个用例）。
- **兼容**：无任何调用方受影响（本就无调用）；`pnpm run check` 全绿（515 → 514 项）。
