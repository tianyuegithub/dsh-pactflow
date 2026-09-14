# need-comment-threads

## Why

开发计划 §5.1 把 Content 事件家族定义为「文档、**评论**、附件引用」，实际只交付了 `pactflow/document-linked` 一类事件与工作台的只读文档列表。评论在本仓源码中零实现。

后果发生在真实使用里：

1. **讨论不随需求持久**。人与模型关于某个需求的往返讨论只存在 DSH 会话正文里，换一个会话就读不到，也无法按需求检索。审批理由（`pactflow/review-recorded`）是门禁产物，不是讨论载体——它只在四个评审点产生，无法承载评审点之间的分析、质疑与决定依据。
2. **模型的调研结论会丢**。前期调研由执行代理完成后，除非折进节点产物或文档，否则结论随会话正文一起沉底。

评论是纯事件、无外部依赖，可以独立于附件先行交付。附件另立 `need-attachments`（依赖对象存储与其真实验收），两者刻意分开，避免评论被附件的环境前置卡住归档。

## What Changes

- **新增评论**：可挂在 Need、DAG 节点、Run 三类宿主对象上，log-only Session Event，payload 携带明确 `v`。作者身份由宿主从会话上下文判定并**强制落账**，显式区分 `human` 与 `agent`，调用方不得自述身份。
- **评论永不构成授权**：评论 MUST NOT 解锁任何人工门禁、MUST NOT 改变阶段或节点状态、MUST NOT 被折叠为批准证据。四类人工评审仍只经 DSH Approval 服务产生。
- **Agent 面可读可写但受限**：评论以**带作者类别标记**的形式进入 `pactflow_view` 快照；新增 `pactflow_add_comment` 写工具，落账身份强制为 `agent`。模型 MUST NOT 通过评论请求或声称批准。
- **Agent 评论有计数预算**：每个宿主对象上 `agent` 作者的评论数受预算约束（取既有运行预算合同的语义，不引入第二套硬编码），超出即拒绝——log-only 不可删，无上限意味着幻觉结论永久堆积且不可清理。
- **人可标记评论为「已作废」**：不删除、不改写原文（保持 log-only 与历史不可篡改），以追加事件表达「此条已被作废」，呈现时折叠。这是对「不可删」的必要补偿。
- **进入模型上下文时的标记**：评论作为新的「进入模型上下文的文本源」，在 `pactflow_view` 中 MUST 以明确的来源与作者类别标记呈现，与挂机通知「plugin notices, not new human instructions」同族处理——`agent` 评论对模型 MUST NOT 呈现为人的指令。
- **事件词汇升版**：新增 `pactflow/comment-added` 与 `pactflow/comment-voided` 两类事件，生产者声明版本 `0.6.0 → 0.7.0`，`PACTFLOW_EVENT_TYPES_V0_7` 按既有惯例**逐条字面列出、绝不由新常量推导**。0.1.0–0.6.0 继续以 read-only 注册保证旧日志可读。
- **老会话可写性**：上游会话生产者声明升级通道已于 2026-09-13 在 fork 实施并验收（`06d3202146`），老会话首笔新版写入自动追加升级声明。本 change MUST 以测试断言「升级前创建的会话在插件升级后仍可写入」——该测试当前只能对 fork 验证（上游 PR 未合并），属工作假设，须在实施状态如实标注。
- **客户端**：会话工作台新增「讨论」区，按当前需求过滤，人可发表评论、可作废评论。
- **非目标**：不做富文本编辑器、不做 @提醒与通知、不做实时协同编辑、不做跨需求讨论区、不做评论的编辑与物理删除、不做附件（见 `need-attachments`）。

## Capabilities

### New Capabilities

- `need-comment-threads`: 需求级评论的完整行为合同——对象归属与作者身份强制、评论永不构成授权、Agent 面的读写边界与计数预算、作废而非删除、进入模型上下文时的来源标记、事件词汇升版与老会话可写性。

## Impact

- **Host**：`src/domain.ts`（两类新事件 + `PACTFLOW_EVENT_TYPES_V0_7` 字面词汇 + 独立 collaboration 投影的 fold 与 `stateVersion`）、`src/index.ts`（`EVENT_PRODUCER_VERSION` 0.7.0、只读注册补 0.6.0、评论追加/作废/分页读取的 `@Remote()` 入口）。
- **Agent**：`src/agent/index.ts` 新增 `pactflow_add_comment`；`pactflow_view` 快照补带标记的评论摘要。
- **Client**：`src/client/session-workbench-view.tsx` 新增讨论区；`src/client/locale.ts` 补词条。
- **Session Event**：新增 2 类事件，生产者 `0.6.0 → 0.7.0`；旧读端剥离未知键即可读新日志。
- **Worker Provider**：不涉及。
- **对其它活跃 change 的影响**：本 change 升版后，`gitea-review-gate-closure`、`node-rerun-authorization`、`dsh-harness-telemetry` 若在其后实施，其「老会话可写」断言 MUST 在 `0.7.0` 上重跑；若在其前实施，则本 change 实施时 MUST 重跑它们的该项断言。
- **架构对应**：§4 不变量「领域状态只有一个持久事实源」「Remote 与 Agent 工具不能自行授予批准」被本 change 的合同显式覆盖，不放宽。
