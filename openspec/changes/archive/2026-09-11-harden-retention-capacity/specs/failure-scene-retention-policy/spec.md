## ADDED Requirements

### Requirement: 保留现场必须有界可计量

保留的失败现场 SHALL 记录其占用字节数（有界测量：测量过程 MUST 在条目数或字节数达到上限时停止，MUST NOT 因现场过大而无限遍历或阻塞）。缺省未测量 MUST 被表示为「未测量」而不是 0。

#### Scenario: 保留时测量现场大小

- **WHEN** 一个本地 Run 失败并登记保留现场
- **THEN** 该现场记录带有非负的 `sizeBytes`，测量过程有界（条目/字节达到上限即停止）

#### Scenario: 缺失或过大的现场不阻塞失败路径

- **WHEN** 现场根不存在，或现场超出测量上限
- **THEN** 测量返回 0 或一个带上限标记的下界，MUST NOT 抛错中断失败结算

### Requirement: 容量呈现不得把部分和伪装为完整总量

只读保留状态 SHALL 报告已测量的保留总字节、总量是否完整（`measured`）以及是否超预算（`overBudget`）。仅当**每个**保留现场都被测量时 `measured` 才为真，且 `overBudget` 仅在完整测量且总量达到预算时为真。Host MUST NOT 自动删除任何保留现场。

#### Scenario: 全部测量时给出真实总量与预算判定

- **WHEN** 所有保留现场都有记录的字节数
- **THEN** 报告的总字节为真实总量、`measured=true`，且当总量达到预算时 `overBudget=true`

#### Scenario: 存在未测量现场时不谎报完整总量

- **WHEN** 至少一个保留现场未测量
- **THEN** 报告的总字节为下界、`measured=false`，且 `overBudget=false`（不据下界宣称超预算）

#### Scenario: 无保留现场

- **WHEN** 没有任何保留现场
- **THEN** 报告总字节为 0 且 `measured=true`、`overBudget=false`
