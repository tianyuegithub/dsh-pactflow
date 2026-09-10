## Why

GPT 全面评审 FULL:F03（复现 R11）指出：DAG 只控制执行**顺序**，不决定**成果输入**。`plan()` 无论节点依赖什么，都把 baseCommit 取为默认分支 tip；前序任务的成功提交只在收口时统一集成。因此：

- 依赖 A 的 B 节点启动时，B 的 worktree 是**旧 main**，看不到 A 刚提交的代码——「A 建接口、B 调接口」这类真实依赖无法成立。
- 评审同时警告：一旦前序成果进入后序历史，「每个任务从 main 独立分叉、恰好一个 merge parent」的收口任务集合核验假定被打破，**必须与收口联合修正**。

## What Changes

- 节点新增 `codeInputs`（必须是已声明依赖的子集）：声明「这些依赖的成功提交要成为我的执行基线」。
- `plan()` 把各 code-input 依赖的**精确成功提交**（该节点最新成功 Run 的 commit）纳入 Run 规范；`materialize()` 在工作树中按精确提交取回并合并，Worker 在**包含前序成果**的基线上施工。
- 收口任务集合核验从「每任务一个独立合并」改为**依赖闭包**不变量：每个预期提交必须是集成提交的祖先；引入的提交必须落在预期提交的祖先闭包（或首父合并提交）内；首父合并的额外父必须是预期提交。这样既接受依赖链，又继续拒绝任何未授权提交。

## Capabilities

### New Capabilities
- `dependency-code-inputs`: 依赖可声明为代码输入，其精确成功提交必须成为后序任务的不可变执行基线；集成任务集合核验必须按依赖闭包判定——接受「后序历史已含前序成果」的合法依赖链，同时继续拒绝任何未授权提交。该能力扩展既有 `git-closing-integrity` 的任务集合规则。

### Modified Capabilities
（无独立 delta；对 `git-closing-integrity` 的任务集合规则扩展并入本 change 的新能力 spec。）

## Impact

- **领域层**：`PactFlowNode.codeInputs?`、`CreatePactFlowNodeRequest.codeInputs?`、`PactFlowGitRunSpec.codeInputs?`（含 schema）。
- **Host**：`src/index.ts`（`createNode` 校验 code-input 子集、`codeInputCommits`）；`src/host/dispatch.ts`（plan 传入）；`src/git-workspace.ts`（`plan`/`materialize`/`verifyTaskSet`）。
- **测试**：`tests/dependency-input.spec.ts`（端到端可编译依赖）、`tests/task-set-authorization.spec.ts`（对抗性：拒绝未授权提交 + 接受依赖链）、`tests/closing.spec.ts` 新增 `code-input-chain`。
- **兼容**：`codeInputs` 可选，未声明则行为不变（仍从默认分支基线起）。
