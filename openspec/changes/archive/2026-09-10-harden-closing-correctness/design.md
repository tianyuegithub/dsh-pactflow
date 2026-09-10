## Context

见 proposal.md（Why）。现有实现的关键事实：

- `closeGitNeed`（`src/index.ts`）在合并后调用 `verifyClosingMerged` 取默认分支最新提交，直接写入 `release.commit`。
- `verifyClosingMerged`（`src/git-workspace.ts`）只做两件事：fetch 默认分支、要求 integration 是其祖先；**不检查精确 merge SHA，也不复验其 tree**。
- Gitea 客户端已返回精确 `merge_commit_sha`（`merged.mergeCommit`），但该值当前只用于判定「已合并」，未作为交付身份。
- 投影（`src/domain.ts`）已有强约束：同一 Need 的 `release-recorded` 载荷不得变化，否则抛 `changed after recording`。
- `closeGitNeed` 已有 `priorClosing` 复用路径（输入摘要核对、已合并 PR 复用、集成身份核对），但**阶段推进**部分未复用既有 release。

约束：不修改 DSH 核心；不引入第二份交付数据库；release 的领域枚举不变（仍写 `release-recorded` 事件）。

## Goals / Non-Goals

**Goals:**
- 交付身份锁定 Gitea 报告的精确 merge SHA，并在隔离目录复验该提交的 tree。
- release 与阶段推进之间中断后，重试复用既有 release，不重建、不重复合并。

**Non-Goals:**
- 不引入 finalization 单事件（那会改事件格式；本 change 用「复用既有 release + 补齐阶段」的兼容方案）。
- 不实现更强的跨系统原子事务；不声称「任何未经验证的代码永不进入 main」——只保证「未验证通过就不宣告交付」。
- 不处理默认分支保护规则导致的 `waiting-review/waiting-checks`（属 A04，另议）。

## Decisions

### D1：以 Gitea 的 merge SHA 作为交付身份（F05）

合并返回的 `merged.mergeCommit` 成为唯一交付候选。Host 取回该 SHA，要求 (a) 它是默认分支可达提交，(b) integration 是它的祖先，(c) 在隔离 worktree 中以该提交运行同一套登记验证命令且 tree 不变；通过后才把该 SHA 写入 `release.commit`。默认分支 tip 的祖先关系检查保留为附加证明。

- 备选：继续记录默认分支 tip 但加注释说明。否决——那正是 F05 的缺陷；记录未验证提交会让后续审计绑定错对象。
- 备选：以 integration 提交本身作为交付身份。否决——integration 不是实际落入默认分支的对象（merge 后才产生默认分支上的提交）；且 squash/rebase 下与 merge 树不同。

### D2：复验在独立的受控 worktree 中进行（F05）

不复用 closing worktree（它指向 integration branch 且即将清理）。新建一个 detached 的验证 worktree 指向精确 merge SHA，运行登记命令后清理。验证使用与 closing 相同的 `validationCommands` 与授权核对。

### D3：F06 采用「复用既有 release + 补齐阶段」而不改事件格式

重试时若 `pactflowDelivery.releases[needId]` 已存在：跳过合并与 release 构造，直接以其 `commit`/`recordedAt` 为准，仅执行缺失的阶段推进（若 phase 已是 deployed 则幂等返回）。已合并 PR 继续走既有 `priorPullRequest.merged` 复用路径，不重复 POST merge。

- 备选：新增 `pactflow/release-finalized` 单事件。否决——改事件格式影响官方事件注册与旧数据兼容，成本大于收益；兼容方案已能满足「唯一 release、不重复合并」。

### D4：既有 release 与当前解析不一致时失败关闭（F06）

若既有 release 的 `commit` 与本次在默认分支上复验得到的精确提交不一致，拒绝自动收口，保留显式恢复路径，不静默改写交付事实。

## Risks / Trade-offs

- [复验 merge tree 增加一次检出与命令执行] → 有界；相对「交付身份不可信」，成本可接受。
- [默认分支在复验期间前进] → release 仍绑定自己的 merge SHA；不绑定新 tip。
- [合并后复验失败时默认分支已包含该提交] → 明确失败关闭、不宣告交付、不自动强推回滚；由独立授权操作处理（写入 `outcome-unknown` 语义）。
- [Gitea 未返回 merge SHA] → 已有「did not report a merged commit」失败关闭，保持不变。

## Open Questions

- 复验 worktree 的路径命名与清理时机可沿用既有 `cleanupClosing` 模式，实现阶段确定，不影响 spec 与任务分解。
