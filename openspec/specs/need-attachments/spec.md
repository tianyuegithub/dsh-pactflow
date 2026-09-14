# need-attachments Specification

## Purpose
让人可以把文件挂在需求上，而**内容本体永不进入事实源**：字节上传到项目绑定的对象存储，
Session Event 只留结构化地址与摘要（uri/etag/bytes/sha256/媒体类型/kind/摘要），消费前
必须 resolve 并校验，校验不符即显式失败而不回落到对话记忆。

三条边界定义了这个能力的形状。**上传是人的动作**：Agent 面只读，既没有上传工具，也拿
不到端点或凭据参数——否则持久记录里的「由用户添加」就成了可伪造的人类痕迹，而模型能把
上传瞄准项目从未绑定的地方。**失败关闭没有替代路径**：内容命中凭证模式要拒收，扫描器
自身故障同样拒收，未绑定对象存储时入口显式不可用——绝不退回为内联大文本，也绝不写入
DSH_HOME 或任何替代位置。**越限在发送前拒绝**：附件通道阈值单列且远低于传输层实测
上限，使越限永远是本产品带明确文案与 oversize 码的策略拒绝，而不是传输层或运行时的
不透明失败。

上传成功的对象进入既有保留账本；上传成功而落账失败留下的对象由列表对账标为孤儿并呈现
给人裁决，**绝不自动删除**。签名 URL 不被生成，也不进入事件、对话或日志。

## Requirements

### Requirement: 传输层必须先评估原生路径且结论持久记录

附件的浏览器到宿主传输 SHALL 按「复用 DSH 原生 attachment 传输层 → 分片经 Remote → 宿主新增端点」的顺序评估，取第一个可行的。评估 MUST 产出可核验证据（可承载的最大字节、是否可被插件接入、失败语义），并记入实施状态。任一候选被否决时 MUST 记录否决依据。签名 URL MUST NOT 作为任何候选。

#### Scenario: 原生传输层可行时优先复用

- **WHEN** 评估证明 DSH 原生 attachment 的客户端到宿主传输层可承载任意字节且可被插件接入
- **THEN** 附件传输复用该路径，不引入分片协议或新端点

#### Scenario: 否决须有记录

- **WHEN** 某候选被判定不可行
- **THEN** 实施状态中含该候选的否决依据与证据，后续候选才能开始评估

### Requirement: 附件本体必须外置且受脱敏门与保留账本约束

附件 SHALL 将内容本体上传至项目绑定的 artifact store，事件 MUST 只存结构化 `artifactRef`（uri/etag/bytes/sha256/kind/媒体类型/摘要，后端返回时含 versionId），MUST NOT 存内容本体。上传 MUST 经既有内容级脱敏门：命中凭据即拒收，扫描器故障同样拒收（fail-closed）。上传成功的对象 MUST 登记进既有保留账本，MUST NOT 自动删除。签名 URL MUST NOT 被生成，也 MUST NOT 进入事件、对话或日志。

#### Scenario: 含凭据的附件被拒收

- **WHEN** 上传内容命中凭证模式扫描
- **THEN** 上传被拒绝并返回指名原因，对象存储中不产生对象，Session Log 中不产生附件事件

#### Scenario: 扫描器故障时同样拒收

- **WHEN** 内容扫描器在附件上传路径抛错或不可用
- **THEN** 上传被拒绝（失败关闭），MUST NOT 以「扫描不可用」为由放行

#### Scenario: 事件只存地址与摘要

- **WHEN** 附件上传成功并落账
- **THEN** 事件 payload 含 uri、etag、bytes、sha256、媒体类型与摘要，不含内容本体，也不含任何签名地址

#### Scenario: 附件对象进保留账本与孤儿对账

- **WHEN** 附件上传成功但事件落账失败
- **THEN** 列表对账把该对象标为孤儿并呈现给人裁决，不自动删除

### Requirement: 附件通道阈值必须单列且不超传输层硬限

附件的字节上限 SHALL 作为独立通道阈值配置，MUST ≤ 选定传输层的硬限。越限的上传 SHALL 在发送前被本地拒绝并返回 `pactflow.artifact.oversize` 与指引，MUST NOT 部分上传。

#### Scenario: 越限附件发送前被拒

- **WHEN** 附件字节数超过通道阈值
- **THEN** 上传在发送前被拒绝，返回 oversize 错误码与指引，对象存储中不产生对象

### Requirement: 未绑定对象存储时附件失败关闭

项目未绑定 artifact store 时，附件入口 SHALL 显式不可用并说明原因，MUST NOT 回落为内联大文本、MUST NOT 写入 DSH_HOME 或任何替代位置。

#### Scenario: 未绑定存储时显式不可用

- **WHEN** 项目未绑定对象存储且用户尝试上传附件
- **THEN** 入口显式不可用并指名「未绑定对象存储」，不产生任何替代位置的写入

### Requirement: Agent 面只读且消费前必须校验

Agent 面 SHALL 能读取附件的 ref 与摘要，MUST NOT 上传附件、MUST NOT 获得对象存储的端点参数或凭据。消费附件内容前 MUST 按既有解析义务先 resolve 并校验 bytes 与 sha256，MUST NOT 以对话记忆替代对象内容；校验不符时返回显式错误码并停止。

#### Scenario: Agent 不能上传附件

- **WHEN** Agent 面尝试上传附件
- **THEN** 该能力在 Agent 工具面不存在，且宿主对来自 Agent 来源的上传请求拒绝

#### Scenario: Agent 消费附件前必须校验

- **WHEN** Agent 读取附件内容用于后续执行
- **THEN** 内容先经 resolve 并校验 bytes 与 sha256；校验不符时返回显式错误码并停止，不回落到记忆内容

### Requirement: 事件词汇升版必须保持旧日志可读与老会话可写

新增 `pactflow/attachment-linked` SHALL 使生产者声明版本升级；新词汇表 MUST 逐条字面列出，MUST NOT 由其它常量推导。历史词汇 SHALL 继续以 read-only 注册。升级前创建的会话 SHALL 在升级后仍可写入，MUST NOT 出现生产者声明冲突。

#### Scenario: 旧读端解析含附件事件的日志不失败

- **WHEN** 以不识别 `pactflow/attachment-linked` 的读取路径解析新日志
- **THEN** 解析成功，不抛错

#### Scenario: 升级前创建的会话升级后仍可写

- **WHEN** 在已持久化旧版声明的会话上以新版句柄追加事件
- **THEN** 写入成功且日志追加升级后声明，不出现 conflicting declaration 错误

### Requirement: 引用必须对人类可读且读取受绑定约束

客户端 SHALL 呈现附件的摘要、字节数、媒体类型与校验状态，并提供显式读取入口。宿主读取 SHALL 只解析本绑定 bucket 内的目标，越出绑定 MUST 拒绝，MUST NOT 生成签名地址。

#### Scenario: 附件读取越出绑定时拒绝

- **WHEN** 读取入口收到指向绑定 bucket 之外的 ref
- **THEN** 读取被拒绝并返回显式错误码，不发起任何对该目标的请求
