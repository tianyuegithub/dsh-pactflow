# local-failure-retention Specification

## Purpose
保证本地执行失败后留在磁盘上的任务分支与 worktree 形成**可发现、可审计**的清理责任，而不是沉默残留；并明确区分为「待清理」与「保留待人工审查」两种，使**保留的失败现场不会被自动清理删除**。

## Requirements

### Requirement: 本地失败必须登记可发现的清理责任

当一次本地 Git 派发以失败（或取消）结算，且该 Run 已在磁盘上创建任务分支或 worktree 时，Host SHALL 为该任务分支登记一条清理责任记录，使该残留可被发现与审计。登记 MUST NOT 删除任何 worktree、分支或文件。

#### Scenario: 失败后留下可发现的清理责任

- **WHEN** 本地派发在 materialize 之后失败并结算
- **THEN** 存在一条指向该任务分支的清理责任记录，且 worktree 仍保留在磁盘上

#### Scenario: 登记不删除失败现场

- **WHEN** 失败结算登记清理责任
- **THEN** 该 Run 的 worktree 与任务分支在磁盘上保持不变

#### Scenario: 重复结算不产生重复责任

- **WHEN** 同一 Run 的失败结算被处理一次以上
- **THEN** 该目标只存在一条清理记录

### Requirement: 保留的失败现场不得被自动清理

清理责任记录 SHALL 可标记为「保留待审查」。被标记保留的记录 MUST NOT 被自动清理流程删除（包括会话恢复时的清理对账），MUST 保持可发现以供人工决定；只有显式的清理操作才能处理它。

#### Scenario: 恢复对账不删除保留记录

- **WHEN** 会话恢复触发清理对账，而账本中存在标记为保留的失败记录
- **THEN** 该记录的 worktree 与任务分支不被删除，记录仍可被发现

#### Scenario: 显式清理仍可处理保留记录

- **WHEN** 对一条保留记录发起显式清理
- **THEN** 该清理按既有精确目标语义执行
