## Why

GPT 评审 F03 建议里包含一项增强：**前序任务重跑后，后序任务基于旧输入的成果应被显式标记过期**，而不是被当作仍有效。此前 F03 只保证「派发时取最新成功提交」，没有记录「后序实际消费的是哪个提交」，也就无法判断该输入后来是否已过期。

## What Changes

- 新增纯模块 `src/input-staleness.ts`：`staleCodeInputs(recorded, latestByDependency)` —— 把后序**实际消费**的代码输入（依赖、分支、提交）与其依赖**当前最新成功提交**逐一比对，报告过期的输入（含 recorded 与 latest）。确定性排序；无法得知最新提交的依赖不误报。
- 代码输入记录新增可选 `dependency`（依赖节点编号），使「消费的是哪个依赖的哪个提交」可被持久化与比对。
- 新增只读 Remote `staleCodeInputs(sessionId, nodeId)`：报告某节点最新 Run 的代码输入中已过期的项；**只报告、不修改**——「后序曾基于 v1 运行」这一历史事实被保留，由人决定是否重跑。

## Capabilities

### New Capabilities
- `code-input-staleness`: 后序任务实际消费的代码输入必须可与其依赖的最新成功提交比对，过期输入必须被显式报告；历史事实不得被静默改写或自动修复。

### Modified Capabilities
（无独立 delta；该能力补充 `dependency-code-inputs` 的输入追踪。）

## Impact

- **Host**：新增 `src/input-staleness.ts`、只读 Remote `staleCodeInputs`；`PactFlowGitRunSpec.codeInputs` 增加可选 `dependency`（schema 同步）；`codeInputCommits` 带上依赖编号；`tsconfig.host.json`。
- **测试**：`tests/input-staleness.spec.ts`（4 项纯函数）、`tests/input-staleness-e2e.spec.ts`（1 项可达性边界）。
- **兼容**：字段可选，既有记录读取不受影响。
