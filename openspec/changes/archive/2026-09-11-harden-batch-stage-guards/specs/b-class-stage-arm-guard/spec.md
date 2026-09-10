## ADDED Requirements

### Requirement: B 类批次阶段必须在未武装时失败关闭

变更型（B 类）批处理阶段（`ttlStage`、`zeroProofStage`）SHALL 在未显式武装时失败关闭并给出明确的「B-class operation」拒绝语，MUST NOT 在未武装时操作真实集群。「已武装」SHALL 只认定精确的 `1`（`0`、`true` 等其它值 MUST NOT 被当作已武装）。该守卫 MUST 被测试覆盖。

#### Scenario: 未设置时不运行

- **WHEN** 未设置该阶段的武装环境变量（空）
- **THEN** 调用该阶段抛出包含「B-class operation」的错误，且不操作集群

#### Scenario: 非 1 的值不视为武装

- **WHEN** 武装变量被设为 `0` 或 `true`
- **THEN** 仍抛出「B-class operation」错误（只有精确 `1` 才武装）

#### Scenario: 守卫被删除时测试失败

- **WHEN** 该守卫被误删或改宽
- **THEN** 对应测试失败（实测：守卫移除后该阶段会直接访问真实集群）
