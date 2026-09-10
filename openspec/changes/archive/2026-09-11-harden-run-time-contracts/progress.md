# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/run-time-contracts.spec.ts` 先失败：`activeDeadlineSeconds` 为 5（= 租约 5000ms/1000） |
| 解耦实现 | ✅ | `plan()` 改为 `max(60, jobMaxWallClockSeconds ?? 3600)`，不再由 `leaseDurationMs` 推导；`leaseDurationMs` 保留为所有权租约并用注释说明 |
| 既有断言修正 | ✅ | `tests/k3s-worker.spec.ts` 中原「租约 60s → deadline 60」断言改为 3600（该断言固化的正是缺陷行为） |

## Review 发现

修正实现后，既有 `k3s-worker.spec.ts` 的 `activeDeadlineSeconds: 60` 断言失败——它固化了「deadline 随租约」的错误行为。按新合同改为 3600，**不是削弱断言**，而是把断言从缺陷行为改为正确行为。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 短租约不缩短任务墙钟预算 | `does not derive the Job wall-clock deadline from the ownership lease` |
| 显式墙钟预算被采用 | `honours an explicit wall-clock budget independently of the lease` |
| 极小墙钟预算被抬到下限 | `floors an explicit budget so a tiny value cannot kill a task immediately` |

## 已知边界（诚实）

- 本 change 只分离**租约**与**墙钟预算**。A02 还点出「心跳停滞」「API 请求超时」「清理时限」三类合同：API 请求超时已由既有 `withRequestDeadline`（30s）与 `requestTimeoutMs` 覆盖；心跳停滞与清理时限的显式上限未在本 change 引入。
- 墙钟预算默认 3600 秒、下限 60 秒为选定的合理值，未做真实集群的长任务超时验证（属 B 类）。

## 验证

`pnpm run check` 通过：50 个测试文件、459 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
