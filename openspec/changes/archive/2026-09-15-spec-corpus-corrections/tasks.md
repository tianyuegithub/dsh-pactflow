# tasks — spec-corpus-corrections

本 change 不改动任何代码；每条更正都先复核代码实际行为，确认是 spec 正文承载了错误。

## 1. gitea-review-gate

- [x] 1.1 复查节奏：核实 `run-time-contracts` 管的是 K3s 租约与 Job 墙钟（与 API 轮询节奏无关），确认无可继承合同；正文改为自有的有界合同，并要求取值与定尺理由写在实现处。新增一条 Scenario 守住「不得只以魔数存在」
- [x] 1.2 「Agent 面与 Worker MUST NOT 触发合并」按其自身 Scenario 限定为等待态期间；引用块写明无条件表述会把有人工批准背书的正常收口也判为违规

## 2. node-rerun-authorization

- [x] 2.1 核实代码：`rerunRefusal` 在预算耗尽时只返回拒绝原因、不改动任何状态，且该原因经 `rerunPreview` 先行可见
- [x] 2.2 以 REMOVED + ADDED 整条替换「重跑必须复用既有预算与暂停语义」；新条要求拒绝时状态、修订与全部 Run 均不改变，并保留旧条真正要防的「拒绝必须可见可查」
- [x] 2.3 引用块写明 `retryNode`（前态 `failed`）与重跑（前态 `succeeded`）形似而前态不同，旧表述是照搬

## 3. failure-scene-retention-policy

- [x] 3.1 核实两条 Requirement 按字面读法互斥，现网 `retentionStatus` 返回六个字段必然违反其一
- [x] 3.2 判据由穷举字段清单改为「由契约要求」；保留原有 Scenario「已交付能力仍可用」，新增一条明确容量三项属于契约要求

## 4. 需裁决项

- [x] 4.1 `node-rerun-authorization` 的 Git 祖先链判定与代码不一致，已在 proposal 中作为需用户裁决项提请，并已记入实施状态的未处置清单；本 change 不单方面处置

## 5. 终验

- [x] 5.1 `openspec validate --all --strict` 全绿
- [x] 5.2 代码、测试、产物零改动（本 change 只触及 `openspec/`）
