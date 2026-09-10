# harness-capability-levels Specification

## Purpose
让 Harness 的能力**可分级声明与可验证报告**：实际达到的级别只能由观测证据推导，连通性成功不得被呈现为可交付成果；每个级别是一份独立可证伪的声明。

## Requirements

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

### Requirement: 只有可被探针证据证明的级别才能被声称

插件 SHALL 显式声明哪些能力级别可由本仓探针的观测证据证明，并从该集合取探针报告的级别上限。实际达到的级别 MUST 只由「成功阶段 → 级别」的显式映射推导。未被映射的阶段名（包括 `tool-invocation`、`verification` 以及任何未来新增名）MUST 被忽略，MUST NOT 被推断为级别。因此缺乏证据的级别 MUST NOT 被声称。

#### Scenario: 不可证级别永不虚报

- **WHEN** 以含 `tool-invocation` 或 `verification` 成功阶段（或任何未知阶段名）的观测推导实际级别
- **THEN** 结果为 `connection`（这些阶段被忽略），且 `tool-invocation`/`verification` 不出现在可证级别集合与阶段映射中

#### Scenario: 级别随成功阶段取最高

- **WHEN** 观测到多个成功阶段（例如 cleanup 与 cli-response 均成功）
- **THEN** 报告的级别为其中最高者，且不因阶段出现顺序而降低

#### Scenario: 探针上限取自可证集合

- **WHEN** 查询探针报告的级别上限
- **THEN** 其值等于可证级别集合中的最高级别，且不低于 `artifact`

### Requirement: 每条真实探测路径都必须报告能力级别

镜像探针与 API 探针 SHALL 与其结果一并报告实际达到的级别与上限，使任何探测路径都不会对能力级别保持沉默。API 探针不运行 CLI，其阶段 MUST NOT 含 `cli-response`，因此其级别 MUST NOT 由 API 响应被判为 `artifact`（只由协议响应与清理证据推导）。

#### Scenario: 镜像探针报告级别

- **WHEN** 镜像探针成功运行 CLI 并完成清理
- **THEN** 结果的级别为 `cancellation`，上限为可证集合的最高级别

#### Scenario: API 探针的级别只由协议与清理证据推导

- **WHEN** API 探针完成协议响应并完成清理
- **THEN** 其阶段不含 `cli-response`，且其级别由协议/清理阶段推导（不是由 API 响应直接判为 `artifact`）

### Requirement: Harness 能力声明必须可查询

插件 SHALL 提供查询，返回每个已配置 Harness 模板的声明能力：模板身份、Harness、协议模式、结构化输出形态与最高支持级别。查询 MUST 去重同一模板 id，且其上限 MUST 取自可被证据证明的级别集合。声明只在可被查询时才构成事实。

#### Scenario: 查询覆盖全部已配置模板

- **WHEN** 配置了多个 Harness 模板并请求能力声明
- **THEN** 结果包含每个模板的身份、协议模式、结构化输出形态与最高级别

#### Scenario: 上限取自可证级别

- **WHEN** 查询某 Harness 的声明能力
- **THEN** 其最高级别等于可证级别集合的最高级（`harnessProbeMaxLevel()`），不低于 `artifact`

#### Scenario: 同 id 模板去重

- **WHEN** 存在同一 id 的重复模板条目
- **THEN** 该 id 在声明结果中只出现一次
