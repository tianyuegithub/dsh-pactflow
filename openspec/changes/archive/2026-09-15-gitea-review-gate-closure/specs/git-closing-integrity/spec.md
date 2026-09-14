## ADDED Requirements

### Requirement: 受保护分支要求外部评审时收口不得放弃

收口遇到受保护默认分支的 required approvals 或 status checks 时，Host SHALL 进入持久的「等待外部评审」子状态并继续持有收口责任，MUST NOT 抛错放弃、MUST NOT 把该情形表达为交付失败、MUST NOT 要求用户在平台外手工合并来产生交付终态。

交付终态 SHALL 继续只由 Host 完成合并、复验与祖先链核验后产生——等待路径与直接合并路径 MUST 共用同一段核验实现，且清理责任 MUST 先于交付记录持久化。

#### Scenario: 存在评审要求时收口继续持有责任

- **WHEN** 受保护默认分支要求批准或检查，Host 执行收口
- **THEN** Host 进入持久等待态并保留收口责任，不抛出「无法自动合并」类错误，需求不进入失败终态

#### Scenario: 两条路径的核验不可分叉

- **WHEN** 收口经等待路径完成合并
- **THEN** 其复验、祖先链核验与任务集合核验与无保护分支路径调用同一段实现，核验强度不降低

### Requirement: 外部手工合并只能经显式收口请求处置

等待期间人在 Gitea 网页直接合并了 PR 时：**后台复查** SHALL 如实标记「已被外部合并」并停止后台复查，MUST NOT 自动产生交付终态。**显式收口请求**（人或模型再次调用收口）SHALL 走既有的 `merged === true` 路径——核验 merge commit 与发布提交精确一致、祖先链成立、任务集合精确对应本次基线——核验通过才产生交付终态；核验失败 SHALL 指名拒绝，MUST NOT 因「已经合并了」而放宽。

该 Requirement 与既有实现的关系：既有 `priorPullRequest?.merged === true → verifyClosingMerged → verifyClosingTaskRefs` 路径**即为**显式处置的实现，本 change 不重写它；新增的只是「后台复查不得自动走这条路径」的约束。

#### Scenario: 后台复查发现外部合并时只标记不追认

- **WHEN** 后台复查发现 PR 已被外部合并
- **THEN** 等待态标记为「已被外部合并」，后台复查停止，不产生 `pactflow/release-recorded`，需求仍在 `closing`

#### Scenario: 显式收口请求走既有核验并可通过

- **WHEN** 已被外部合并后，人或模型再次显式请求收口，且 merge commit、祖先链与任务集合核验全部通过
- **THEN** 产生交付终态，行为与既有 `merged === true` 路径一致

#### Scenario: 显式收口请求核验失败时指名拒绝

- **WHEN** 已被外部合并后显式请求收口，但任务集合与本次基线不符
- **THEN** 收口被拒绝并指名不符项，不产生交付终态
