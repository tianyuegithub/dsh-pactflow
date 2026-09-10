## ADDED Requirements

### Requirement: 零验证必须可从只读交付视图直接读出

只读交付视图（项目移交摘要）SHALL 为每个交付构件报告其**实际执行的验证命令数量**。为零时，读者 MUST 能直接据该字段判定「本次交付没有自动验证」，MUST NOT 需要从别处推断或被呈现为已验证。

#### Scenario: 零验证在移交摘要中可识别

- **WHEN** 某交付构件没有任何成功验证证据
- **THEN** 其移交摘要条目携带 `validationsExecuted: 0`，即「没有自动验证」可直接读出

#### Scenario: 有验证时计数与实现数量一致

- **WHEN** 某交付构件执行了两条登记验证
- **THEN** 其 `validationsExecuted` 为 2

#### Scenario: 计数来自真实验证证据而非自报

- **WHEN** 计算该数量
- **THEN** 它取自交付构件的验证证据集合长度，不由模型自述或其它来源估计
