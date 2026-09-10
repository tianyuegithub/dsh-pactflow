## Why

A05 已实现「本地失败现场保留、绝不自动删除」，但保留可能变成**无界沉默残留**：没有期限、没有「是否已陈旧」的判定。用户的未提交工作应保留，也应能被发现并适时清理——需要「有界保留窗口 + 陈旧标记」，而**不是**自动删除。

## What Changes

- 新增纯模块 `src/retention-policy.ts`：`PACTFLOW_DEFAULT_RETENTION_MS`（14 天）、`retentionRemainingMs`、`isRetentionOverdue`（仅限保留记录、且有窗口）、`summarizeRetainedScenes`（总数 + 超期清单，确定性排序）。
- 清理记录新增可选 `retainUntil`（保留窗口到期时间），并由 `retainLocalFailure` 在登记保留现场时写入默认窗口。
- `retainUntil` 纳入投影的「可变字段」排除集（与 `state/attempt/error/nextRetryAt` 同类），不参与资源身份比对。
- 新增只读 Remote `retentionStatus(sessionId)`：返回保留现场总数与**超期**清单；**只报告、不删除**。

## Capabilities

### New Capabilities
- `failure-scene-retention-policy`: 保留的失败现场必须有有界保留窗口与陈旧标记；超期必须可被只读查询发现；该查询 MUST NOT 删除任何内容。

### Modified Capabilities
（无独立 delta；该能力细化 `local-failure-retention` 的保留语义。）

## Impact

- **Host**：新增 `src/retention-policy.ts`；`CleanupRecord.retainUntil?`（类型 + schema）；`retainLocalFailure` 写入窗口；`domain.ts` 排除集补充；只读 Remote `retentionStatus`；`tsconfig.host.json`。
- **测试**：`tests/retention-policy.spec.ts`（5 项纯函数 + 1 项端到端登记与只读查询）。
- **兼容**：字段可选；既有保留记录无窗口则不判超期、仍不自动删除。
