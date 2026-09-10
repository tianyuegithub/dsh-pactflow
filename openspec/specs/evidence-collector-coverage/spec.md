# evidence-collector-coverage Specification

## Purpose
确保证据采集器的入口行为由**实际测试**覆盖（收齐、缺项、失败关闭），而非以「由既有测试覆盖」的口头结论代替——采集器若把缺项当通过或静默读入非法证据，会让下游门禁拿到被污染的输入，而门禁自身看起来仍是正确的。

## Requirements

### Requirement: 证据采集器入口必须被测试覆盖

证据采集器（`collectEvidence`）的入口行为 SHALL 有测试覆盖：完整批次收齐全部 target、缺项进入 `missing`、结构非法与目录缺失均失败关闭。覆盖率 MUST 由实际测试证明，MUST NOT 以「由既有测试覆盖」的口头结论代替。

#### Scenario: 完整批次收齐

- **WHEN** 批次目录含全部 target 的证据文件
- **THEN** 采集结果包含全部 target，`missing` 为空

#### Scenario: 缺项不被当作通过

- **WHEN** 批次缺少某个 target 的证据
- **THEN** 该 target 出现在 `missing` 中，不被计入已采集

#### Scenario: 结构非法失败关闭

- **WHEN** 某证据文件含未知字段或缺失必填
- **THEN** 采集失败关闭并指出结构原因

#### Scenario: 目录缺失失败关闭

- **WHEN** 批次目录不存在
- **THEN** 采集失败关闭并指出目录路径
