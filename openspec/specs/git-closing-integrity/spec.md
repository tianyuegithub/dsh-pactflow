# git-closing-integrity Specification

## Purpose
保证代码收口的交付事实可信且可恢复：交付记录必须指向宿主在隔离目录中独立复验过的精确合并提交，而不是默认分支当时的可变化 tip；收口在记录与阶段推进之间中断后，重试必须复用既有交付事实并补齐后续步骤，既不重建记录也不重复合并。

## Requirements

### Requirement: 交付记录必须绑定独立复验过的精确合并提交

Host 在受保护默认分支完成合并后 SHALL 对 Git 提供者报告的精确 merge SHA 做独立复验：取回该提交、在隔离目录检出并运行同一套已登记验证命令、要求该提交是默认分支可达提交。`release.commit` MUST 记录这个被复验的精确 SHA，MUST NOT 记录默认分支当时的 tip。默认分支的祖先关系检查保留为附加证明，MUST NOT 替代对精确提交的验证。

#### Scenario: 精确合并提交通过复验后记录该 SHA

- **WHEN** Gitea 合并返回精确 merge SHA，且该提交在隔离目录中通过全部登记验证命令
- **THEN** `release.commit` 等于该精确 merge SHA

#### Scenario: 合并后默认分支前进不改变本次交付

- **WHEN** 合并完成后默认分支又前进了新的提交
- **THEN** 本次交付仍绑定自己的精确 merge SHA，不绑定默认分支的新 tip

#### Scenario: 精确合并提交未通过复验时拒绝完成

- **WHEN** 精确 merge SHA 在隔离目录中未通过登记验证命令
- **THEN** Host 拒绝写入交付记录并拒绝推进阶段，保留可恢复状态

#### Scenario: 集成提交必须是精确合并提交的祖先

- **WHEN** 被确认的精确 merge SHA 不包含已验证的集成提交
- **THEN** Host 拒绝完成交付

### Requirement: 收口必须以当前项目绑定解析 Git 认证

Host SHALL 从**当前项目绑定**解析收口全程（集成分支构造、推送、合并核验、任务引用核验）使用的 Git 认证；交付运行的认证声明只作为该运行自身执行时的历史证据，MUST NOT 被用作收口凭据来源。收口凭据解析失败时 SHALL 指名拒绝，不得静默回落到运行声明或其它来源。

#### Scenario: 运行产生于旧绑定后项目重绑仍可收口

- **WHEN** 交付运行产生于旧项目绑定（如无认证的 SSH 远端），此后项目重绑为带 token 认证的 HTTPS 远端
- **THEN** 收口以当前绑定的认证解析凭据并继续，不因运行时代认证缺失或不一致被拒绝

#### Scenario: 绑定凭据引用不可解析时指名拒绝

- **WHEN** 当前绑定声明的凭据引用无法解析
- **THEN** 收口被拒绝且错误指名凭据引用，不回落到运行认证声明

### Requirement: 收口在记录与阶段推进之间中断后必须幂等恢复

当某 Need 的交付记录已存在、而阶段推进尚未完成时，Host SHALL 在重试中**原样复用**既有 release 的 `commit`、`branch`、`serviceUrl` 与 `recordedAt`，MUST NOT 重建或修改已记录的 release。Host MUST 补齐缺失的阶段推进，MUST NOT 重复合并已合并的拉取请求。仅当不存在既有 release 时才构造并记录新的 release。

#### Scenario: 已记录 release 时重试复用原记录

- **WHEN** release 已成功落账但阶段仍为 closing，随后重试收口
- **THEN** 重试复用原 `recordedAt` 与 `commit`，不产生 `changed after recording` 错误，并推进阶段

#### Scenario: 重试不重建 recordedAt

- **WHEN** 同一次收口被重试多次
- **THEN** 该 Need 的 release 只存在一条，其 `recordedAt` 在整个过程中保持不变

#### Scenario: 已合并的拉取请求不重复合并

- **WHEN** 重试时该集成分支的拉取请求已处于 merged 状态
- **THEN** Host 不再发起合并，仅核验精确提交并要求同一身份

#### Scenario: 既有 release 与当前集成分歧时失败关闭

- **WHEN** 存在既有 release，但重试解析出的集成提交或输入摘要与既有记录不一致
- **THEN** Host 拒绝自动收口并保留显式恢复路径，不静默改写交付事实

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
