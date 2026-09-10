# host-narrow-ports Specification

## Purpose
约束宿主模块的依赖面：模块只能通过**窄端口**获得其真正需要的能力（日志、投影读取等），不得接收整个 Cordis 上下文；模块应能在**不含上下文对象**的宿主替身上被驱动与测试，从而使职责与依赖真正解耦，而不仅是文件拆分。

## Requirements

### Requirement: 宿主模块不得依赖整个上下文

宿主模块 SHALL 通过窄端口声明其所需能力（例如日志端口、交付投影读取端口），其宿主接口 MUST NOT 暴露整个 Cordis 上下文对象。模块的行为 MUST 能在不含上下文对象的宿主替身上被驱动。

#### Scenario: 模块可在无上下文的宿主上运行

- **WHEN** 以一个只提供窄端口、不含 `ctx` 的宿主替身驱动清理对账
- **THEN** 对账正常执行（待处理责任被处理、保留责任被跳过）

#### Scenario: 依赖面收窄后行为不变

- **WHEN** 收窄接口后运行既有清理、探针对账与恢复测试
- **THEN** 全部通过，行为与收窄前一致

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
