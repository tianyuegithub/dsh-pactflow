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
