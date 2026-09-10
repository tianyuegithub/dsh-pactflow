## Context

见 proposal.md（Why）。关键事实：

- `pactFlowReviewEvidenceDigest`（`src/review-authorization.ts`）只摘要批准文本相关字段。
- `recordReview`（`src/index.ts:1081`）校验批准审计对与摘要，写入 `PactFlowReview`（`approvalRequestId/needRevision/evidenceDigest/source`）。
- `createNode`（`src/index.ts:1163`）不推进 Need 修订；`updateNodeDependencies` 亦然。
- `closeGitNeed` 已计算 `expectedTaskRefs`（每个成功 Run 的 remoteRef + commit，按 remoteRef 排序）；这正是「交付对象」的天然表达。
- `latestReviewApproved(session, needId, 'verification', need.revision - 1)` 目前只比对 kind/revision/source。

约束：不改既有必需字段语义；旧事件只读兼容；不引入第二份事实源。

## Goals / Non-Goals

**Goals:**
- verification 批准绑定精确交付对象；对象变化使旧批准失效。
- 兼容旧记录（缺摘要时失败关闭而非放行）。

**Non-Goals:**
- 不改变「就绪即可认领」（决策 1B）；研究/补充节点仍可在计划批准后创建。
- 不改十阶段与四类评审的种类。
- 不引入独立的批准数据库。

## Decisions

### D1：交付对象摘要 = 排序后的 (任务分支引用, 成功提交) 集合

复用 closing 已有的 `expectedTaskRefs` 形状：对每个成功 Run 取 `{ remoteRef, commit }`，按 `remoteRef` 排序后规范化 JSON 求 SHA-256。这样与收口的任务集合校验共用同一「交付对象」定义，避免两套语义。

- 备选：只用节点编号集合。否决——替换成功提交同样应使批准失效，必须含提交。

### D2：`subjectDigest` 为可选新字段（向后兼容）

`PactFlowReview.subjectDigest?: string` + schema 可选。记录 `kind === 'verification'` 时写入；其他 kind 不必。收口要求最新 verification 批准的 `subjectDigest` 存在且等于当前值。

### D3：缺摘要的历史批准失败关闭

若最新 verification 批准无 `subjectDigest`，收口拒绝并提示「需要重新确认交付对象」。避免默认放行造成静默扩大交付集合。旧事件读取不受影响（只读展示仍可）。

### D4：计算函数放在 `review-authorization.ts`（纯函数）

`pactFlowDeliverySubjectDigest(sessionId, needId, taskRefs)` 纯函数；`recordReview` 与 `closeGitNeed` 共用，保证两侧算法一致。

## Risks / Trade-offs

- [新增节点后需重新批准，增加一次人工确认] → 这正是目标：交付集合的实质变化必须重新确认。研究节点仍可创建，只是不自动进入旧批准范围。
- [历史已 deployed 的 Need 在此后重跑会因缺摘要被拒] → 失败关闭 + 明确提示；属期望的保守行为。
- [算法不一致会导致误拒] → 抽同一纯函数并加「顺序无关」单测。

## Open Questions

（无。）
