# failure-scene-retention-policy (delta)

## MODIFIED Requirements

### Requirement: 保留查询面只包含契约要求的内容

`failure-scene-retention-policy` 的只读查询 SHALL 只暴露由本能力契约要求的内容。MUST NOT 存在被声明为该能力交付物、却无任何契约要求且无调用方的助手——无契约的助手不得以「已交付」的形式留在交付面上。

> 本条此前把允许的内容写成穷举清单（「SHALL 只返回契约要求的『保留总数』与『超期清单』」），于是与同文件「容量呈现不得把部分和伪装为完整总量」互斥——后者要求同一查询报告 `retainedBytes` / `measured` / `overBudget`，而那三项正是契约要求的。按字面读法，现网实现必然违规其一。判据据此改为「由契约要求」而非枚举，本条真正要防的「无契约助手」逐字保留。

#### Scenario: 查询面不含无契约字段

- **WHEN** 检查保留能力的查询面
- **THEN** 其每一项都能对应到本能力的某条契约要求，不含任何无契约、无调用方的额外助手

#### Scenario: 已交付能力仍可用

- **WHEN** 存在保留现场并请求查询
- **THEN** 返回保留总数与超期清单（超期项可识别），行为与删除无契约助手前一致

#### Scenario: 契约要求的容量三项属于查询面

- **WHEN** 检查该查询是否可以携带 `retainedBytes`、`measured` 与 `overBudget`
- **THEN** 三者因「容量呈现不得把部分和伪装为完整总量」而属于契约要求的内容，MUST NOT 被本条判为多余
