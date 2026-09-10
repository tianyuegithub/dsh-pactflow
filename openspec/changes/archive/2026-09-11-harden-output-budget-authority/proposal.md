## Why

A11 的「输出/日志容量上限」此前是**名义存在、实际未接线**：`run-budget.ts` 定义了 `maxOutputBytes` 且有测试，但 `boundedOutcome` 用的是硬编码的 4096 字节上限，预算字段从未生效。即「上限」有两套数字、以硬编码为准，预算形同虚设。

本 change 让**运行预算成为输出上限的唯一权威**，并保持既有 4096 字节的实际截断量不变（避免因接线而静默放大已存储文本）。

## What Changes

- `src/index.ts`：`boundedOutcome` 改用 `boundOutputToBudget(redacted, this.runBudget.maxOutputBytes)`；缺省时回退 `PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes`，使仅原型实例（无实例预算）的测试替身仍可用。仍**先脱敏后截断**。
- `src/run-budget.ts`：默认 `maxOutputBytes` 由 `16_384` 调整为 `4_096`，与长期实际生效的截断量一致（不放大存量）。
- `tests/run-budgets.spec.ts`：新增断言——默认预算下超出即截断且带标记；收紧实例预算到 128 字节后，存储结果确实收紧到 128 字节以内。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `run-budgets`: 「输出体积必须有界且截断可见」补充「上限由运行预算单一权威决定，且该上限必须实际生效」的合同与场景。

## Impact

- **Host**：`src/index.ts`（`boundedOutcome`）、`src/run-budget.ts`（默认值）。
- **测试**：`tests/run-budgets.spec.ts` 新增输出预算生效断言；`tests/display-redaction.spec.ts` 既有「先脱敏后截断」断言保持通过（4096 字节不变）。
- **兼容**：默认截断量不变（4096 字节）；仅新增「预算可收紧上限」的能力，`pnpm run check` 全绿。
