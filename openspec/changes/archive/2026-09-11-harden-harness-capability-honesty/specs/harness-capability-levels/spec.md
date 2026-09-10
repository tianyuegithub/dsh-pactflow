## ADDED Requirements

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
