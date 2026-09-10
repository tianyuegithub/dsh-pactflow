## Context

见 proposal.md（Why）。关键事实：

- `plan()`（`src/git-workspace.ts`）恒取 `refs/remotes/<remote>/<defaultBranch>` 为 baseCommit；`materialize()` 以该 baseCommit 建 worktree。
- `PactFlowNode` 只有 `dependencies`（顺序），无输入类型区分。
- `verifyTaskSet`（原实现）用 `rev-list --first-parent --parents` 要求「每步一个双父合并、taskParent 属预期集合、无额外父」，并假定 chain 到 baseCommit —— 依赖链会破坏该假定。
- `closeGitNeed` 的 `prepareClosing` 对每个任务分支逐一 `git merge --no-ff` 进集成分支；依赖链下后序分支已含前序提交，产生「祖先包含」而非「独立合并」。

约束：不改 Remote 合同结构（新增可选字段）；未声明 codeInputs 时行为完全不变。

## Goals / Non-Goals

**Goals:**
- 让依赖可表达「成果输入」，并让后序任务真正拿到前序代码。
- 收口不变量从「独立合并集合」升级为「依赖闭包」，且不放宽拒绝力。

**Non-Goals:**
- 不实现 `order-only` / `artifact-input` 的全套类型学（本 change 只加 `codeInputs`，其余仍由 `dependencies` 表达为纯顺序）。
- 不自动把前序成果广播给所有依赖（只有显式声明才注入）。
- 不改 DAG 就绪规则（决策 1B 不变）。

## Decisions

### D1：`codeInputs` 必须是 `dependencies` 的子集

复用既有依赖校验（存在性、同需求、无环），额外要求 codeInput 也是依赖。这样不会产生「新边」，只细化输入语义。

### D2：注入精确提交（不做分支合并）

`codeInputCommits` 取该依赖**最新 succeeded Run 的 `gitResult.commit`**；`plan` 记录 `{ branch, commit }`；`materialize` 按精确提交 `fetch` + `merge --no-ff`。用提交而非分支，避免等待期间分支漂移。

### D3：`verifyTaskSet` 改为依赖闭包不变量

- 每个预期提交必须是集成提交祖先（直接证明「已验证成果在交付中」）。
- 计算 base 的祖先集合，禁止其出现在 `base..integration`（它们不应作为新增提交出现）。
- `allowed` = 各预期提交祖先闭包中**不在 base 祖先**的提交 ∪ 首父链上的合并提交；`base..integration` 的每个提交必须 ∈ allowed。
- 首父链上 `base..integration` 的每个提交必须是合并（有额外父），且每个额外父必须是预期提交。
- 由 `tests/task-set-authorization.spec.ts` 对抗性验证：拒绝未授权提交、接受依赖链与独立多任务。

- 备选：按依赖闭包或「每任务独立合并」二选一。否决——必须两者兼容，且不能用「放宽为祖先包含」牺牲拒绝力。

## Risks / Trade-offs

- [前置提交进入后序历史后被误判为额外提交] → 用祖先闭包（allowed 集合）而不是 first-parent 逐步匹配。
- [不变量改写削弱拒绝力] → 专门写对抗性测试证明未授权提交仍被拒；既有 `git-task-set.spec.ts` 负例继续通过。
- [前序重跑产生新提交，后序旧输入过期] → 未在本 change 处理（属评审建议的「A 重跑后 B 输入过期」增强，记入 known-gaps）。
- [合并冲突] → `materialize` 在冲突时失败关闭并给出原因（下游更早暴露冲突）。

## Open Questions

- 是否在 `codeInputs` 基础上引入 artifact/evidence 输入类型——留待后续。
