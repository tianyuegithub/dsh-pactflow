## Why

`validation-integrity-signals` 的合同早已要求：

> Host SHALL 能报告本次交付实际执行的验证命令数量。当该数量为零时，该交付 MUST 可被识别为「没有自动验证」…

但实现它的助手 `validationExecutedCount` **零生产引用**——能力有合同、有实现、有单测，却**没有可查询的出口**，即合同里的两条场景（「可查询到执行数量为零」「执行数量等于实际执行的命令数」）在真实路径上不可满足。

此前的 A03 提案把它归为「待裁决的新接线项」，但复核合同后应更正：**它不是新目标，而是与 `harnessCapabilityProfile` 同类的既有合同未接线**，正确处置是**接线**（而非等裁决，也非删除）。

## What Changes

- `src/project-handover.ts`：把每个交付构件的 `validationsExecuted` 一并写入只读移交摘要——`validationExecutedCount({ validations: run.gitResult.validations })`。
- `src/types.ts`：`PactFlowHandoverSummary.artifacts[]` 增字段 `validationsExecuted: number`，并注明「零即表示本次交付**没有自动验证**」。
- `tests/project-handover.spec.ts`：既有断言更新为含该字段（0），并新增「有两条验证时计数为 2」。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `validation-integrity-signals`: 「零自动验证必须可识别」补充「该数量必须出现在只读交付视图（移交摘要）中，使零验证可直接读出而非由别处推断」。

## Impact

- **Host/类型**：`src/project-handover.ts`、`src/types.ts`（只读字段新增）。
- **测试**：`tests/project-handover.spec.ts`（4 项）。
- **兼容**：纯新增只读字段；`validationExecutedCount` 由死代码变为真实接线；`pnpm run check` 全绿（525 → 526）。
