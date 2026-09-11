## Context

见 `proposal.md · Why`。接线事实（已实测）：`gitResultSchema` 未声明的字段在 `parseEventPayload` 折叠时被 zod 剥除（实测 `RESULT=undefined`）；`cleanupSchema` 已正确声明 `sizeBytes`/`retainUntil`；客户端经 `ctx.get('remote.pactflow')` 调 Remote，浮层函数由 `client/index.tsx` 注入（`load`/`loadRuntime`/…），`retentionStatus` 与 `projectHandover` Remote 均已存在。

## Goals / Non-Goals

**Goals**

- 验证敏感清单「写入→折叠存活→投影可读→评审可见」全链路成立；前端两个只读入口（移交摘要、保留现场）落地并有浏览器测试。

**Non-Goals**

- 不把验证敏感改动做成**门禁**（阻断评审/收口）——只做可见性（上游建议亦如此：禁止改测试不可取）。
- 不做保留现场的处置入口（删除/清理仍走既有显式路径）；不做移交摘要的文件下载（复制即可）。
- 不改任何事件词汇/持久格式（schema 只增可选字段）。

## Decisions

### 决策 1：缺陷修复用「schema 增可选字段」而非读侧放行

- **理由**：`pactFlowSchema` 的意义就是投影读回的**确定性形状**；在解析处对未知字段放行（passthrough）会让每个 Git 结果字段都免检。增可选字段使「能读回」成为被 schema 保证的事实，且向后兼容（历史事件无此字段照常解析）。

### 决策 2：评审理由「恒含一行」，无改动时显式「无」

- **理由**：省略会让「没看」与「没有」不可区分——与零验证一等信号同一原则。清单为该 Need 全部运行 `gitResult.validationSensitiveChanges` 的去重并集，排序后截断（上限 6 条 + 「等 N 项」），保证理由仍在有界输出内。

### 决策 3：两个只读入口都放进现有浮层，经注入函数调 Remote

- **理由**：浮层是既有只读呈现面（含请求门与新鲜度跟踪）；`loadRuntime` 已按「运行时数据」节奏刷新，`retentionStatus` 属同一类（随清理/运行形状移动刷新，签名已含 cleanups）。移交导出为一次性动作，独立注入 `exportHandover`，不复用刷新通道。

### 决策 4：投影存活测试先红后绿

- **理由**：这是缺陷修复（非新增不变量）；先以现状跑出 `undefined`（红），修复后转绿，红的过程即缺陷证据。

## Risks / Trade-offs

- [评审理由变长] → 清单截断上限 + 既有 `boundedOutcome` 输出预算约束。
- [schema 增字段后历史带字段事件重新可见] → 这正是修复目的（此前被静默剥除），非行为破坏。
- [浮层新增区影响移动视口断言] → 新区随既有网格布局流动；e2e 移动视口用例覆盖。

## Migration Plan

1. schema 修复 + 投影存活测试（先红后绿）。
2. A03-d 审批理由 + 单测；构建刷新 preset 产物。
3. 客户端两入口 + e2e；全量 check + test:web。
4. validate → archive（补 Purpose 若新 capability——本 change 无新 capability）。

## Open Questions

（无。）
