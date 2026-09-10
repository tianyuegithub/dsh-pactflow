## 1. 脱敏助手

- [x] 1.1 先写失败测试：`redactUrlCredentials` 对 `https://user:secret@host/path`、`http://user:secret@host` 与 scp `user:secret@host:path` 移除密钥段且保留 host/path；对无凭据 URL 与 `git@host:path` 原样返回
- [x] 1.2 实现 `src/redaction.ts` 的 `redactUrlCredentials`（纯函数）；验证：1.1 转绿

## 2. 工作区状态脱敏

- [x] 2.1 先写失败测试：`inspectWorkspaceGit` 对带内嵌凭据的 origin，断言返回对象不含凭据且保留 host/path
- [x] 2.2 在 `inspectWorkspaceGit` 返回前应用脱敏；验证：2.1 转绿，无凭据用例输出不变

## 3. 错误摘要脱敏

- [x] 3.1 先写失败测试：`boundedOutcome` 对含内嵌凭据的错误消息断言不含凭据；超长消息断言截断后不残留凭据前缀
- [x] 3.2 在 `boundedOutcome` 截断前应用脱敏；验证：3.1 转绿，不含凭据消息除长度外不变

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`git diff --check`，验证：全绿
- [x] 4.2 运行 `openspec validate harden-display-redaction --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射
