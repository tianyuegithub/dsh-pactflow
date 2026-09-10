# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试（先失败） | ✅ | 将 `boundedOutcome` 的预算硬编码为 4096（忽略实例预算）时，`applies the run output budget to a bound outcome` 失败（1 failed / 5 passed）——证明此前预算字段未生效；还原后转绿 |
| 预算接线 | ✅ | `boundedOutcome` 改用 `boundOutputToBudget(redacted, this.runBudget.maxOutputBytes)`，保留「先脱敏后截断」与默认回退 |
| 不放大存量 | ✅ | 默认 `maxOutputBytes` 调为 4096，与长期硬编码截断量一致；`display-redaction` 的「≤4096 且不泄露凭据前缀」断言保持通过 |
| 预算真实生效 | ✅ | 收紧到 128 字节后，输出确实 ≤128 字节且仍带截断标记 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 默认预算下超长输出被有界截断 | `applies the run output budget to a bound outcome`（默认分支：≤`PACTFLOW_DEFAULT_RUN_BUDGET.maxOutputBytes` 且含 `truncated`） |
| 收紧预算实际收紧输出 | 同测试收紧分支（`runBudget.maxOutputBytes=128` → ≤128） |
| 先脱敏后截断（不回归） | `display-redaction.spec.ts` → `redacts an error summary before truncating it` |

## 已知边界（诚实）

- 本 change 只覆盖 A11 中「输出/日志容量上限」这一半，且是**接线修复**（此前预算名义存在但未生效），非新能力。
- A11 其余两项**未做，且判断当前不宜做**：
  - **token/模型调用数用量统计**：Harness 的 termination document 中**没有** token/usage 字段（`k3s-worker.ts` 解析的文档仅含 `harnessVersion` 等；`src/k3s-worker.ts` 内无 usage/token 解析）。要在真实数据上统计，需先扩展 Harness 能力（属上游/新能力），否则只能造无源指标——故不做。
  - **「预算耗尽进入 paused/needs-decision」**：当前以**显式拒绝**表达（`retryNode` 超预算即抛错）。改为一个持久化的 `paused` 状态是**领域状态机变更**（新目标语义），按仓库规则应先确认目标，未擅自改。
- 「输出字节上限」是整段文本的硬上限；未做「分通道子预算」（如 stderr/stdout 分别限额）。

## 验证

`pnpm run check` 通过：61 个测试文件、505 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
