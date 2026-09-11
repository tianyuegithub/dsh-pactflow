## Why

三项经用户裁决立项（2026-09-11「A03-d + A12-c + A05 UI」），另在接线探查中发现一个**真实缺陷**：

- **A03-d**：`validationSensitiveChanges`（任务改动测试/构建/CI 配置的文件清单）已有计算与写入，但**从未到达评审者的眼睛**——评审批准弹窗只含需求/决定/证据说明，人工评审看不到「本次交付改了验证基础设施」。
- **缺陷（A03-d 的前置）**：`gitResultSchema`（zod）未声明 `validationSensitiveChanges`，事件折叠时该字段被**剥除**——实测 `snapshot().runs.byId[*].gitResult.validationSensitiveChanges` 恒为 `undefined`。既有文档声称「经 snapshot() 可读」不成立（又一例「声称与事实不符且无机制发现」）。A05 的 `sizeBytes`/`retainUntil` 已正确入 schema，不受影响。
- **A12-c**：只读移交摘要 Remote 已交付（含版本可追溯），但没有前端入口——操作员必须手调 Remote。
- **A05 UI**：保留现场容量/逾期已有只读 Remote（`retentionStatus`），但界面不呈现，保留现场不可见。

## What Changes

- **缺陷修复**：`gitResultSchema` 增加 `validationSensitiveChanges: string[]（可选）`——历史事件无此字段照常解析；携带此字段的事件不再被剥除，投影可读。
- **A03-d**：`pactflow_record_review` 的审批理由**恒含**一行「验证敏感文件改动：…（或 无）」——清单取该 Need 全部运行中 `gitResult.validationSensitiveChanges` 的去重并集（有界截断）。评审者在原生审批弹窗即可看到验证基础设施被改动；不阻断（记录可见性，非门禁）。
- **A12-c**：客户端浮层新增「导出移交摘要」入口：调用既有 `pactflow/projectHandover`，以只读 JSON 呈现（含 `packageVersion`/`eventProducerVersion`），可复制；不写任何状态。
- **A05 UI**：客户端浮层新增「保留现场」只读区：总数、保留体积（`retainedBytes`/`measured`/`overBudget`）与逾期清单（`overdue[]`），数据取自既有 `pactflow/retentionStatus` 并随运行时刷新。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `validation-integrity-signals`: 「任务改动验证基础设施必须可见」扩展到**事件折叠存活**（写入的清单必须能从投影读回）与**评审可见面**（评审批准理由必须携带该清单或明确的「无」）。
- `project-handover`: 移交摘要除 Remote 外必须有**前端只读入口**（呈现 + 复制，不写状态）。
- `local-failure-retention`: 保留现场的容量与逾期状态除 Remote 外必须在客户端**只读呈现**，随运行时刷新。

## Impact

- **Host/事件**：`src/domain.ts`（gitResultSchema 增字段，向后兼容）；`src/agent/index.ts`（审批理由，随构建进入 preset 产物）。
- **Client**：`src/client/index.tsx`（注入 `exportHandover`、`loadRuntime` 增 `retentionStatus`）、`overlay.tsx`（保留现场区 + 导出入口）、`locale.ts`（新键）。
- **测试**：投影存活单测（先红后绿：修复前 `undefined`）、审批理由单测两项（有清单/无清单显式「无」）、overlay e2e 一项（保留现场呈现 + 导出入口）。
- **兼容**：事件 schema 只增可选字段，旧日志照读；评审理由变长仍在有界输出内；客户端纯新增。
