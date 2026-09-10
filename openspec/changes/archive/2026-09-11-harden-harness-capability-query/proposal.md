## Why

`harness-capability-levels` 的合同要求「插件 SHALL 为其支持的每个 Harness 声明协议、结构化输出能力与最高能力级别」，且其场景以「**查询**任一受支持 Harness 的能力声明」表述。但实现上 `harnessCapabilityProfile` **从未被任何代码引用**（全仓仅自身与单测），即该「声明」无法被查询——合同里的查询场景没有对应实现，测试却在**死代码**上通过。

本 change 补上查询路径，使「声明」成为可检查的事实而非隐式约定。

（同类排查另外发现两处「导出且被单测引用、但生产未接线」的助手：`validationExecutedCount` 与 `retentionRemainingMs`。二者经核对**不构成缺口**——契约要求的「报告」已由 `snapshot()`（含 `gitResult.validations`）与 `retentionStatus()`（含 `retainUntil`）提供，调用方可直接据数据得出计数与剩余时间，故**不新增冗余字段**，仅在此记录判断。）

## What Changes

- `src/types.ts`：新增 `PactFlowHarnessCapabilityView`（可序列化：templateId / harness / apiMode / structuredOutput / maxLevel），供 Remote 边界返回。
- `src/index.ts`：新增 `@Remote('harnessCapabilities') listHarnessCapabilities()`，对已配置模板去重后返回每个 Harness 的声明能力（取 `harnessCapabilityProfile`，上限为可证级别）。
- `tests/harness-capabilities.spec.ts`：新增用例，断言服务确实暴露每个已配置 Harness 的声明（含 `structuredOutput` 与 `maxLevel == harnessProbeMaxLevel()`），即证明该助手已被接线。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `harness-capability-levels`: 「声明覆盖全部受支持 Harness」补充「声明 MUST 可通过查询获得（含已配置模板的身份与上限）」的合同与场景。

## Impact

- **Host**：`src/index.ts`（新增 Remote）、`src/types.ts`（新增视图类型）。
- **测试**：`tests/harness-capabilities.spec.ts` 新增 1 项。
- **兼容**：纯新增查询，不改变既有声明与探针行为；`pnpm run check` 全绿。
