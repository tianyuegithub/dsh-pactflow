# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 真实复现（先失败） | ✅ | 真实集群两节点链：B 报 `PactFlow validation command failed (node, exit 1)`，B 的 worktree 文件列表**无** `todo.html`/`test-todo-smoke.js`（前序成果缺失）；仅声明 `dependencies` 时同样缺前序文件 |
| 单元测试 | ✅ | `tests/k3s-worker.spec.ts` → `folds declared predecessor code inputs into the K3s baseline (F03)`：spec.json `codeInputs=[{commit}]`、脚本含 `merge --no-ff --no-edit "$CODE_INPUT"` 与 `BASELINE_COMMIT` 比较、digest 随 codeInputs 变化 |
| 容器内折叠 | ✅ | `WORKER_SCRIPT`：读 `/tmp/code-inputs.txt` → `fetch --no-tags origin <commit>` → `merge --no-ff --no-edit <commit>`，失败 `exit 1`；`BASELINE_COMMIT` 用于判定「Worker 自身是否有改动」 |
| 规格摘要绑定 | ✅ | `pactFlowK3sSpecDigest` 纳入 `codeInputs`，换基线即摘要不符被拒 |
| 本地不折入 | ✅ | K3s 派发 `materialize(..., { foldCodeInputs: false })`，本地工作树留在 `baseCommit`，可对远端结果精确 `--ff-only` |
| 真实复跑 | ✅ | 同一真实集群两节点链**通过**：B outcome 为 `committed <sha>`；B 文件列表含 `todo.html`+`test-todo-smoke.js`；`validations=[{command:node,args:[test-todo-smoke.js],exitCode:0}]`；浏览器驱动通过 |

## 根因（真实证据）

- `WORKER_SCRIPT` 原为 `git clone` → `checkout -b "$BRANCH" "$BASE_COMMIT"`，**无任何代码输入折叠**（`src/k3s-worker.ts` 内 `codeInputs` 出现 0 次）。
- `pactFlowK3sSpecDigest` 与 input Secret 的 `spec.json` 也未携带 `codeInputs`。
- 首次修复尝试（仅声明 `codeInputs`）反而更清楚地暴露断链：容器未折入 → 宿主端本地工作树已折入（旧 `materialize` 无选项）→ 远端返回提交无法 `--ff-only`，报 `PactFlow Git command failed: merge`。这证明**两端都错**，必须在容器内折入、并在本地抑制折入。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 远端后序任务看到前序成果 | 真实 dogfood 两节点链 `builds and documents a working todo page through a real two-node K3s chain`（真实集群） |
| 代码输入不可获取或冲突时失败关闭 | `WORKER_SCRIPT` 的 `fetch`/`merge` 失败 `exit 1` 分支（脚本级；未在真实集群单独构造 fetch/conflict 失败） |
| 折叠本身不算交付 | 脚本以 `BASELINE_COMMIT`（折叠后）比较 `CURRENT_COMMIT` |
| 换基线无法通过结果校验 | `tests/k3s-worker.spec.ts` digest 差异断言 |

## 已知边界（诚实）

- 未在**真实集群**单独构造「代码输入 commit 不可获取」与「合并冲突」两种失败，故这两个场景目前只有脚本级/单元级证据（失败关闭逻辑存在但未被真实故障触发）。
- 容器内折叠使用 `--no-ff` 合并提交；若前序与后序改动同一文件，会按 Git 语义冲突并失败关闭，未做自动 rebase/择优。
- 该缺陷此前未被发现，因为 `dependency-code-inputs` 的端到端测试与收口测试都在**本地 Git 路径**上；真实集群的两节点链此前从未运行（原 change 已诚实记录「真实集群下的依赖链任务矩阵未运行」）。本 change 即由该真实 dogfood 发现。

## 验证

`pnpm run check` 通过：61 个测试文件、507 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
