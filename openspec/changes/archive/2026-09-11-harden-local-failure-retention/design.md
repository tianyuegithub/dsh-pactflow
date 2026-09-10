## Context

见 proposal.md（Why）。关键事实：

- 本地派发失败结算（`src/host/dispatch.ts` 四处：materialize 失败、子代理启动失败、子代理结果失败、验证失败）此前不登记任何清理责任；K3s 则有 `ensureK3sCleanup`。
- `reconcileCleanupsImpl`（`src/host/cleanup.ts`）会对**所有未成功**记录自动重试删除——因此若把失败现场登记为普通 `pending`，下次会话恢复就会删掉用户可能需要诊断的未提交代码。
- cleanup 记录已有 `state/attempt/error/nextRetryAt`；投影 `cleanupIdentity` 排除这四个可变字段，其余字段（含新增 `retain`）参与身份比对。

## Goals / Non-Goals

**Goals:**
- 失败本地现场可发现、可审计。
- 保留现场不被自动清理删除。

**Non-Goals:**
- 不自动删除任何失败 worktree/分支（明确保留）。
- 不实现「磁盘体积/到期策略」与「保存未提交工作时提示用户」（评审 A05 的进一步建议）。
- 不改 K3s 清理语义。

## Decisions

### D1：新增 `retain` 标记（可选布尔），并让对账跳过它

`PactFlowCleanupRecord.retain?: boolean`。`reconcileCleanupsImpl` 对 `retain === true` 的记录 **continue**，既不重试也不删除。显式清理（`retryCleanup`）仍可处理它。

- 备选：用新 state（如 `retained`）表达。否决——会扩大已冻结的 state 枚举（`pending|failed|succeeded`），且需要迁移；用可选标记更小、更兼容。

### D2：本地失败登记为 retain 责任，id 固定可去重

`retainLocalFailure` 以 `cleanup-<runId>-git-retained` 为 id，目标 `git:<branch>`；已存在即返回，重复结算只产生一条。

### D3：不删除、只登记

登记路径不调用任何删除动作；worktree 与分支保持原样。

## Risks / Trade-offs

- [保留记录永久存在，可能被误认为未清理] → 其 `retain: true` 显式区分「保留待审查」，且可被显式清理。
- [与 K3s 的失败即清理语义不对称] → 故意不对称：K3s Job 是外部临时资源，本地 worktree 可能含未提交代码。已在 spec 记录。
- [保留会占用磁盘] → 已知的取舍，未实现自动到期（记为边界）。

## Open Questions

- 保留期限与体积上限策略留待后续（需用户裁决）。
