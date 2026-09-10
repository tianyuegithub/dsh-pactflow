## ADDED Requirements

### Requirement: 真实套件必须清理其创建的资源且清理失败可见

真实环境套件 SHALL 删除它创建的远程分支与集群资源。清理 MUST 被验证（删除后确认引用/对象确实消失）；清理失败 MUST 可见——使套件失败或显式告警，MUST NOT 被静默吞掉。用于集群对象的名称校验器 MUST NOT 被套用于 git 引用名（后者合法包含 `/`）。

#### Scenario: 运行后不残留远程分支

- **WHEN** 真实崩溃重启套件运行结束
- **THEN** 它创建的任务分支已从远程删除，且随后复核仍不存在

#### Scenario: 清理失败使套件失败

- **WHEN** 任务分支最终未能删除
- **THEN** 裁决标记为不通过并说明原因（`remote task branch was not cleaned up`），而不是静默报告成功

#### Scenario: 迟到的 push 不使删除失效

- **WHEN** 被 SIGKILL 的 Worker 在清理开始后仍完成了一次 push
- **THEN** 清理通过重试与复核最终移除该分支，不留下残留
