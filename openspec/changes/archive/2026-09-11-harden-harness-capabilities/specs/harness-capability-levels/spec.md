## Purpose

让 Harness 的能力**可分级声明与可验证报告**：实际达到的级别只能由观测证据推导，连通性成功不得被呈现为可交付成果；每个级别是一份独立可证伪的声明。

## ADDED Requirements

### Requirement: Harness 能力必须以可验证级别声明

插件 SHALL 为其支持的每个 Harness 声明协议、结构化输出能力与支持的最高能力级别，级别顺序为 `connection → protocol → tool-invocation → artifact → verification → cancellation`。

#### Scenario: 声明覆盖全部受支持 Harness

- **WHEN** 查询任一受支持 Harness 的能力声明
- **THEN** 返回其协议、结构化输出形态与最高级别，且最高级别不低于 `artifact`（该 Harness 可运行有界 CLI 任务）

### Requirement: 实际达到的级别只能由观测证据推导

探针报告的实际级别 SHALL 仅依据观测到的阶段推导：清理成功才能声称 `cancellation`；CLI 响应成功才能声称 `artifact`；仅有模型/接口响应只能声称 `protocol`；无成功阶段则为 `connection`。清理失败 MUST NOT 被报告为 `cancellation`。

#### Scenario: 仅连通时只报告 protocol

- **WHEN** 探针只观测到接口或模型响应成功
- **THEN** 实际级别为 `protocol`

#### Scenario: CLI 响应成功才报告 artifact

- **WHEN** 探针观测到 CLI 响应成功但无清理成功
- **THEN** 实际级别为 `artifact`

#### Scenario: 清理成功才报告 cancellation

- **WHEN** 探针观测到清理成功
- **THEN** 实际级别为 `cancellation`

#### Scenario: 清理失败不得声称 cancellation

- **WHEN** 探针的清理阶段失败
- **THEN** 实际级别不高于 `artifact`
