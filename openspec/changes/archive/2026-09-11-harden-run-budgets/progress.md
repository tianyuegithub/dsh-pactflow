# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/run-budgets.spec.ts` 先因模块不存在失败 |
| 纯模块 `run-budget.ts` | ✅ | `evaluateAttemptBudget` / `boundOutputToBudget` / `PACTFLOW_DEFAULT_RUN_BUDGET` |
| `retryNode` 强制执行 | ✅ | 重试前评估尝试预算，超预算拒绝并给出 `attempt N exceeds the budget of M attempts` |
| fail-first（强制路径） | ✅ | 临时把预算抬高后，`refuses to retry…` 用例**重试被允许**（证实预算确实生效）；恢复后转绿 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 预算内的重试被允许 | `admits an attempt within the budget` |
| 超出预算的重试被拒绝并说明原因 | `rejects an attempt beyond the budget with an explicit reason` + `refuses to retry a node beyond its attempt budget` |
| 预算内文本原样保留 | `bounds output and records that the budget was hit`（短文本分支） |
| 超预算文本被有界截断且可见 | 同上（长文本分支：长度≤预算、含 `truncated`、记录 originalBytes） |

## 已知边界（诚实）

- 本 change 只落地**尝试次数**与**输出字节**两个预算。评审 A11 还建议 wall-clock 预算、模型调用数/token 用量、日志容量与「预算耗尽进入 paused/needs-decision 而非静默降级」：
  - wall-clock 已由 A02 的 `jobMaxWallClockSeconds`（K3s Job 墙钟）覆盖一部分；
  - 模型调用数/token 用量未实现（需从 Harness 结果解析用量，属后续）；
  - 「预算耗尽进入 paused 状态」未实现——当前以**显式拒绝 retryNode** 表达，不改 Need 阶段枚举。
- 输出预算模块已就位并单测，但**尚未替换** K3s 探针内部既有的 `bounded(...)`（其行为等价，替换属内部整理，未纳入本 change 以避免大范围改动）。

## 验证

`pnpm run check` 通过：54 个测试文件、473 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
