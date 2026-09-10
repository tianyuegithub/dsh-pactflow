## Why

GPT 评审附录 A05 指出：本地 Git 派发在 materialize 或 Worker/验证失败时直接结算失败，**没有像 K3s 那样为失败的本地 worktree / 分支登记清理责任**。后果：

- 失败留下的任务分支与 worktree 成为**沉默残留**：既不可发现、也不可重试清理；
- 但也不应一律删除——未提交的代码可能对诊断有恢复价值。

## What Changes

- 本地 Git 派发在失败结算时，为该 Run 的任务分支登记一条**清理责任**（复用既有 cleanup ledger 语义，`target: git:<branch>`），状态为 `pending`，使失败残留可发现、可审计、可重试清理。
- 保留策略明确：**保留**失败现场（不自动删除 worktree/分支），由既有清理路径在显式处理时删除；登记责任本身不删除任何内容。

## Capabilities

### New Capabilities
- `local-failure-retention`: 本地执行失败后在磁盘上留下的任务分支与 worktree 必须形成可发现、可审计、可重试的清理责任，而不是沉默残留；保留现场是默认，删除只在显式清理时发生。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/host/dispatch.ts`（本地失败结算路径登记清理责任）、`src/index.ts`（暴露登记入口）。
- **测试**：扩展 `tests/git-cleanup.spec.ts` 或新增本地失败保留用例：失败后存在 pending 清理记录、未自动删除 worktree。
- **兼容**：新增登记不删除任何内容；既有清理路径与门禁不变。
