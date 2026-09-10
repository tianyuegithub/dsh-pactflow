## ADDED Requirements

### Requirement: 派发与恢复宿主不得依赖整个上下文

`DispatchHost` 与 `RecoveryHost` SHALL 通过窄端口声明其所需能力，其宿主接口 MUST NOT 暴露整个 Cordis 上下文对象。派发宿主只能通过 agent/subagent 端口解析本地执行；恢复宿主只能通过日志端口与「按会话 id 读取 live 会话」端口访问宿主状态。二者的行为 MUST 能在不含上下文对象的宿主替身上被驱动。

#### Scenario: 本地执行仅经 agent/subagent 窄端口解析

- **WHEN** 以一个只提供 `agents()` 与 `subagents()`、不含 `ctx` 的宿主替身解析一次本地执行
- **THEN** 成功返回父 Agent 与裁剪后的 prompt；若提供方不支持工作树而任务需要 cwd，则拒绝并报错

#### Scenario: 本地租约到期恢复仅经 logger/liveSession 窄端口

- **WHEN** 以一个只提供 `logger` 与 `liveSession`、不含 `ctx` 的宿主替身驱动本地租约到期恢复
- **THEN** 到期定时器被登记、到期时经 `liveSession` 重入恢复；重入抛错时经 `logger` 记录，且不影响宿主

#### Scenario: 依赖面收窄后行为不变

- **WHEN** 收窄 `DispatchHost` / `RecoveryHost` 后运行既有派发、恢复、重试与清理测试
- **THEN** 全部通过，行为与收窄前一致
