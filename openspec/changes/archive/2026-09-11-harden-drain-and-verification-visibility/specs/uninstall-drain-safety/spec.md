# uninstall-drain-safety Specification

## ADDED Requirements

### Requirement: 卸载前必须能查询活跃责任

Host SHALL 提供一个只读入口，跨该插件拥有的 PactFlow 会话汇总**非终态 Run**与**未成功清理责任**，并据此给出是否宜于卸载的明确判定。该入口 MUST NOT 修改任何状态、MUST NOT 触发清理、MUST NOT 需要目标会话处于 live。

#### Scenario: 无活跃责任时判定可安全卸载

- **WHEN** 不存在非终态 Run，也不存在未成功的清理责任
- **THEN** 查询返回可安全卸载，且活跃 Run 与未完成责任列表均为空

#### Scenario: 存在活跃 Run 时不宜卸载并列出

- **WHEN** 某 PactFlow 会话存在一个非终态 Run
- **THEN** 查询返回不宜卸载，且活跃 Run 列表中包含该 Run 的会话与 Run 身份

#### Scenario: 存在未完成清理责任时不宜卸载并列出

- **WHEN** 某 PactFlow 会话存在状态非成功的清理责任（含被标记保留的失败现场）
- **THEN** 查询返回不宜卸载，且未完成责任列表中包含该责任的 id 与目标

#### Scenario: 查询只读且不清理

- **WHEN** 调用该查询
- **THEN** 不产生任何清理动作，也不改变任何投影或持久状态；重复调用得到一致结果

### Requirement: 卸载流程必须引用 drain 检查

安装运维手册的卸载步骤 SHALL 要求先执行 drain 检查，并说明非空时的处置（先完成/取消任务、重试清理，或在知情下确认继续）。该要求 MUST 由测试绑定到 Host 实际暴露的查询名，使文档与实现不会各自漂移。

#### Scenario: 手册卸载步骤包含 drain 前置

- **WHEN** 阅读手册的卸载小节
- **THEN** 其中包含 drain 检查步骤，且提及的查询名与 Host 实际暴露的 Remote 名一致
