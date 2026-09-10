## Why

GPT 评审附录 A10 指出：「多 Harness 的**可调用**与**可交付**应分级验收」。此前探针只报告 `success` 布尔值，无法区分「只是连上了模型端点」与「跑完并清理了一个有界 CLI 任务、产出了可交付成果」。把连通性成功当成成果交付，会让用户误判。

## What Changes

- 新增纯模块 `src/harness-capabilities.ts`：
  - `PACTFLOW_HARNESS_CAPABILITY_LEVELS`：`connection → protocol → tool-invocation → artifact → verification → cancellation`。
  - `harnessCapabilityProfile(harness)`：声明各 Harness 的协议、结构化输出能力与支持的最高级别。
  - `harnessAchievedLevel(result)`：**仅依据观测到的 stages** 推导实际达到的级别（`cleanup` 成功 → cancellation；`cli-response` 成功 → artifact；仅有 `model/api-response` → protocol；否则 connection），且 `cleanup` **失败**时不得声称 cancellation。
- Harness 探针结果新增 `achievedLevel` 与 `maxLevel` 字段（可选，向后兼容），使「实际达到的级别」与「声明支持的级别」都可被消费方看到。

## Capabilities

### New Capabilities
- `harness-capability-levels`: Harness 的能力必须以可验证的级别声明与报告；实际达到的级别只能由观测证据推导，连通性成功不得被呈现为可交付成果。

### Modified Capabilities
（无。）

## Impact

- **Host**：新增 `src/harness-capabilities.ts`；`src/k3s-worker.ts`（探针结果附 `achievedLevel`/`maxLevel`，含本地镜像函数避免循环导入）；`src/types.ts`；`tsconfig.host.json`。
- **测试**：新增 `tests/harness-capabilities.spec.ts`（级别顺序、声明契约、按 stages 推导、cleanup 失败不得声称 cancellation）。
- **兼容**：字段可选，既有探针消费方不受影响。
