# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现覆盖缺口 | ✅ | `grep -rl evidence-collect.mjs packages/dsh-pactflow/tests/` = 0；`acceptance-gate.spec.ts` 导入的是 `acceptance-gate.mjs` 与 `evidence-store.mjs`，非采集器 |
| 更正自身结论 | ✅ | 早前把采集器重构记为「由既有测试覆盖」，实为**手工实跑**验证——该说法不准确，本次以真实测试补齐 |
| 离线可测性 | ✅ | 采集器经 `PACTFLOW_ACCEPTANCE_EVIDENCE_DIR` 指向临时证据根即可离线驱动 |
| 测试 | ✅ | `tests/evidence-collect.spec.ts` 4 项全绿：完整收齐 7/7、缺项入 `missing`、未知字段失败关闭（`unexpected fields sneaky`）、目录缺失失败关闭 |
| 对抗性验证 | ✅ | `readEvidenceFile` 改为纯 `JSON.parse`（绕过校验）→「结构非法」用例失败（1 failed / 3 passed）；已还原 |
| 验证 | ✅ | `pnpm run check` 67 文件 / **534** 测试（原 530） |

## 为什么这条守卫值得加

证据采集器是 B 类验收的输入口：它若把缺项当通过、或把非法证据静默读入，后续门禁（`acceptance-gate`）拿到的就是**被污染的输入**——而门禁自己是「正确」的。这与本会话反复出现的形态同源（**声称被覆盖/正确，实际无人验证**），区别在于这次是**我自己的记录**不准确，已被测试纠正。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 完整批次收齐 | `collects every target and reports nothing missing for a complete batch` |
| 缺项不被当作通过 | `reports a missing target rather than counting it as passed` |
| 结构非法失败关闭 | `fails closed on a structurally invalid evidence file (the refactored read-and-validate path)` |
| 目录缺失失败关闭 | `fails closed on a missing batch directory` |

## 已知边界（诚实）

- 仅覆盖**采集器入口**；`evidence-store.mjs` 的 `preserveReport` 由既有测试覆盖，未重复。
- 未覆盖「同一 target 重复证据」分支（实现里有 `duplicate evidence for target` 检查）：`walkEvidence` 以目录名作 target 目录，构造同名重复需更曲折的树形，本批未做。
- 本 change 是**纯补测试**，不改行为，故不影响任何运行时结论。

## 验证

`pnpm run check` 通过：67 个测试文件、534 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
