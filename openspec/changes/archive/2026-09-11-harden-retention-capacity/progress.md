# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 容量汇总（先失败） | ✅ | `sums recorded sizes and flags over-budget only when every scene is measured`；未测量场景下 `measured=false`、`overBudget=false` |
| 有界测量 | ✅ | `measures a directory tree and caps the walk instead of running unbounded`：实测 3000 字节；上限 1500 时 `capped=true`；缺失根返回 0 不抛错 |
| 保留时写入体积 | ✅ | 端到端 `dispatchGitNode` 失败 → 保留记录含 `sizeBytes>0`；`retentionStatus` 报 `measured=true`、`retainedBytes>0`、`overBudget=false`、`maxBytes` 为默认预算 |
| 不在身份中漂移 | ✅ | `sizeBytes` 加入 `cleanupIdentity` 排除集（与 `retainUntil` 同类），保留现场的重复登记不因体积注释变化被判为不同资源 |
| 对抗性验证 | ✅ | 将 `measured` 硬改为 `true` 后，容量测试失败（`1 failed | 9 passed`）；已还原 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 保留时测量现场大小 | 端到端 `records a retention window ...`（`sizeBytes>0`）+ `measures a directory tree ...` |
| 缺失或过大的现场不阻塞失败路径 | `measures a directory tree and caps the walk ...`（缺失根 0；超上限 `capped`） |
| 全部测量时给出真实总量与预算判定 | `sums recorded sizes ...`（measured 分支：`retainedBytes=110`、`overBudget=true`） |
| 存在未测量现场时不谎报完整总量 | 同测试 partial 分支（`measured=false`、`overBudget=false`） |
| 无保留现场 | `reports retainedBytes 0 / measured true when there is nothing retained` |

## 已知边界（诚实）

- 只增量实现 J13 的**容量计量与呈现**；「保留现场在前端的 UI 展示入口」仍未做（属 A12/UI 范围，需浏览器套件）。
- 体积测量为**有界下界**：现场巨大时 `capped=true`，报告的是到达上限时的下界；默认预算 512MB、条目上限 20000。未做「逐文件精确统计」。
- 到期仍**绝不自动删除**；本 change 不引入自动清理。

## 验证

`pnpm run check` 通过：61 个测试文件、504 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
