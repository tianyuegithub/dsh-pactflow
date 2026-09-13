## Context

真实收口（data-governance，Need `quality-issue-rerun-guide` rev 9）在项目从 SSH 重绑为 HTTPS token 后被 "Git authentication does not match the project binding" 拒绝。定位：`closeGitNeed` 用 `this.resolveGitAuth(taskRuns[0]!.git!)` 解析收口凭据，而 `prepareClosing` 的配对校验是 `(binding.auth === undefined) !== (secret === undefined)`，且收口全部 Git 操作（集成分支推送、`verifyClosingMerged`、`verifyClosingTaskRefs`）都作用于 `binding.remote`。凭据来源与实际作用远端错配。

## Decisions

- 收口凭据唯一来源 = 当前项目绑定：`resolveGitAuth(binding)`；参数类型放宽为 `{ auth?: PactFlowGitAuth }`（`PactFlowGitRunSpec` 与 `PactFlowGitBinding` 均满足）。运行认证声明（run.git.auth）只属于该运行执行时证据，与既有合同（运行认证声明参与派发准入等）无关，全部不动。
- 失败语义保持显式：凭据引用缺失/不可解析沿用 `resolveGitAuth` 既有指名拒绝；`prepareClosing` 的存在性配对校验保留为第二道防线（绑定与 secret 现在必然同源）。
- spec 以 `git-closing-integrity` 新增 Requirement 钉死来源；不改事件、不改生产者版本、不改既有 Scenario。

## Risks / Trade-offs

- 若有人此前依赖"以运行认证收口"的行为（无证据表明存在），其场景本就无法通过当前绑定远端的核验，属同一缺陷的另一表现。
- 多运行 Need 下不同运行的认证声明不一致时，旧代码取首个运行（任意性），新代码与绑定同源——确定性更强。

## Migration Plan

失败优先测试先行（绑定带 token 认证、运行规格无认证的 SSH 时代形态，收口必须继续并以绑定凭据核验），实现后跑全量回归；随后打包部署开发宿主，在真实会话重试 `close_git_need` 验证到受保护 PR 环节。
