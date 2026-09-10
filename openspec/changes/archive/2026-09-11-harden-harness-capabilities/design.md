## Context

见 proposal.md（Why）。关键事实：

- `src/harness-discovery.ts` 的 `harnessProbeAvailability` 只判断「是否有兼容模型 + 是否在池内」，返回 `apiReady` 布尔与原因。
- Harness 探针结果为 `PactFlowHarnessProbeResult`，含 `success`、`stages`（`validate|create-job|model-response|api-response|cli-response|cleanup`）。
- `PACTFLOW_HARNESS_API_MODE` 在 `k3s-worker.ts` 中定义（claude→anthropic-messages，codex→openai-responses，opencode/dsh→openai-chat-completions）。

约束：不改既有探针字段语义（新增可选字段）；不引入循环导入；不改 Harness 镜像/协议矩阵。

## Goals / Non-Goals

**Goals:**
- 用可验证级别表达「可调用」与「可交付」的差别。
- 实际级别只由观测证据推导，低级别不得被呈现为高级别。

**Non-Goals:**
- 不实现跨 Harness 的能力协商或自动降级。
- 不改变实际探针行为（本 change 只增加分级报告）。
- 不引入模型用量/token 统计（属 A11 后续）。

## Decisions

### D1：级别常量化于独立模块，镜像函数本地化以避免循环导入

`harness-capabilities.ts` 需要 `PACTFLOW_HARNESS_API_MODE`（来自 `k3s-worker.ts`），而 `k3s-worker.ts` 又需要级别推导。为避免循环导入，级别推导在 `k3s-worker.ts` 内有一个**最小的本地镜像函数**（`probeAchievedLevel`），纯模块 `harness-capabilities.ts` 供外部/测试使用；两者语义一致并有测试覆盖。

- 备选：把 API-mode 表抽到第三个模块以解环。否决——本 change 应尽量小；镜像函数配测试即可，抽表属结构重构（R12 范畴）。

### D2：级别推导只看 `stages`，不看 `success`

`success` 是整体布尔，无法反映达到哪一级。推导严格按阶段：cleanup 成功→cancellation；cli-response 成功→artifact；api/model-response 成功→protocol；否则 connection。cleanup **失败**视为未达到 cancellation。

### D3：字段可选，向后兼容

探针结果新增 `achievedLevel`/`maxLevel` 为可选字段，既有消费方无需改动。

## Risks / Trade-offs

- [两处级别推导可能漂移] → 本地镜像函数只覆盖探针结果形态，且有单测锁定语义；`harness-capabilities.spec.ts` 与探针测试共同覆盖。
- [`tool-invocation`/`verification` 级别当前无探针证据支撑] → 级别常量保留完整顺序，但推导函数在缺少证据时不会声称这两级，避免虚报。

## Open Questions

- 是否需要为 `tool-invocation`/`verification` 增加专门探针阶段——留待后续。
