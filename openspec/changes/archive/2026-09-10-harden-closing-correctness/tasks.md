## 1. F05 精确交付提交

- [x] 1.1 先写失败测试：真实临时 Git + 本地 Gitea 替身，合并后让默认分支前进一个新提交（破坏后续验证），断言 `release.commit` 不等于默认分支 tip 且等于精确 merge SHA；验证：先失败（`main-advances`，根因 `need.phase` 未达 deployed）后通过
- [x] 1.2 先写失败测试：精确 merge 提交未通过登记验证命令时，断言拒绝写入 release 且阶段不推进；验证：由 1.3 的 `revalidateMergeCommit` 失败关闭覆盖（见 §3.3 映射）
- [x] 1.3 实现 `git-workspace` 的精确提交复验（取回 merge SHA、隔离 worktree 检出、运行登记命令、tree 不变、integration 为祖先、默认分支可达）；验证：1.1 转绿，`verifyClosingMerged` 缺 mergeCommit 时抛错
- [x] 1.4 `closeGitNeed` 改为记录复验通过的精确 merge SHA；验证：`main-advances` 中 `release.commit === mergeCommit` 且默认分支已前进
- [x] 1.5 补正常对照：精确提交验证通过时交付成功、清理与祖先检查不变；验证：既有 9 项 closing 用例继续通过

## 2. F06 收口幂等恢复

- [x] 2.1 先写失败测试：release 已落账、阶段仍 closing（模拟两事件间中断），断言重试复用原 `recordedAt`/`commit`、不报 `changed after recording`、推进到 deployed；验证：先失败（根因 `release … changed after recording`）后通过
- [x] 2.2 先写失败测试：重试期间 `mergeCalls` 不增加（已合并 PR 不重复合并）；验证：与 2.1 同批通过
- [x] 2.3 实现重试复用既有 release 并补齐缺失阶段；验证：2.1/2.2 转绿
- [x] 2.4 实现既有 release 与当前精确提交不一致时失败关闭；验证：不一致用例拒绝且不改写 release

## 3. 收口

- [x] 3.1 运行完整 `pnpm run check`、`git diff --check`，验证：全绿（39 文件 / 404 测试 / 13 包产物）
- [x] 3.2 运行 `openspec validate harden-closing-correctness --strict`，验证：通过
- [x] 3.3 记录 spec 场景到测试的映射与本 change 已知未覆盖项
