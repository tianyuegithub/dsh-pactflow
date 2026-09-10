# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 脱敏助手失败测试 | ✅ | `tests/display-redaction.spec.ts`：http userinfo、scp 密码、无凭据原样、消息内嵌 URL |
| 1.2 实现 `redactUrlCredentials` | ✅ | 新增 `src/redaction.ts`；http(s) userinfo 全局替换为 `***`，scp `user:pass@` 仅去密码段 |
| 2.1/2.2 工作区状态脱敏 | ✅ | `inspectWorkspaceGit` 返回前脱敏；**先失败**（返回对象实含 `secret-token`）后通过 |
| 3.1/3.2 错误摘要脱敏 | ✅ | `boundedOutcome` 先脱敏再截断；**先失败**（含凭据原文）后通过，超长消息不残留凭据前缀 |

## 过程中发现并修复的真实缺陷

初版助手只对「整串即 URL」的情况脱敏，对**嵌入在错误消息中**的 URL（`clone failed for https://user:token@host/...`）无效——而后者正是 `boundedOutcome` 的真实输入形态。测试先暴露该缺陷（`expected 'clone failed for https://user:secret-…' not to contain 'secret-token'`），改为全局替换内嵌 URL 的 userinfo 后转绿。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| HTTPS 远端中的 token 被替换 | `removes embedded credentials but keeps host and path` |
| 无凭据的远端保持不变 | `leaves credential-free remotes unchanged` |
| 工作区状态不泄露凭据 | `redacts a credential embedded in a checked workspace origin` |
| 错误消息中的内嵌凭据被移除 | `redacts an error summary before truncating it` |
| 超长消息截断不残留凭据前缀 | 同上（8000 字符用例） |
| scp 形式密码被脱敏 | `removes the password from an scp-style remote` |

## 已知边界

- 仅覆盖可结构识别的 userinfo 凭据，**不**声称任意未知秘密检测（与 changelog/spec 声明一致）。
- 绑定入口 `credentialFreeRemote` 仍为「拒绝内嵌凭据」语义，未改（本 change 只处理展示/错误路径）。

## 验证

`pnpm run check` 通过：40 个测试文件、410 项测试、13 项包产物；`git diff --check` 通过。
