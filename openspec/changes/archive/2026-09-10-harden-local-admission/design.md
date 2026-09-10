## Context

见 proposal.md（Why）。关键事实：

- `dispatchGitNodeWithSignalImpl`（`src/host/dispatch.ts`）：`localExecution → requireProject → binding → assertValidationProfilesCurrent → node/revision → git.plan → claimNodeInSession → materialize → executeClaimed`，全程无 `acquireExecutionOrCancel`。
- K3s 路径（`dispatchK3sNodeWithSignalImpl`）已具备完整的 `run-queued → acquireExecutionOrCancel → 重核 → claim → …` 序列，且 `finally releaseCapacity()`。
- `PactFlowExecutionCapacity.acquire` 的项目/池配额需要 `profileId`/`poolId`；本地派发请求（`DispatchPactFlowGitNodeRequest = DispatchPactFlowLocalNodeRequest`）不含 Agent Profile 概念。

约束：不改请求结构；本地路径不引入 K3s pool；不改变 `dispatchLocalNode`（无非 worktree 的简单工具路径）语义。

## Goals / Non-Goals

**Goals:**
- 本地派发经过同一准入点，尊重恢复屏障与 FIFO。
- 准入后重核取消与版本，失败释放槽位并登记队列取消。

**Non-Goals:**
- 不为本地路径发明 K3s 池或 Agent Profile 配额（本地无 Harness/Profile；是否应计入 workspace 并发属设计决策，见 known-gaps）。
- 不改变 `dispatchLocalNode`（非 Git 的本地执行入口）——它不经 worktree，属另一路径。
- 不改 Remote 合同。

## Decisions

### D1：镜像 K3s 的准入序列（不做抽象合并）

在 `dispatchGitNodeWithSignalImpl` 内按 K3s 同样顺序接入：登记 `run-queued` → `acquireExecutionOrCancel` → 重核（`assertValidationProfilesCurrent`、workspace 快照、node/project 修订、signal）→ `git.plan` → claim → materialize → executeClaimed；`finally` 释放。

- 备选：抽取「统一派发骨架」供两条路径共用。否决——本 change 只补齐缺失入口，避免在同一改动里做大重构；骨架化属后续结构演进（A3/J9 范畴）。

### D2：本地传入 undefined 的 profileId/poolId（如实反映语义）

本地路径无 Agent Profile 与池，故对准入器传 `undefined`。效果：本地派发受**准入点约束**（屏障、FIFO、取消），但不消耗 Profile/池槽位。此为如实语义，且是本 change 需要显式记录的边界。

### D3：重核失败登记队列取消事件

与 K3s 一致：`pactflow/run-queue-cancelled` 记录原因；保证「被拒绝的派发」在事件层可观测。

## Risks / Trade-offs

- [本地派发多一次排队，可能轻微延后开始] → 与 K3s 一致；屏障期的阻塞是期望行为。
- [本地不消耗槽位可能被视为不完整统一] → 本地无 Profile 语义；发明配额属设计变更，记入 known-gaps 待裁决，不在本 change 擅自设定。
- [既有本地派发测试可能假设无排队事件] → `pnpm run check` 覆盖；已确认既有本地用例通过。

## Open Questions

- 本地派发是否应计入 workspace 级并发（例如按 workspace 计一个「本地执行」额度）——留待设计裁决。
