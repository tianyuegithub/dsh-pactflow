# DSH 零脉插件最终开发计划

## 1. 目标与完成条件

交付一个预构建、可安装、可卸载、可升级的 DSH Profile Bundle。用户对未修改的官方 DSH 执行一次安装并重启 `web` Profile 后，新会话模式列表出现「零脉模式」。该模式通过 DSH 原生视图完成项目、需求、十阶段、DAG、评审、本地/K3s Worker、代码审查、验证和 Git 收口，并能在 DSH 进程重启后从持久事实恢复。

只有同时满足以下条件才能声称完成：

- 官方 DSH 源码工作树对 PactFlow 为零差异；所需通用能力已进入受支持的 DSH 发行版。
- 预构建 tarball 的安装、Profile dump、Host/Client/Typert/Remote 激活、Preset 发现和 remove 撤销全部通过。
- 零脉领域状态只有一个持久事实源；冷恢复、并发、重复结果、过期租约和崩溃对账通过。
- Web 控制台使用 DSH Client Module、Slot、Store、Locale、Theme 和 Typert Remote，不存在 iframe、第二层 Web 壳或私有 DSH 源码导入。
- 本地 DSH Subagent/Workflow 和真实 K3s 多 Harness Worker 均完成至少一条真实开发任务支线。
- Git/Gitea/Harbor/K3s/凭证/升级/卸载/恢复安全验收通过，且无密钥进入 Git、Session Log、Remote、Tool result、argv、截图或持久日志。

## 2. 冻结的产品与架构决策

### 2.1 产品边界

- DSH 与 Hermes 零脉是两个独立产品实现；不共享源码、运行时、数据库、线路协议、安装包或兼容层。
- DSH 版是外部 Profile Bundle，不将产品 Package 放入 DSH `packages/` 树，不引入私有核心 patch。
- 创造模式的动态 Cordis Package 只用于 Inspect 和原型验证，不作为发行、持久化、升级或 fallback。

### 2.2 组合与包拓扑

第一个可验证发行使用一个多出口 Package `dsh-pactflow`，以最小化外部 Typert、Client Module、Bundle 解析和 Profile 安装变量。源码内部仍保持 Host、Agent、Client 和 Bundle 职责目录边界：

| 目录/导出 | 职责 |
| --- | --- |
| `src/host` / `.` | Host Service、事件、Projection、Settings、编排、对账 |
| `src/agent` / `./agent` | Agent tools、Prompt Section、Skill 和 Workflow Consumer |
| `src/client` / `./client` | Remote mount、标题区入口、Overlay、Store、Locale 和 UI |
| 生成产物 `./typert` / `./remote` | Host Typert Manifest 和 Client Remote 贡献 |
| `presets/pactflow` / `./preset-root` | 零脉 Agent Preset 组合和 Package-owned root provider |
| `cordis.patch.yml` | Host row、root provider、`agent-presets` 配置和 Client row 的 Bundle layer |

只有在细粒度依赖、构建执行面或独立发布证据证明一个 Package 已无法清晰拥有上述职责时，才拆分多 Package；不为预测的未来需求增加发行面。

### 2.3 持久事实与项目身份

- 一个项目对应一个 `agentPreset: pactflow` 的根 Session 和一个绑定项目 Git checkout 的 Workspace；Session ID 是项目 ID。
- 零脉项目从 `ctx.sessionQuery.listSessions()` 返回的 `SessionRecord.header.agentPreset` 筛选；禁止在 Settings 内维护第二份项目注册表。
- 业务事件是 log-only 自定义 Session Event，payload 携带明确 `v`；Projection 是可重建视图，Projection Cache 只是加速器。
- 高频 heartbeat sample 是进程内观测；claim、lease deadline、有意义的 lease renewal、timeout 和 terminal outcome 是持久事件。
- 节点变更使用每节点 revision CAS，不使用全局 Session seq 作为并发版本。

### 2.4 零脉模式与 Web

- Bundle 将 Package-owned `presets/pactflow` root 以 `trust: user` 注入现有 `agent-presets` 配置，保留随附 root、用户 root 和 `default: standard`。
- Preset 是完整 Agent-plane 组合；进程全局 Service 位于 Host，Agent-scoped Service 才进入 isolate group，Tool/Prompt/Skill 按已有 Preset 模式注册。
- Client 不注册全局 `conversation.view` Tab。它向 `conversation.session.header.actions` 贡献只在 `agentPreset=pactflow` 会话显示的入口，并在 root-scoped `shell.overlay` 中渲染原生全屏控制台。
- Overlay 通过稳定 root Store 和 `sessions` source 绑定当前 Session；它不假定拥有 session-scoped props。
- 持续状态优先读取 Client Session `projectionValues`；命令、有界详情、日志和分页查询通过 Typert Remote。

### 2.5 Worker、Git 与基础设施

- 本地 Worker 使用 DSH Subagent/Workflow 公开能力；远程 K3s Worker 是零脉自己的 Provider，但必须符合 DSH 的取消、续作、结果和父 Session 权限语义。
- 外部 Worker 不直接写 Session Log；Host 根据受信 claim token、K3s/Git 证据和 Worker Result 追加事件。
- Harness 与模型协议是独立 Template 字段；保留 Claude Code、Codex、OpenCode、DSH 及 Anthropic/OpenAI 协议选择。
- 每任务一分支一 worktree。Worker 只提交任务分支；Host 更新本地 worktree、执行验证，只在 closing 阶段合并受保护的默认分支。
- DSH Settings 保存集群、仓库、Template 和策略的非密钥元数据；Credentials/Authorization/Kubernetes Secret 持有原始凭证。

## 3. P0 前置：DSH 通用外部事件词汇机制

### 3.1 已证实的阻塞

DSH `PersistenceCoordinator` 对每个读取事件执行 `KNOWN_SESSION_EVENT_TYPES` 检查。该集合由 DSH 仓库中的 `SessionEventMap` 声明生成，仓库外扩展不在其中。外部 PactFlow 可以在 live 进程追加和持久 `pactflow/*` 事件，但重启读取会抛出 `SessionFormatUnsupportedError`。

因此，在受支持 DSH 发行版存在通用外部 log-only 事件机制前，零脉领域实施被硬阻塞。禁止通过私有 fork、关闭读侧检查、滥用已知事件或静默忽略未知事件绕过。

### 3.2 拟议的上游通用合同

向 DSH 上游提交一个非 PactFlow 私有的外部事件词汇能力，首版只支持 `required + log-only`，不支持外部 surface event 或在生产者缺失时静默跳过。合同必须使日志可读性由持久生产者身份决定，而不是由「当前恰好安装了哪些任意插件」决定。

上游合同已收敛为 DSH proposed Agent Note `2026-08-29-durable-external-session-event-producers`：

1. 核心新增一个自己认识的 `session/external-event-producer` 仅日志声明事件，持久 `{ producer, version, eventTypes }` 精确规范元组。不使用无密钥 digest，因为它不增加信任或信息。
2. `SessionStore` 提供由 fiber 管理生命周期的生产者注册表；注册返回生产者绑定 handle，在首个外部事件前无异步间隙地先追加声明。
3. 冷读同时要求日志中已有更早的精确声明，且当前存在完全匹配的受信生产者注册；生产者缺失、版本/事件集不匹配、归属冲突或未声明事件继续抛出 `SessionFormatUnsupportedError`。
4. Bundle 卸载后日志原始产物保留，但读取稳定拒绝并命名缺失生产者；精确重装匹配版本/事件集后恢复读取。
5. 声明事件不改变 `SessionHeader` 或事件 envelope；旧 DSH 不认识该新第一方事件，会按现有未知事件规则失败关闭。

兼容新版生产者和 optional 事件均不在首版默认范围。如果上游选择另一个满足相同安全性质的机制，PactFlow 以上游决策为准。本仓库不复制该核心机制。

### 3.3 P0 验收

- 未注册外部事件继续在读取时被拒绝。
- 已注册但未提前记录词汇声明的事件被拒绝。
- 具有有效声明的 log-only 事件在 live、flush、重启、JSONL 和 SQLite 后保持完整。
- 卸载插件后重读稳定拒绝并命名缺失生产者；精确重装后恢复。
- 事件名、Package 归属、producer/version/event-set 冲突、无效名称和伪造声明被拒绝。
- Persistence Catalog、Session 文档、TypeScript/Python SDK 和相关 Snapshot 同步更新。

## 4. 里程碑 1：外部 Bundle 技术门槛

这一里程碑只证明外部扩展机制，不实现零脉业务。构建一个最小预构建 Bundle，包含：

- 一个 Host Service Loader row；
- 一个提供 Package-owned Preset 路径的 Root Provider；
- 对 `agent-presets` 的完整配置替换和 `pactflowPresetRoot` 注入；
- 一个只显示名称和说明的 `pactflow` Preset；
- 一个有单一 Remote Method 的 `TypertRemoteService`；
- 外部仓库生成的 `./typert` 和 `./remote`；
- 一个挂载 Remote 的 `dsh.client` Package；
- 一个仅在 PactFlow Session 标题区显示的按钮和一个 `shell.overlay` 占位视图。

必须在独立临时 `DSH_HOME` 中验证：

1. 从预构建 tarball 单命令安装，不执行源码 `prepare`。
2. `dsh --profile web --dump-config` 显示 PactFlow Bundle layer、Host row、Root Provider 和完整 `agent-presets` 配置。
3. 启动 Web 后 Preset Roster 同时包含随附模式和 `pactflow`。
4. Typert Loader 自动注册外部 `./typert`，Client 加载 `./client` 并挂载 `./remote`。
5. PactFlow Session 显示入口并打开 Overlay；其他 Preset Session 不显示入口。
6. remove 后重启，Host/Client row、Preset root、模式和 UI 全部退出，已持久 Session 不被删除或改写；含 required 外部事件的日志在精确重装前拒绝读取。

任一步失败都停止后续业务开发，回到外部扩展合同或构建配置，不在 DSH 源码中加 PactFlow 特判。

## 5. 里程碑 2：事件模型、Projection 与冷恢复

### 5.1 事件家族

定义带 Branded ID 和 payload `v` 的 log-only 事件：

- Project：初始化、配置引用、关闭；
- Need/Phase：需求创建、修订、阶段迁移、人工评审；
- DAG：节点创建、依赖、指导、状态迁移；
- Run：claim、lease renewal、心跳状态变更、阻塞、终态、过期结果拒绝；
- Content：文档、评论、附件引用；
- Delivery：审查轮次、验证证据、发布、服务入口。

未知 payload `v`、非法迁移、错误 owner、缺失词汇声明和标识冲突都失败关闭。

### 5.2 Projection

注册小而独立的 Projection Unit，避免一个巨大快照：`pactflow-project`、`pactflow-needs`、`pactflow-phases`、`pactflow-dag`、`pactflow-runs`、`pactflow-reviews`、`pactflow-content`和 `pactflow-delivery`。每个 Unit 具有 schema、`stateVersion`、纯 fold 和有界 Client view。

当前项目和持续 UI 状态读取 Client Session 的 `projectionValues`。大日志、文档内容、运行详情和分页历史通过 Remote 按需读取，不塞入常驻 Projection。

### 5.3 冷恢复

`listSessions()` 返回包含完整 `SessionHeader` 的 `SessionRecord`，直接按 `header.agentPreset === 'pactflow'` 筛选项目。对非终态项目，恢复 Projection Cache 加日志尾部，然后与 Git、K3s 和活动 Subagent 对账。禁止 Settings 项目注册表。

## 6. 里程碑 3：十阶段、DAG 与人工门禁

实现阶段：

```text
backlog → discussion → confirmed → design → planning → executing → code_review → verification → closing → deployed
```

四个显式人工评审点是需求确认、设计批准、计划批准和验证验收。所有推进、拒绝、重做和跳过都通过 Host Service 追加带期望 revision 的事件。

DAG 节点状态为 `pending/ready/claimed/running/blocked/review/succeeded/failed/cancelled/archived`。Claim 只检查当前节点 revision 和 `ready` 状态；Host 在一个无 await 间隔的同步临界段追加 claim 事件。外部 Worker 不参与 claim 事务。

每个 Run 拥有精确 node revision、attempt、provider、claim token、lease deadline、branch、worktree/external job 引用和 outcome。第一个有效终态结果获胜；重复或过期结果不改变状态。

## 7. 里程碑 4：Agent Tool、Workflow 与本地 Worker

实现 `pactflow` Preset 的完整 Agent-plane 组合，以当前 DSH standard Preset 为行为参考而非运行时继承。包含零脉 Persona、稳定 System Prompt Section、产品 Skill、有界模型工具和 Workflow Consumer。

工具面保持窄：查询当前项目/需求/DAG，创建或调整需求，提交人工决策请求，派发/重试/中断 Worker，报告结果和发起验证。完整详情通过 Skill 和 Remote 查询，不用大量核心 Tool Schema 重复。

本地开发使用 DSH Subagent/Workflow 注册的 Provider，不直接创建非所有的 Agent。子 Session 与根项目会话的权限、取消、续作和结果关系可持久追溯。

## 8. 里程碑 5：DSH 原生 Web 控制台

Client Package 使用 DSH 动态 Client Bundle 构建预设，声明完整 `dsh.client.inject` 包依赖图和 Cordis `inject=['sessions','remote','slots','locale']`。它导入 core Package 的生成 `./remote` 并通过 `ctx.remote.$mount()` 挂载。

UI 包含：

- 只在 PactFlow Session 显示的标题区入口；
- root-scoped PactFlow Store 与 `shell.overlay` 全屏控制台；
- 项目摘要、需求列表、十阶段时间线、DAG、Worker 运行、审查、文档、基础设施和发布视图；
- 按 Session Projection 驱动的持续状态和按 Remote 驱动的命令/详情；
- 完整中英文 Locale Dictionary、DSH Theme Token、键盘/焦点/读屏可访问性和 Error Boundary。

在干净 Web 组合中测试非 PactFlow Session 没有入口也没有工具/Prompt 泄漏。禁止修改 DSH 原生 Root Slot 或替换 AppFrame。

## 9. 里程碑 6：Git、Gitea、K3s、Harbor 和多 Harness

### 9.1 Git 合同

- 项目初始化验证本地 checkout、远程 URL、默认分支和保护规则。
- 任务分支名和 worktree 路径由 Host 决定，Worker 不自选。
- Worker 只提交任务分支并返回 commit 证据。
- Host 在本地 worktree 更新、执行验证，对冲突显式阻塞，只在 closing 合并受保护 main。
- 测试分支、K3s Job、Pod 和临时 worktree 都有精确所有权和有界清理。

### 9.2 K3s Provider

定义独立 Remote Worker Provider，不让 Pod 直接访问 DSH Session Log 或浏览器 Remote。Host 在 claim 后创建不可变 Run Spec，将凭证放入 Kubernetes Secret，记录 Job ID 和 lease，并通过 K3s API、Git 和结果文件对账。

支持 Harness 与模型协议任意合法组合，但每个 Harness 只接受它真实支持的协议。连接测试显示实际请求、命令、参数、阶段日志和脱敏错误，禁止固定追加隐藏内容。

## 10. 里程碑 7：持续运行、升级、卸载与发布

- 为安装零脉 Bundle 的 `dsh --profile web` 提供 macOS launchd 和 Linux systemd user 服务说明与生成器；零脉不运行第二个 daemon。
- 进程停止时 K3s Job 可继续，但调度和阶段推进暂停；重启后冷恢复并对账。
- 发行产物是预构建 tarball/npm Package，包含 Host、Agent、Client、Typert、Remote、Preset、Locale、Bundle patch 和文档；Git 安装 `prepare` 不是正式路径。
- Peer dependency 精确锁定已验证 DSH alpha 版本；缺失 Package、Typert、Remote、Client Artifact、Slot、Preset Root 或通用事件词汇都阻止激活。
- remove 后重启必须撤销 Bundle row、Preset root、模式和 UI；已持久 Session 和事件原始产物保留，但含 required 外部事件的 Session 在匹配 Bundle 重装前拒绝读取，且不静默切换其他 Preset。

## 11. 验证矩阵

| 层级 | 必须验证 |
| --- | --- |
| Domain | 事件 schema/version、十阶段、节点 revision CAS、DAG、第一终态获胜、租约与冷恢复 |
| Cordis | 所有注册可卸载、无 Service 泄漏、Preset mount audit、inject 等待与 disposer 失败可见 |
| Typert | 外部 Generator、Host 自动注册、Client mount/unmount、类型失败、取消和权限定址 |
| Client | 组件、Store、Locale、Slot、非 PactFlow 隐藏、Overlay、可访问性、Error Boundary 和 HMR 卸载 |
| Profile | 干净 tarball install、dump-config、Preset 健康、精确 Bundle 顺序、remove 和残留检查 |
| Persistence | JSONL/SQLite、外部事件词汇、Projection Cache、重启、卸载后只读日志和重装恢复 |
| Worker | 本地 Subagent/Workflow、K3s Pod、取消、过期结果、崩溃、重试和容量上限 |
| Delivery | Git/Gitea/Harbor、分支保护、worktree、真实验证、收口、冲突、清理和凭证扫描 |
| Release | 精确 DSH 版本、npm/tarball payload、干净 Home E2E、launchd/systemd、升级、卸载和恢复 |

本地检查使用最窄能证伪当前里程碑的集合；发布前才运行完整矩阵。不得通过删除测试、降低断言、静默 fallback 或 Mock 代替真实集成来制造通过。

## 12. 实施节奏、token 和质量保障

### 12.1 Ralph Loop

每个循环只完成一个最小可验证结果：冻结合同→实施→最快有意义验证→回读 diff/运行证据→复核与目标的差异→进入下一循环。未解决验证失败时禁止进入下一里程碑。

### 12.2 Team Autopilot

主控永远拥有合同、Git、整合、安全和最终验收。子代理仅处理互不重叠的文件/职责边界：上游事件词汇证据、外部 Bundle PoC、Host Domain、Client UI、Worker Adapter、测试和独立风险复核。合同文件只有主控可修改，子代理发现 drift 后必须停止并回报。

### 12.3 可持久上下文

- 本文档是唯一实施计划。
- `implementation-status` 只保留当前里程碑、最后已验证提交、通过/失败命令、精确 blocker 和下一安全动作。
- 每个里程碑在验证后创建一个自包含中文 commit，让 Git 成为恢复 carrier；禁止微提交调试流水。
- 检索只读直接 owner 文件和生成目录，不在每轮重新扫描 DSH 全仓。
- 长任务每小时运行能力治理回顾；只在已证明可复用且明显提效时扩展现有 Skill/脚本，不为仪式新建资产。

### 12.4 停止条件

只有以下条件停止自主推进：上游 DSH 拒绝或不提供安全的外部事件词汇机制；发现零源码修改与必需能力不可兼得；需要创建/推送外部仓库、新凭证或权限扩大；相同验证失败三次且无新证据；或用户产品决策会改变范围、数据含义或安全边界。

## 13. 当前进入条件和下一动作

当前进入里程碑 0，不同时实施业务功能。立即动作为：

1. 完成 DSH 外部事件词汇方案的独立源码复核，写入 DSH proposed Agent Note。
2. 在 DSH 独立 worktree 中实现并验证通用 P0 change；推送/提交上游前获得精确外部写入批准。
3. 同时只读完成外部 Bundle PoC 合同复核；P0 合同冻结后才开始写 PoC 代码。
