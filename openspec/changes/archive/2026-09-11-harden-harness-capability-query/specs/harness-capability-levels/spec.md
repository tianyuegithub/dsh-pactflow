## ADDED Requirements

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
