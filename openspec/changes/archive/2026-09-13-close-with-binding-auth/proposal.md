## Why

真实收口被拒："Git authentication does not match the project binding"。根因是宿主缺陷：`closeGitNeed` 用 `taskRuns[0].git`（首个交付运行的 Git 规格）解析收口 Git 凭据，而收口的集成推送与全部核验都发生在**当前项目绑定**的远端上。当项目在 Need 生命周期内重绑（如 SSH → HTTPS token，同一仓库），旧运行规格的认证与现绑定必然不一致，收口被永久阻断且无所有者对齐入口；取"任意首个运行"作为凭据来源在多运行 Need 下也不成立。

## What Changes

- `closeGitNeed` 的收口 Git 认证改为从**当前项目绑定**解析（与 `prepareClosing`/`verifyClosingMerged`/`verifyClosingTaskRefs` 使用 `binding` 的语义一致）；交付运行的认证声明保持为其自身执行时的历史证据，不再作为收口凭据来源。
- spec `git-closing-integrity` 新增一条 Requirement 钉死该来源；既有收口完整性校验（交付主题摘要、任务引用核验、精确合并复验）全部不变。
- 非目标：不改绑定迁移的记录方式、不放宽"运行认证与绑定不一致时清理失败现场"的既有拒绝、不改 SSH/HTTPS 远端合同。

## Capabilities

### Modified Capabilities
- `git-closing-integrity`：新增"收口必须以当前项目绑定解析 Git 认证"Requirement。

## Impact

Host（`closeGitNeed` 凭据解析）；既有拒绝语义（清理对绑定漂移的拒绝、交付主题绑定、受保护分支审批门禁）全部保持。真实验收：data-governance 会话在 HTTPS 重绑后以 SSH 时代运行收口成功。
