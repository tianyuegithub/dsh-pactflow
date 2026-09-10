# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现 | ✅ | 穷尽扫描 `scripts/**`：`validateAcceptanceEvidenceFile` 导出但零消费者；`evidence-collect.mjs:16-20` 与 `acceptance-gate.mjs:49-51` 各自内联 `JSON.parse(readFileSync) + validateAcceptanceEvidence` |
| 误报排除 | ✅ | `ACCEPTANCE_EVIDENCE_VERDICTS`/`CONCLUSIONS` 在 `validateAcceptanceEvidence` 内部使用（第 43/50 行），非死代码 |
| 收敛 | ✅ | 两处调用点均改为 `validateAcceptanceEvidenceFile(path)`；该动作由三份实现收敛为一份 |
| 静态核查 | ✅ | `node --check` 五个脚本全过；确认 `scripts/*.mjs` 内已无 `validateAcceptanceEvidence(` 直接调用点（除其自身定义与死导出内部） |
| 验证 | ✅ | `pnpm run check` 63 文件 / 519 测试全绿 |

## 为什么这批「死代码/重复实现」值得逐个清

本会话已处置 5 处同类（`retentionRemainingMs` 删除、`harnessCapabilityProfile` 接线、`impact-list.schema.mjs` 接线、`evidence-schema` 三导出核查、本项收敛）。共同风险是：**代码声称某动作存在（或存在多种做法），而实际只有一种做法在跑，另一份是死的**——测试覆盖的是那个可能永远不会执行的分支，于是「绿」不代表所声称的行为被验证。逐处清理使「通过」与「行为」重新对齐。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 采集与门禁复用同一路径 | `tests/acceptance-gate.spec.ts`（5 项通过真实 `evidence.json` 文件走 `collectForGate` → `validateAcceptanceEvidenceFile`） |
| 内联复制被消除 | 静态核查（`grep` 确认无内联复制）；无断言守护 |
| 校验语义不因合并而改变 | `acceptance-gate.spec.ts` 的未知结论/缺 target/失败 verdict 用例 |

## 已知边界（诚实）

- 「内联复制被消除」由静态核查确认，**无测试守护**（要守护需引入源码级 lint，属工具链改动）。
- 本项是**等价重构**，不改变行为；因此测试数不变（519），既有用例通过即证明语义未变。
- `validateAcceptanceEvidence`（非 File 版）仍导出且被 `evidence-collect` 之外使用；它不是死代码。

## 验证

`pnpm run check` 通过：63 个测试文件、519 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
