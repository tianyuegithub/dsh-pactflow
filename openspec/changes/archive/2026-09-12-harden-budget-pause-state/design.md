## Context

见 `proposal.md`。已核实的机制事实：节点折叠（`domain.ts` DAG fold）对 `node-updated` 做**修订单调 + 依赖图**校验，状态迁移本身不做枚举限制——因此暂停/恢复可复用 `node-updated`（无需新增事件词汇，legacy 只读词汇不受影响）；`nodeSchema.state` 与 `PactFlowNodeState` 需同步增 `paused`；客户端 `STATE_COPY` 是全状态覆盖的查表（新状态必须补表，否则渲染 undefined）。

## Goals / Non-Goals

**Goals**：预算耗尽 → 节点持久 `paused`（落账、可见、指名拒绝）；显式 `resumeNode` 恢复（依赖满足→ready，否则 pending）并留痕；派发/重试对 paused 指名拒绝；客户端呈现与恢复入口。

**Non-Goals**：不给 Run 加暂停；不做自动恢复；容量不足不暂停（瞬时态，排队即可）；不改输出/重试预算数值语义。

## Decisions

### 决策 1：暂停/恢复复用 `pactflow/node-updated`，不新增事件词汇

- **理由**：折叠已校验修订单调与依赖图；状态机迁移表不加限制（与 retryNode 失败→ready 现状一致）。新增事件词汇会扩 17 类外部事件合同、牵动 legacy 只读注册与文档计数——零收益。
- **代价**：日志里"暂停"与其它状态迁移同为 node-updated——可审计性由状态本身与 attempt 历史承担（暂停原因可从 runs 的 attempt 数 == 预算推导）。

### 决策 2：`retryNode` 预算耗尽时落 paused 并返回（不抛错）

- **理由**：调用方（模型）得到的是确定性答复"已暂停等待人工"，比再次异常更可读；落账后投影/界面即时可见。
- 恢复入口 `resumeNode`（Remote，人经客户端触发）：非 paused 拒绝；依赖满足→ready，否则 pending（复用既有 ready 判定）。

### 决策 3：paused 的指名拒绝加在 `claimNode` 入口

- **理由**：全部派发路径（local/git/k3s）经 claimNode；一处检查全覆盖，统一准入语义天然一致（满足 worker-admission-uniformity 增补合同）。

## Risks / Trade-offs

- [paused 卡死需要人工] → 与跨主机锁同一取舍：预算是人的决策线，恢复=人的决策；错误/呈现均指名「等待人工恢复」。
- [新状态遗漏渲染] → `STATE_COPY` 为全状态查表，缺表即渲染 undefined——单测断言 paused 有条目。
- [旧版本插件读到 paused 节点日志] → 与既有升级合同一致（重装匹配版本后恢复读取）。

## Migration Plan

1. types/domain 状态枚举 + STATE_COPY。
2. retryNode 耗尽→paused；claimNode/retryNode 指名拒绝；resumeNode。
3. 客户端 DAG 呈现 + 浮层「已暂停节点」恢复区。
4. 单测（耗尽→paused→resume 全链、指名拒绝、呈现表）→ check → validate → archive。
