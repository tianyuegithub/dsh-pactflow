## Why

真实 B 类 dogfood（一个真实小网页项目上的**两节点依赖链**）暴露一个真实缺陷：`dependency-code-inputs` 的合同要求「代码输入依赖的成功提交成为后序任务的执行基线」，但该行为**只在本地 Git 派发路径实现**，**K3s 远端路径从未实现**。

具体：远端容器只 `git checkout "$BASE_COMMIT"`，从不取回/合并声明的代码输入；而本地工作树又被 `materialize` 折入代码输入。结果是后序远端任务**看不到前序成果**（真实运行中 `node test-todo-smoke.js` 因文件缺失而 exit 1），且即便容器拿到了提交，本地工作树也**无法 fast-forward**（其实例化 `acceptRemoteResult` 只做 `merge --ff-only`）。本 change 修复这条真实断链。

## What Changes

- `src/k3s-worker.ts`：
  - `WORKER_SCRIPT` 从 input Secret 的 `spec.json` 读取 `codeInputs`，在**容器内**按**精确提交** `git fetch --no-tags origin <commit>` 后 `git merge --no-ff --no-edit <commit>`；任一步失败即失败关闭（不静默忽略）。折叠后记录 `BASELINE_COMMIT`，Worker 自身改动以折叠后的基线衡量（折叠本身不算交付）。
  - `inputSecret` 的 `spec.json` 增 `codeInputs`（仅精确提交）；`pactFlowK3sSpecDigest` 纳入 `codeInputs`，使「换基线」无法通过结果校验。
- `src/git-workspace.ts`：`materialize` 增 `options.foldCodeInputs`；本地路径默认折入（行为不变），远端路径由 Host 传 `false`。
- `src/host/dispatch.ts`：K3s 派发的 `materialize` 传 `{ foldCodeInputs: false }`——容器自折，本地工作树留在 `baseCommit` 上，才能对远端结果做精确 fast-forward。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `dependency-code-inputs`: 补充「远端（K3s）执行路径同样必须折入代码输入，且以精确提交表达、冲突/缺失失败关闭」的合同与场景。

## Impact

- **Host**：`src/k3s-worker.ts`（worker 脚本、input Secret、spec digest）、`src/git-workspace.ts`（`materialize` 选项）、`src/host/dispatch.ts`（K3s 派发接线）。
- **测试**：`tests/k3s-worker.spec.ts` 新增「K3s 基线折入代码输入」用例（spec.json 带精确提交、脚本含折叠与基线测量、digest 随 codeInputs 变化）；新增真实多节点 dogfood 套件 `e2e/pactflow-real-todo-webapp.e2e.spec.ts`（已通过）。
- **兼容**：本地路径行为不变；远端路径由「不支持」变为「支持」，`pnpm run check` 全绿。
