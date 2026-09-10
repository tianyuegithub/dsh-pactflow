# credential-safe-display Specification

## Purpose
约束插件对外可见的输出（工作区状态、错误摘要、快照字段）：在保留可排障的 host/path 信息的同时，必须移除以 userinfo 形式内嵌在远端地址里的凭据，使原始 token 不会经 UI、模型快照或错误消息泄露。

## Requirements

### Requirement: 远端地址展示必须移除内嵌凭据

Host 在把远端地址（如 `git remote get-url` 的结果）放入任何对 UI、模型快照或 Remote 返回的结构字段之前，SHALL 移除其 userinfo 部分，并以固定占位替代。移除后 MUST 保留 scheme、host 与 path，以便用户识别是哪个远端。不含 userinfo 的地址 MUST 原样返回。包含内嵌凭据的 SCP 形式（`user:pass@host:path`）同样 SHALL 被脱敏。

#### Scenario: HTTPS 远端中的 token 被替换

- **WHEN** 工作区 origin 为 `https://user:secret-token@git.example/owner/repo.git`
- **THEN** 返回的远端地址不含 `secret-token`，且仍包含 `git.example` 与 `owner/repo`

#### Scenario: 无凭据的远端保持不变

- **WHEN** origin 为 `https://git.example/owner/repo.git` 或 `git@git.example:owner/repo.git`
- **THEN** 返回的远端地址与输入一致（scp 形式的 `user@host` 属用户标识，不当作密钥移除）

#### Scenario: 工作区状态不泄露凭据

- **WHEN** 用户工作区的 origin 内嵌凭据并被检查
- **THEN** `PactFlowWorkspaceGitStatus` 的远端字段与整个返回对象序列化后都不含该凭据

### Requirement: 错误摘要必须先脱敏再截断

Host 在生成对外错误摘要（如 `boundedOutcome`）时 SHALL 先移除可结构识别的内嵌凭据，再做长度截断。MUST NOT 在含凭据的原文被截断后仍保留其可还原前缀。该处理 MUST NOT 被表述为能够检测任意未知秘密，只覆盖以 URL/SCP userinfo 形式出现的凭据。

#### Scenario: 错误消息中的内嵌凭据被移除

- **WHEN** 一个错误消息包含 `https://user:secret-token@git.example/owner/repo.git` 并进入摘要渲染
- **THEN** 输出不含 `secret-token`，长度限制仍然生效

#### Scenario: 超长消息的截断不残留凭据前缀

- **WHEN** 一条超长错误消息在靠前位置包含内嵌凭据
- **THEN** 截断结果既满足长度上限，也不含该凭据的可见前缀

#### Scenario: 不含凭据的消息不受影响

- **WHEN** 错误消息不含任何 URL userinfo 凭据
- **THEN** 摘要内容除长度限制外与原文一致
