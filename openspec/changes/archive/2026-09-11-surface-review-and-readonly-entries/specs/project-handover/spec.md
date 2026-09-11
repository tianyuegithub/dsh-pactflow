# project-handover (delta)

## ADDED Requirements

### Requirement: 前端必须提供只读移交入口

客户端 SHALL 提供一个只读入口呈现移交摘要（项目身份与版本、阶段、精确 Git 产物、验证执行数、未完成责任、包版本与 reader 版本），并支持复制摘要内容。该入口 MUST NOT 写任何状态、MUST NOT 触发任何清理；摘要缺失（如会话不 live）时 MUST 呈现为可读的空态而非失败。

#### Scenario: 入口呈现摘要并可复制

- **WHEN** 打开客户端浮层并触发移交入口
- **THEN** 摘要内容（含包版本与 reader 版本）以只读形式呈现，并可复制

#### Scenario: 入口不写状态

- **WHEN** 使用移交入口
- **THEN** 不产生任何状态变更或清理动作
