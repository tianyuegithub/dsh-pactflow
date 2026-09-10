# 实施进度

## F05 精确交付提交

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 失败测试 | ✅ | `tests/closing.spec.ts` 新增 `main-advances` 模式：合并后默认分支前进。先失败（`need.phase` 未达 deployed，因 release 绑定默认 tip） |
| 1.3 精确提交复验 | ✅ | `git-workspace.verifyClosingMerged` 现要求 provider 报告的 merge SHA，校验 integration 为其祖先、它在默认分支可达；新增 `revalidateMergeCommit`（隔离 detached worktree 检出精确提交、运行登记命令、tree 不变后清理） |
| 1.4 记录精确 SHA | ✅ | `closeGitNeed` 记录复验通过的精确 merge SHA |
| 1.5 正常对照 | ✅ | 既有 9 项 closing 用例继续通过 |

## F06 收口幂等恢复

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 2.1 失败测试 | ✅ | 新增 `phase-interrupt-retry` 模式：注入 phase-transitioned 失败。先失败（根因 `PactFlow release for Need "need" changed after recording`） |
| 2.2 不重复合并 | ✅ | 断言重试后 `mergeCalls === 1` |
| 2.3 复用既有 release | ✅ | `closeGitNeed` 检测既有 release 则原样复用，仅补齐阶段推进 |
| 2.4 不一致失败关闭 | ✅ | 既有 release 与复验提交不一致时抛 `recorded release does not match the verified merge commit` |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 精确合并提交通过复验后记录该 SHA | `phase-interrupt-retry`（release.commit === mergeCommit）与 `main-advances` |
| 合并后默认分支前进不改变本次交付 | `main-advances` |
| 精确合并提交未通过复验时拒绝完成 | `revalidateMergeCommit` 在验证失败时抛错（隔离测试中由登记命令失败路径覆盖） |
| 集成提交必须是精确合并提交的祖先 | `verifyClosingMerged` 的 `merge-base --is-ancestor integration mergeCommit` 检查 |
| 已记录 release 时重试复用原记录 | `phase-interrupt-retry` |
| 重试不重建 recordedAt | `phase-interrupt-retry`（断言单条 release 事件且 recordedAt 相等） |
| 已合并的拉取请求不重复合并 | `phase-interrupt-retry`（mergeCalls 不增） |
| 既有 release 与当前集成分歧时失败关闭 | 源码 `recorded release does not match` 分支 |

## 已知未覆盖

- 真实 Gitea 的精确 merge SHA 行为由 `test:real-gitea` 覆盖（已在前一 change 运行通过）；本 change 未重跑真实环境（改动限于 closing 复验与幂等，属 A 类可在隔离层验证）。
- 合并后复验失败时默认分支已含该提交的「已合并但未宣告交付」状态：本 change 通过失败关闭 + `known` 语义处理，未实现独立的 `merged-validation-failed` 持久状态（属后续增强）。

## 当前验证

`pnpm run check` 通过：39 个测试文件、404 项测试、13 项包产物；`git diff --check` 通过。
