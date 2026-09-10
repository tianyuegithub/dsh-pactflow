## Why

`scripts/evidence-collect.mjs` 的 `collectEvidence()`（B 类证据采集的入口）此前**没有任何测试引用**——本会话早前把它的「读文件并校验」路径收敛为 `validateAcceptanceEvidenceFile`，当时我记录为「由既有测试覆盖」，但**该说法不准确**：`acceptance-gate.spec.ts` 覆盖的是 `acceptance-gate.mjs`，不是采集器；采集器只被**手工实跑**验证过。

教训与本会话一致：**「我以为被覆盖」不等于「有测试」。** 采集器读/校验/去重/缺项判定任一环节静默错误，都会让证据管线给出错误结论。

## What Changes

- 新增 `tests/evidence-collect.spec.ts`（4 项），通过**真实入口**（磁盘上的证据根 + `PACTFLOW_ACCEPTANCE_EVIDENCE_DIR`）驱动采集器：
  - 完整批次 → 收齐全部 target 且 `missing` 为空；
  - 缺一个 target → 进入 `missing`（不得被当作 passed）；
  - 结构非法（未知字段）→ 失败关闭（即**收敛后的读校验路径**）；
  - 批次目录不存在 → 失败关闭并给出目录路径。
- 未改动 `evidence-collect.mjs` 的行为。

## Capabilities

### New Capabilities
- `evidence-collector-coverage`: 证据采集器的入口行为（收齐、缺项、失败关闭）必须有测试覆盖；不得仅以「由既有测试覆盖」的口头结论代替实际测试。

### Modified Capabilities
（无。）

## Impact

- **测试**：新增 `tests/evidence-collect.spec.ts`（`pnpm run check` 66 文件 / 530 → 67 文件 / 534）。
- **兼容**：纯新增测试；采集器行为与输出不变。
