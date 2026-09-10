# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/retention-policy.spec.ts` 先因模块不存在失败 |
| 纯模块 `retention-policy.ts` | ✅ | `retentionRemainingMs` / `isRetentionOverdue`（仅保留记录且有窗口）/ `summarizeRetainedScenes` / 默认 14 天 |
| 登记保留窗口 | ✅ | `retainLocalFailure` 写入 `retainUntil = now + 默认窗口` |
| 投影可变字段 | ✅ | `retainUntil` 加入 `cleanupIdentity` 排除集，不参与资源身份比对 |
| 只读 Remote | ✅ | `retentionStatus(sessionId)` 返回总数与超期清单，不删除 |

## 过程修正

初版函数命名 `retentionAgeMs` 与其「剩余窗口」语义不符，被自己的测试暴露（`expected 0 to be 86400000`）；改名为 `retentionRemainingMs` 并修正断言，语义与命名对齐。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 窗口内未超期 | `marks a retained scene overdue only past its retention window`（前半） |
| 超过窗口为超期 | 同上（后半） |
| 非保留记录永不超期 | `never treats a non-retained record as overdue` |
| 只读列出超期现场 | `summarises retained scenes, listing only overdue ones separately` |
| 查询不删除现场 | 端到端用例（查询后记录仍在、`retainUntil` 仍为未来） |
| 新登记保留现场未被判超期 | `records a retention window on the retained scene and reports it read-only` |

## 已知边界（诚实）

- 本 change 只做「窗口 + 陈旧标记 + 只读查询」；**未实现自动到期清理**（与 A05「不 force 删除」一致），也未新增 UI 入口。
- 窗口为固定默认 14 天，未提供按项目/用户配置的窗口。
- 未统计保留现场占用的磁盘体积（A05 建议的 volume 上限未做）。

## 验证

`pnpm run check` 通过：61 个测试文件、499 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
