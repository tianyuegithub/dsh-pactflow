## Why

GPT 评审附录 A11 指出：现有 Pool `maxConcurrency` 只解决**机器占用**，不足以控制一次 run 的无限循环、反复失败推理与日志膨胀。缺少有界预算时，失败重试可以无限进行，输出可以无限增长。

本 change 取其中**边界清晰、可独立验收**的部分：**尝试次数预算**与**输出字节预算**，且预算触及时**显式说明原因**，不静默降级。

## What Changes

- 新增纯模块 `src/run-budget.ts`：
  - `PACTFLOW_DEFAULT_RUN_BUDGET`（`maxAttempts: 5`、`maxOutputBytes: 16384`）。
  - `evaluateAttemptBudget(maxAttempts, nextAttempt)`：越界即返回 `{ exhausted: true, reason: 'attempts', detail }`。
  - `boundOutputToBudget(value, maxOutputBytes)`：超出即截断并附带显式标记与原始字节数。
- `retryNode` 在重试前评估尝试预算；超预算即拒绝并说明 `attempt N exceeds the budget of M attempts`。

## Capabilities

### New Capabilities
- `run-budgets`: 单次工作的重试次数与输出体积必须有有界预算；预算触及时必须显式说明原因，不得静默继续或静默降级。

### Modified Capabilities
（无。）

## Impact

- **Host**：新增 `src/run-budget.ts`；`src/index.ts`（`runBudget` 字段与 `retryNode` 评估）；`tsconfig.host.json`。
- **测试**：新增 `tests/run-budgets.spec.ts`（纯函数 4 项 + `retryNode` 预算强制执行 1 项）。
- **兼容**：默认预算宽松（5 次尝试）；既有 `retryNode` 单次重试用例（nextAttempt=2）不受影响。
