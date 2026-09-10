## Why

`docs/development-plan-开发计划.md` §380 要求「**B 类执行前**由唯一写入方给出精确影响清单（目标、分支、合并、清理），取得适用授权后批量执行并留证」。`scripts/impact-list.schema.mjs` 早已实现该清单的**结构校验**，但**全仓零导入、也不在 package.json scripts**——即这条计划要求**只有工具、没有执行**，实际靠人工自觉。

（同批已发现并处置的同类：`retentionRemainingMs`（无契约→删除）、`harnessCapabilityProfile`（有契约→接线）。本项属「**有契约要求，但未接线**」——与后者同类，正确处置是**接线**。）

## What Changes

- `scripts/impact-list.schema.mjs`：新增 `requireGrantedImpactList(list)` 与 `loadAndRequireGrantedImpactList(path)`——在结构校验之外，**要求 `authorization === 'granted'`**；`pending` 是合法结构但**不得执行**（结构有效 ≠ 已授权）。
- `scripts/run-real-k3s-batch.mjs`：真实（会变更集群与远程分支的）批处理在运行阶段前调用 `enforceImpactListGate()`：
  - 若提供 `PACTFLOW_K3S_IMPACT_LIST`（JSON 路径），加载、校验并**要求已授权**；非 `granted` 直接失败；
  - 若未提供，则**显式告警**「本次变更型运行未施加 §380 影响清单门禁」，不静默假装已校验。
- `tests/impact-list-gate.spec.ts`：新增 5 项，覆盖结构校验（未知字段/空数组/枚举）、**拒绝 well-formed 但 pending 的清单**、以及从文件加载并门禁（含非法 JSON）。

## Capabilities

### New Capabilities
- `b-class-impact-list-gate`: B 类（变更型）执行必须先有精确影响清单，且该清单必须已获授权；结构有效不等于已授权；未施加门禁时必须显式可见。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/impact-list.schema.mjs`（新增门禁函数）、`scripts/run-real-k3s-batch.mjs`（接线 + 显式告警）。
- **测试**：`tests/impact-list-gate.spec.ts`（5 项；`pnpm run check` 由 514 → 519）。
- **兼容**：不提供 `PACTFLOW_K3S_IMPACT_LIST` 时行为与之前一致（仍然运行），只是**多一条显式告警**；提供时则新增「必须已授权」的失败关闭。
