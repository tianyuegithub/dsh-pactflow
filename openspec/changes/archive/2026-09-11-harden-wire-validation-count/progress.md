# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 归类更正 | ✅ | 复核 `validation-integrity-signals` 合同，「零自动验证必须可识别」含「Host SHALL 能报告…执行数量 / 可查询到执行数量为零」——属**既有合同未接线**，而非「新能力待裁决」；A03 提案中的归类已在 change 内更正 |
| 死代码确认 | ✅ | `validationExecutedCount` 零生产引用（全仓仅定义与单测） |
| 接线 | ✅ | `project-handover.ts` 的 `artifacts[]` 增 `validationsExecuted: validationExecutedCount({ validations: run.gitResult.validations ?? [] })` |
| 类型 | ✅ | `PactFlowHandoverSummary.artifacts[]` 增字段，注释写明「零即没有自动验证」 |
| 测试 | ✅ | `project-handover.spec.ts`：既有 artifacts 断言更新为含 `validationsExecuted: 0`；新增「两条验证 → 2」（共 4 项） |
| 验证 | ✅ | `pnpm run check` 65 文件 / **526** 测试；`pnpm run typecheck` 通过 |

## 为什么这是「接线」而不是「等裁决」

两者易混，判定标准是**合同是否已要求**：
- `harnessCapabilityProfile`：合同场景要求「查询任一受支持 Harness 的能力声明」→ 接线；
- `retentionRemainingMs`：无任何合同要求 → 删除；
- 本项 `validationExecutedCount`：合同明确要求「能报告执行数量、零可识别」→ **接线**。

A03 提案把它列为待裁决项是**过度保守**：合同已要求该能力，缺的只是出口。已在提案与 change 中同步更正。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 零验证在移交摘要中可识别 | `summarises project, stage and unresolved responsibilities read-only`（`validationsExecuted: 0`） |
| 有验证时计数与实现数量一致 | `reports the executed validation count per delivered artifact`（两条 → 2） |
| 计数来自真实验证证据而非自报 | 实现直接取证据集合长度（`validationExecutedCount`），无自报路径 |

## 已知边界（诚实）

- 该字段进入**移交摘要**（`projectHandover` Remote，只读）。**前端 UI 未做**明示「无自动验证」的视觉标记——那属 A12/A03 的 UI 部分，未在本 change。
- 计数为「成功产出的验证证据条数」，不区分各条命令类型；且仅覆盖 `gitResult.validations`（本地/K3s Git 交付路径的登记验证），未统计其它非登记验证。
- 未改动 `validationExecutedCount` 自身语义（仍是长度），只为其增加出口。

## 验证

`pnpm run check` 通过：65 个测试文件、526 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
