## Why

`scripts/evidence-schema.mjs` 导出 `validateAcceptanceEvidenceFile(path)`（读文件 + 校验），但**零消费者**：两个真实调用点（`evidence-collect.mjs` 与 `acceptance-gate.mjs`）各自**内联复制**了它的实现——

```js
const parsed = JSON.parse(readFileSync(path, 'utf8'))
validateAcceptanceEvidence(parsed)
```

即「读文件并校验证据」这一动作存在**三份等价实现**：一份死掉的导出 + 两份内联复制。这属本批持续清理的同一类问题（对照：已删除的 `retentionRemainingMs`、已接线的 `harnessCapabilityProfile`、已接线的 `impact-list.schema.mjs`）。

（`ACCEPTANCE_EVIDENCE_VERDICTS` / `ACCEPTANCE_EVIDENCE_CONCLUSIONS` 曾疑似同病，经查**在 `validateAcceptanceEvidence` 内部使用**，非死代码，不动。）

## What Changes

- `scripts/evidence-collect.mjs`：`readEvidenceFile` 改为直接调用 `validateAcceptanceEvidenceFile(path)`（删掉内联的 `JSON.parse(readFileSync(...)) + validateAcceptanceEvidence`）。
- `scripts/acceptance-gate.mjs`：`evidence.json` 分支改为 `evidences.push(validateAcceptanceEvidenceFile(full))`；导入同步为 `validateAcceptanceEvidenceFile`。
- 结果：`validateAcceptanceEvidenceFile` 由「死导出」变为「两处真实使用」；证据读取/校验逻辑**收敛为一份**。

## Capabilities

### New Capabilities
- `evidence-validation-single-path`: 验收证据的「读取并校验」必须有唯一实现路径，调用点 MUST 复用该路径，MUST NOT 内联复制；不得存在无人调用的等价导出。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/evidence-collect.mjs`、`scripts/acceptance-gate.mjs`（不改 `evidence-schema.mjs` 的行为）。
- **测试**：既有 `tests/acceptance-gate.spec.ts`（6 项，其中 5 项通过真实 `evidence.json` 文件走该路径）继续覆盖，无需新增。
- **兼容**：行为等价（同一校验函数、同一读文件语义）；`pnpm run check` 全绿（63 文件 / 519 测试）。
