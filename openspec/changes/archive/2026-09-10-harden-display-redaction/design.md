## Context

见 proposal.md（Why）。关键事实：

- `src/workspace-project.ts` 的 `inspectWorkspaceGit` 直接把 `git remote get-url origin` 的值放进返回对象的 `remoteUrl` 字段，无任何脱敏。该对象经 `src/index.ts` 的 Remote 进入 UI 与模型快照。
- `src/index.ts` 的 `boundedOutcome` 只按 UTF-8 字节截断到 4096，不脱敏。
- 已有 `git-workspace.ts` 的 `credentialFreeRemote` 是**拒绝**式校验（发现凭据即抛错），用于绑定入口；展示路径需要的是**脱敏**而非拒绝——不能因为用户的旧仓库 URL 带凭据就让工作区检查失败。

约束：不改字段结构；不修改 DSH 核心；不声称任意未知秘密检测能力。

## Goals / Non-Goals

**Goals:**
- 展示与错误摘要不携带以 URL/SCP userinfo 形式内嵌的凭据。
- 保留 host/path 等排障信息，不含凭据的输入零改动。

**Non-Goals:**
- 不做任意未知秘密的通用检测（那需要密钥清单；本 change 只处理可结构识别的 userinfo 形式）。
- 不改变绑定入口的「拒绝内嵌凭据」语义（`credentialFreeRemote` 保持拒绝）。
- 不改前端布局或字段名。

## Decisions

### D1：新增纯函数脱敏助手，不改字段结构（共享）

在 `src/redaction.ts` 提供 `redactUrlCredentials(value)`：对 `http(s)://user:pass@host/...` 与 `scp` 形式的 `user:pass@host:path`，把 userinfo（或其中的密码段）替换为 `***`；其余部分保留。纯字符串函数，无 I/O，便于单测与在错误渲染路径复用。

- 备选：复用 `credentialFreeRemote` 抛错。否决——展示路径应以脱敏降级，而非让用户既有仓库导致检查失败。

### D2：`inspectWorkspaceGit` 返回前脱敏输出

在函数内对 `remoteUrl` 应用脱敏后再放入返回对象。保持 `initialized` 等其余字段不变。

### D3：`boundedOutcome` 先脱敏再截断

先对渲染后的字符串应用 URL 脱敏，再按字节截断上限。顺序必须如此，否则截断可能保留凭据前缀。

## Risks / Trade-offs

- [脱敏正则可能漏掉不常见形式] → 覆盖 `http/https` userinfo 与 scp `user:pass@` 两类主流形式；README/spec 明确不作通用秘密检测声明。
- [scp 形式的 `user@host` 被误脱敏] → `git@host:path` 中的 `git` 是用户标识非密钥；仅当 `@` 前含 `:` 分隔的密码段时才脱敏。

## Open Questions

（无。）
