# local-failure-retention (delta)

## ADDED Requirements

### Requirement: 保留现场状态必须在客户端只读呈现

客户端 SHALL 只读呈现保留现场的容量与逾期状态：保留总数、已度量体积（`retainedBytes` 与是否全部已度量）、是否超预算、以及逾期未决清单。数据 SHALL 来自既有只读查询并随运行时数据刷新。呈现 MUST NOT 提供删除或修改入口——保留现场的处置始终由人工通过既有显式清理路径决定。

#### Scenario: 保留现场区呈现容量与逾期

- **WHEN** 存在被保留的失败现场且打开客户端浮层
- **THEN** 保留现场区呈现其总数与逾期状态

#### Scenario: 无保留现场时呈现空态

- **WHEN** 不存在任何保留的失败现场
- **THEN** 保留现场区呈现为零/空态，而不是隐藏错误
