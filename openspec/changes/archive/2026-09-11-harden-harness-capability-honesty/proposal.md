## Why

A10 的能力阶梯声明了六级，但存在两个诚实性缺口：

1. **推导函数与常量表是两份**。`k3s-worker.ts` 里有一份本地镜像的级别推导，与 `harness-capabilities.ts` 的 `harnessAchievedLevel` 并列维护；两份逻辑一旦漂移，探针就会按一份规则推导、按另一份展示。
2. **不可证的级别没有被显式排除**。级别表含 `tool-invocation` 与 `verification`，但当前探针**没有任何阶段能为它们提供证据**（前者需要 Harness runner 上报工具调用，后者需要专门的验证阶段）。虽然现有推导恰好在缺证据时不会返回它们，但这一点此前**仅靠「没有对应 stage 分支」隐式成立**，没有常量/测试守住——未来有人补一个同名 stage 就会直接虚报。

此外，**镜像探针与 API 探针此前根本不报告** `achievedLevel`/`maxLevel`：镜像探针（无模型）与 API 探针（无 CLI）都是真实探测路径，却对能力级别保持沉默。

本 change 把「哪些级别可由本仓探针证据证明」变成**显式、可测的合同**，并把两份推导合并为一份。

## What Changes

- `src/harness-capabilities.ts`：
  - 新增 `PACTFLOW_HOST_ATTESTABLE_LEVELS`（本仓探针可证级别：`connection/protocol/artifact/cancellation`）与 `PACTFLOW_PROBE_STAGE_LEVEL`（阶段→级别映射）与 `harnessProbeMaxLevel()`。
  - `harnessAchievedLevel` 改为**按映射取所有成功阶段的最高级别**：对未知阶段名（含 `tool-invocation`/`verification`/未来新增名）**忽略而非推断**，因此不可证级别永不返回。
- `src/k3s-worker.ts`：删除本地重复推导，`probeAchievedLevel` 委托给共享函数；镜像探针与 API 探针的返回值补上 `achievedLevel`/`maxLevel`（用 `harnessProbeMaxLevel()` 作上限，而非硬编码 `'cancellation'`）。
- `src/types.ts`：`PactFlowApiProbeResult` 补齐 `achievedLevel`/`maxLevel` 字段。
- `tests/`：`harness-capabilities.spec.ts` 增加「不可证级别不被声称 / 未知阶段被忽略 / 级别随成功阶段取最高」断言；`k3s-cleanup.spec.ts` 增加两种探针的级别报告断言；`e2e/pactflow-harness-probes.e2e.spec.ts` 增加真实探测的级别断言（API 探针不得声称 `artifact`）。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `harness-capability-levels`: 补充「只有本仓探针证据可证的级别才能被声称；不可证级别（`tool-invocation`/`verification`）不得虚报，且未知阶段不得被推断为级别」的合同与场景；并明确上限取自可证级别集合。

## Impact

- **Host**：`src/harness-capabilities.ts`、`src/k3s-worker.ts`、`src/types.ts`。
- **测试**：`tests/harness-capabilities.spec.ts`、`tests/k3s-cleanup.spec.ts`、`e2e/pactflow-harness-probes.e2e.spec.ts`。
- **兼容**：`achievedLevel` 取值集合不变（仍为 `connection/protocol/artifact/cancellation`），仅把隐式不虚报变为显式合同；镜像/API 探针新增字段。`pnpm run check` 全绿。
