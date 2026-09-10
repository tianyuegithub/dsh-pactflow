# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 保留责任登记 | ✅ | `PactFlowCleanupRecord.retain?`；`retainLocalFailure` 以固定 id 登记 `git:<branch>` 责任；本地四处失败结算（materialize/启动/结果/验证）均调用；去重 |
| 对账跳过保留记录 | ✅ | `reconcileCleanupsImpl` 对 `retain === true` 直接 continue（不重试、不删除） |
| 断言（集成） | ✅ | `tests/local-failure-retention.spec.ts`：失败后 worktree 仍在磁盘、存在 retain 责任、重结算不重复 |
| 断言（确定性守卫） | ✅ | `tests/cleanup-retention-guard.spec.ts`：retain 记录 `retryCleanup` 不被调用；普通 pending 记录仍被对账 |

## Review 发现并修正（重要）

**初版测试是弱验证**：集成用例只断言「对账后记录不是 succeeded」，而禁用保留守卫后测试**仍通过**——因为清理尝试会失败（缺 commit）而非成功，真实清理约束掩盖了断言。修正做法：
1. 新增**确定性守卫测试** `cleanup-retention-guard.spec.ts`，用替身 host 直接断言 `retryCleanup` 对 retain 记录**零调用**、对普通 pending 记录**有调用**；
2. 集成用例改为断言「保留记录仍按 retain 标记可发现且 worktree 仍在」。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 失败后留下可发现的清理责任 | `records a retained, discoverable responsibility…` |
| 登记不删除失败现场 | 同上（`access(worktree)` 成功） |
| 重复结算不产生重复责任 | `does not create a duplicate retained record…` |
| 恢复对账不删除保留记录 | `cleanup-retention-guard.spec.ts`（retryCleanup 零调用） |
| 显式清理仍可处理保留记录 | `retryCleanup` 不因 retain 被拒绝（守卫只作用于自动对账；源码路径） |

## 已知边界（诚实）

- **未实现保留期限/磁盘体积策略**与「保留未提交工作时的用户提示」（评审 A05 的进一步建议）；保留记录会长期存在。
- 与 K3s 的语义**故意不对称**：K3s 失败即清理外部临时资源；本地失败保留可能含未提交代码的 worktree。
- 保留记录的清理需要显式操作；UI 未新增展示入口。

## 验证

`pnpm run check` 通过：53 个测试文件、468 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
