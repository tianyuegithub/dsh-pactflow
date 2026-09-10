## Why

GPT 全面评审（2026-09-10）静态审查项 A10 指出两处展示/输出卫生问题，均可在当前源码指认：

- `src/workspace-project.ts` 的 `inspectWorkspaceGit` 把 `git remote get-url origin` 的原值直接放进 `PactFlowWorkspaceGitStatus.remoteUrl` 返回。用户的既有仓库若 URL 内嵌 userinfo（如 `https://user:token@host/repo.git`），token 会随工作区状态进入 UI 与模型快照。
- `src/index.ts` 的 `boundedOutcome` 只做长度截断，不做已知凭据脱敏。Git/HTTP 错误消息可能回显带凭据的远端 URL，使截断后的错误仍携带密钥。

目标架构 §4 不变量「原始凭证不得进入 Session Log、Remote payload、Tool result、Git、argv、截图或持久日志」要求展示与错误输出同样不得携带凭据。这是小范围、自包含的卫生修复。

## What Changes

- 新增共享的 URL 凭据脱敏：把 URL/SCP 形式的远端地址中的 userinfo 部分替换为固定占位（保留 scheme/host/path 以便排障），并覆盖常见内嵌形式。
- `inspectWorkspaceGit` 返回前对 `remoteUrl` 脱敏。
- `boundedOutcome`（错误摘要渲染）在截断前先对已知的 URL userinfo 形式脱敏；**不**声称能识别任意未知秘密，只移除可结构识别的内嵌凭据。

## Capabilities

### New Capabilities
- `credential-safe-display`: 面向 UI、快照与错误摘要的输出在保留排障信息的前提下，不得携带以 userinfo 形式内嵌于 URL/远端地址的凭据。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/workspace-project.ts`（工作区状态脱敏）、`src/index.ts`（`boundedOutcome` 脱敏）、可能新增 `src/redaction.ts` 共享助手。
- **Client**：工作区 Git 向导展示的 origin 使用脱敏值（结构不变）。
- **测试**：`tests/workspace-project.spec.ts` 与错误摘要相关用例新增负例。
- **兼容**：不改变字段结构；不含凭据的 URL 原样返回；不修改 DSH 核心。
