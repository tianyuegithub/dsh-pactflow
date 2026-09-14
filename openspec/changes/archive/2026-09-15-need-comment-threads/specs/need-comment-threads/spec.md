## ADDED Requirements

### Requirement: 评论必须归属明确对象且作者身份由宿主判定

评论 SHALL 以 log-only Session Event 追加，payload 携带明确 `v`，并 MUST 归属于 Need、DAG 节点或 Run 三者之一的既存对象。宿主 SHALL 从会话上下文判定作者类别（`human` 或 `agent`）并强制落账；调用方自述的作者身份 MUST 被忽略。归属对象不存在、跨需求引用或对象已 archived 时 SHALL 拒绝追加，MUST NOT 静默落为无主评论。

#### Scenario: 模型发表的评论被强制标为 agent

- **WHEN** Agent 工具以 `author: 'human'` 调用评论追加
- **THEN** 事件落账的作者类别为 `agent`，调用方声明被忽略，且返回值如实呈现落账身份

#### Scenario: 归属对象不存在时指名拒绝

- **WHEN** 评论指向不存在的 Need、节点或 Run
- **THEN** 追加被拒绝且错误指名缺失的对象标识，Session Log 中不产生任何评论事件

#### Scenario: 归属对象跨需求时拒绝

- **WHEN** 评论指向的节点属于另一个 Need
- **THEN** 追加被拒绝，不产生跨需求引用

### Requirement: 评论永不构成任何门禁授权

评论 MUST NOT 解锁人工评审门禁、MUST NOT 推进或回退阶段、MUST NOT 改变节点或 Run 状态、MUST NOT 被折叠为批准证据。四类人工评审 SHALL 继续只经 DSH Approval 服务产生。事件折叠层 SHALL 对「以评论表达批准」的路径失败关闭。

#### Scenario: 评论不改变阶段与节点状态

- **WHEN** 在处于 `design` 阶段的 Need 上追加任意内容的评论（含「同意」「批准」等字样）
- **THEN** 折叠后阶段仍为 `design`，节点状态不变，且不产生 `pactflow/review-recorded` 事件

#### Scenario: 评论不进入批准证据

- **WHEN** 折叠某需求的评审证据
- **THEN** 证据集合只含 Approval 服务产生的评审记录，评论不出现在其中

### Requirement: Agent 评论必须受计数预算约束

每个宿主对象上作者类别为 `agent` 的评论数 SHALL 受预算约束，预算语义取既有运行预算合同，MUST NOT 引入第二套硬编码上限。超出预算的 `agent` 评论追加 SHALL 被拒绝并指名预算，MUST NOT 静默丢弃或覆盖旧评论。`human` 评论不受该预算约束。

#### Scenario: agent 评论超预算被拒绝

- **WHEN** 某节点上 `agent` 评论数已达预算，Agent 再次追加
- **THEN** 追加被拒绝并指名预算上限，既有评论不变

#### Scenario: human 评论不受 agent 预算限制

- **WHEN** 某节点上 `agent` 评论已达预算，人追加评论
- **THEN** 追加成功

### Requirement: 评论只能作废不能删除

评论 MUST NOT 被物理删除或改写原文。人 SHALL 可以将任一评论标记为「已作废」，该标记以追加事件表达，原评论事件保持不变。呈现层 SHALL 折叠已作废评论但保留可展开查看；折叠后的投影 MUST 仍能从事件流完整重建。`agent` MUST NOT 作废评论。

#### Scenario: 作废以追加表达且原文不变

- **WHEN** 人作废一条评论
- **THEN** 产生作废事件，原评论事件原样保留，呈现层折叠该评论且可展开

#### Scenario: agent 不能作废评论

- **WHEN** Agent 面请求作废任一评论
- **THEN** 请求被拒绝，无作废事件产生

### Requirement: 评论进入模型上下文时必须带来源与作者标记

评论经 `pactflow_view` 进入模型上下文时，每条 MUST 携带来源标记（评论）与作者类别（`human` / `agent`）。`agent` 评论 MUST NOT 以任何形式呈现为人的指令；已作废评论 MUST NOT 进入模型上下文。Agent 面 SHALL 能追加评论（身份强制为 `agent`），MUST NOT 通过评论请求或声称批准。

#### Scenario: 快照中的评论带作者类别

- **WHEN** `pactflow_view` 返回含评论的快照
- **THEN** 每条评论带作者类别与来源标记，`agent` 评论与 `human` 评论可区分

#### Scenario: 已作废评论不进入模型上下文

- **WHEN** 某评论已被作废，`pactflow_view` 返回快照
- **THEN** 该评论不出现在快照中

### Requirement: 事件词汇升版必须保持旧日志可读与老会话可写

新增事件类型 SHALL 使生产者声明版本升至 `0.7.0`，`PACTFLOW_EVENT_TYPES_V0_7` MUST 逐条字面列出全部事件类型，MUST NOT 由其它常量推导。`0.1.0` 至 `0.6.0` 的历史词汇 SHALL 继续以 read-only 模式注册。升级前创建的会话 SHALL 在插件升级后仍可写入——首笔新版写入经宿主声明升级通道自动追加声明，MUST NOT 出现生产者声明冲突导致的写冻结。

#### Scenario: 旧读端解析含新事件的日志不失败

- **WHEN** 以不识别 `pactflow/comment-added` 与 `pactflow/comment-voided` 的读取路径解析新日志
- **THEN** 解析成功，未知事件被忽略或按未知类型保留，不抛错

#### Scenario: 升级前创建的会话升级后仍可写

- **WHEN** 在已持久化 `0.6.0` 声明的会话上以 `0.7.0` 句柄追加事件
- **THEN** 写入成功且会话日志中追加了升级后的声明，不出现 conflicting declaration 错误

### Requirement: 讨论必须按需求呈现且投影有界

客户端 SHALL 在会话工作台按当前需求呈现评论：作者类别、时间、正文，已作废者折叠。常驻投影 MUST 只承载计数与最近有界条数的摘要，正文与历史 SHALL 经 Remote 分页读取；投影体积 MUST NOT 随评论总量线性增长。

#### Scenario: 工作台按需求过滤讨论

- **WHEN** 用户在工作台选中某个需求
- **THEN** 讨论区只呈现归属该需求（含其节点与运行）的评论

#### Scenario: 投影有界

- **WHEN** 某需求累计大量评论
- **THEN** 常驻投影只含计数与有界摘要，其体积不随评论总量线性增长
