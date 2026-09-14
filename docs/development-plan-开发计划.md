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
| `src/host` / `.` | Host Service、事件、Projection、Settings、编排、对账与 Preset Root Service |
| `src/agent` / `./agent` | Agent tools、Prompt Section、Skill 和 Workflow Consumer |
| `src/client` / `./client` | Remote mount、标题区入口、Overlay、Store、Locale 和 UI |
| 生成产物 `./typert` / `./remote` | Host Typert Manifest 和 Client Remote 贡献 |
| `presets/pactflow` | 零脉 Agent Preset 组合；同一 Host row 提供 Package-owned root 路径 |
| `cordis.patch.yml` | Host row、root provider、`agent-presets` 配置和 Client row 的 Bundle layer |

只有在细粒度依赖、构建执行面或独立发布证据证明一个 Package 已无法清晰拥有上述职责时，才拆分多 Package；不为预测的未来需求增加发行面。

### 2.3 持久事实与项目身份

- 一个项目对应一个当前 `agentPreset` Projection 为 `pactflow` 的根 Session 和一个绑定项目 Git checkout 的 Workspace；Session ID 是项目 ID。`SessionHeader.agentPreset` 只记录创建时模式，不能表示空白会话在首轮前切换后的当前模式。
- 零脉项目从 `ctx.sessionQuery.listSessions()` 获取候选 Session，再用完整事件折叠得到的当前 `agentPreset` Projection 筛选；live Session 直接读取同一 Projection，裸 Host 嵌入才回退 Header。禁止在 Settings 内维护第二份项目注册表。
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
- 基础设施设置拆分为 K3s Cluster、Registry、Git Provider、Harness Template 和 Worker Pool 五类可引用资源；资源以稳定 ID 关联，删除被引用资源必须失败关闭。（artifact-ref-handoff change 起增补第七类：S3 兼容对象存储 Artifact Store，六类共用同一卡片生命周期后演进出七类）
- Worker Pool 首版是逻辑容量池，不是常驻 Pod 池：每个 Run 仍创建全新 K3s Job，Pool 只拥有集群路由、允许的 Template、并发上限、FIFO 排队和容量释放。
- 项目绑定优先从本地 `git remote` 读取无凭证 URL，按 host/path 与 Git Provider 匹配；只有唯一匹配时自动生效，零匹配或多匹配都返回可操作的明确错误。
- Registry 首版支持 Harbor 元数据、TLS 校验策略、Project 和 Kubernetes imagePullSecret 引用；Host 和 Client 不读取、返回或记录 Secret 内容。
- 为兼容 0.2.x，旧的单 `k3s` 设置可读但不扩展；新写入使用资源化 `infrastructure` 合同，运行时禁止同时混用两套调度来源。
- Kubeconfig 通过 DSH 通用 Host 文件选择能力定位，Client 只获得绝对路径；Host 解析并只返回 Context 名称。本轮不上传 kubeconfig 内容，未来远程企业平台的上传、留存和租户隔离单独设计。
- Harness 只保存工具类型、Harbor 镜像引用和资源规格；Model Connection 独立保存协议、endpoint、model id 和 DSH Credential 引用，Run 选择 Harness + Model Connection，禁止用组合名称复制模板。
- 密码和 API key 只通过 DSH Credentials Remote 写入，Settings、PactFlow Remote、Session Event 和日志只保留内部引用或已配置状态；Client 显示账号/密码而不显示 Credential Ref。
- 未保存凭证的连通性测试只使用隔离的临时 Credential Ref；凭证测试、模型发现、清理与保存必须互斥，只有临时 Ref 清理成功后才可写入正式 Ref 并保存资源。清理失败必须保留可重试引用并向用户显示失败；K3s 探针的临时 Job、Pod 或模型 Secret 任一清理失败时，整体测试必须失败关闭，不得仅记录日志后显示成功。
- Harbor 镜像从 Project/Repository/Artifact 列表选择；Kubernetes imagePullSecret 是 Cluster + Registry 绑定属性，从 Namespace 中已有 `kubernetes.io/dockerconfigjson` Secret 选择，不属于 Harbor 全局元数据。
- Worker Pool 的用户名为「执行资源池」；普通流程自动创建默认池，只显示 Cluster、最大并发和允许的 Harness。内部 ID、Registry 引用和固定 FIFO 策略不向普通用户展示。
- 六类（扩展后七类，含对象存储 Artifact Store）资源共享同一卡片生命周期：新增或编辑时只有一张活动草稿；当前草稿测试成功后才能卡片级保存；保存后收缩为摘要；编辑回显已保存非密钥值，密码保持写后不可读；取消丢弃草稿。字段变更使旧测试结果失效。
- 删除仅作用于已保存资源，必须先显示确认对话框并由 Host 返回引用影响。Cluster/Registry/Harness/Pool/Git Provider 被其它资源或项目引用时失败关闭并列出引用者；无引用时先提交 Settings 删除，再清理该资源专用 DSH Credential。凭证清理失败不回滚已提交的配置删除，但必须返回可治理的引用和错误。
- 每张卡片就地显示测试与保存/删除阶段日志。测试对象是当前未保存草稿；保存对象是完整 infrastructure 文档中的该资源替换，不得捎带其它未保存草稿。Settings revision 冲突拒绝覆盖。

## 3. P0 前置：DSH 通用外部事件词汇机制

### 3.1 已消除的阻塞

DSH `PersistenceCoordinator` 对每个读取事件执行 `KNOWN_SESSION_EVENT_TYPES` 检查。该集合由 DSH 仓库中的 `SessionEventMap` 声明生成，仓库外扩展不在其中。外部 PactFlow 可以在 live 进程追加和持久 `pactflow/*` 事件，但重启读取会抛出 `SessionFormatUnsupportedError`。

该阻塞已在 DSH 本地上游分支中以通用机制消除；公开安装仍等待这些提交进入受支持的 DSH 发行版。实现没有使用私有 fork、关闭读侧检查、滥用已知事件或静默忽略未知事件。

### 3.2 已实施的上游通用合同

DSH 上游分支已实现一个非 PactFlow 私有的外部事件词汇能力，首版只支持 `required + log-only`，不支持外部 surface event 或在生产者缺失时静默跳过。合同使日志可读性由持久生产者身份决定，而不是由「当前恰好安装了哪些任意插件」决定。

上游合同由 DSH implemented Agent Note `2026-08-29-durable-external-session-event-producers` 持有：

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
- 同一 Host row 提供的 Package-owned Preset Root Service，避免同一 `dsh.client` Package 因多 Loader 来源被拒绝；
- 对 `agent-presets` 的完整配置替换和 `pactflowPresetRoot` 注入；
- 一个只显示名称和说明的 `pactflow` Preset；
- 一个有单一 Remote Method 的 `TypertRemoteService`；
- 外部仓库生成的 `./typert` 和 `./remote`；
- 一个挂载 Remote 的 `dsh.client` Package；
- 一个仅在 PactFlow Session 标题区显示的按钮和一个 `shell.overlay` 占位视图。

必须在独立临时 `DSH_HOME` 中验证：

1. 从预构建 tarball 单命令安装，不执行源码 `prepare`。
2. `dsh --profile web --dump-config` 显示 PactFlow Bundle layer、单一 Host/Client row、其提供的 Root Service 和完整 `agent-presets` 配置。
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

`listSessions()` 只提供候选 Session 和创建时 Header。项目发现必须读取 Session 事件并恢复当前 `agentPreset` Projection；这是因为 DSH 允许空白 Session 在第一次执行前通过 `agent-preset/selected` 改变模式。对非终态项目，恢复 Projection Cache 加日志尾部，然后与 Git、K3s 和活动 Subagent 对账。禁止 Settings 项目注册表。

本地 Subagent Run 与 K3s Run 遵循不同的冷恢复语义：K3s Job 具有可重连的外部身份，Host 重启后按 Job 真实状态续租或结算；本地 `spawn`/`fork` 的执行句柄只存在原 Host 内存中，冷重启后禁止伪造续传。Host 对此类非终态 Run 按持久租约对账：租约内保留所有权以防止双跑，租约到期后幂等追加“过期失败”终态，并将同 revision 节点恢复为 `ready`。旧 Run、claim、outcome 和 attempt 必须保留；新派发创建 attempt+1，不覆盖旧记录。

## 6. 里程碑 3：十阶段、DAG 与人工门禁

实现阶段：

```text
backlog → discussion → confirmed → design → planning → executing → code_review → verification → closing → deployed
```

四个显式人工评审点是需求确认、设计批准、计划批准和验证验收。所有推进、拒绝、重做和跳过都通过 Host Service 追加带期望 revision 的事件。

DAG 节点状态为 `pending/ready/claimed/running/blocked/review/succeeded/failed/cancelled/archived`。Claim 只检查当前节点 revision 和 `ready` 状态；Host 在一个无 await 间隔的同步临界段追加 claim 事件。外部 Worker 不参与 claim 事务。

每个 Run 拥有精确 node revision、attempt、provider、claim token、lease deadline、branch、worktree/external job 引用和 outcome。第一个有效终态结果获胜；重复或过期结果不改变状态。

安全重试不复用 claim：只有旧 Run 已终态且节点仍是 `failed/cancelled`，或本地非终态 Run 已完成过期回收时，才能用节点当前 revision CAS 恢复 `ready`。存在任何未过期的 `claimed/running/blocked` Run 时失败关闭，不允许并发重派。

## 7. 里程碑 4：Agent Tool、Workflow 与本地 Worker

实现 `pactflow` Preset 的完整 Agent-plane 组合，以当前 DSH standard Preset 为行为参考而非运行时继承。包含零脉 Persona、稳定 System Prompt Section、产品 Skill、有界模型工具和 Workflow Consumer。

工具面保持窄：查询当前项目/需求/DAG，创建或调整需求，提交人工决策请求，派发/重试/中断 Worker，报告结果和发起验证。完整详情通过 Skill 和 Remote 查询，不用大量核心 Tool Schema 重复。

本地开发使用 DSH Subagent/Workflow 注册的 Provider，不直接创建非所有的 Agent。子 Session 与根项目会话的权限、取消、续作和结果关系可持久追溯。

当本地 Worker 因 Host 重启失去内存句柄时，恢复器只能根据持久 Run 和租约做决策，不将“会话已恢复”冒充“Worker 已恢复”。过期回收与显式重试都必须可幂等、受 revision CAS 保护，并在 Session Event 中留下可审计的旧 Run 终态和新 attempt。

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

### 9.3 逻辑 Worker Pool 调度合同

- 每次 K3s 派发先解析 Pool、Cluster、Template 和 Registry 的不可变快照，再进入 Pool 调度器；排队后的运行不因 Settings 热更而更换资源。
- 每池最多同时运行 `maxConcurrency` 个 Job；其余请求按 Host 接收顺序 FIFO 等待，取消的等待者不消耗容量。
- 获得容量后才创建 K3s Job；Job 成功、失败、取消、超时或创建异常都必须在 `finally` 边界释放容量并唤醒下一个等待者。
- 调度状态对 UI 提供只读快照：Pool ID、上限、运行数、等待数和策略；不包含 prompt、凭证、Git URL 或 Worker 输出。
- Profile 重启后 Host 从 Session Run 事件和 K3s Job 真实状态重建正在运行的容量占用；纯内存等待者不冒充已持久任务，必须由可持久调度事件恢复后才能声称完整冷恢复。

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

- `implementation-status` 只保留当前里程碑、最后已验证提交、通过/失败命令、精确 blocker 和下一安全动作。
- 每个里程碑在验证后创建一个自包含中文 commit，让 Git 成为恢复 carrier；禁止微提交调试流水。
- 检索只读直接 owner 文件和生成目录，不在每轮重新扫描 DSH 全仓。
- 长任务每小时运行能力治理回顾；只在已证明可复用且明显提效时扩展现有 Skill/脚本，不为仪式新建资产。

### 12.4 停止条件

只有以下条件停止自主推进：上游 DSH 拒绝或不提供安全的外部事件词汇机制；发现零源码修改与必需能力不可兼得；需要创建/推送外部仓库、新凭证或权限扩大；相同验证失败三次且无新证据；或用户产品决策会改变范围、数据含义或安全边界。

## 13. 当前状态和外部进入条件

里程碑 1—7 的本地实现与验证均已完成：Bundle 安装/卸载、领域事件与冷恢复、十阶段/DAG、Agent Tool、本地 Worker、原生 Web 控制台、Git/Gitea 合同、真实 K3s 四 Harness、升级恢复和服务生成器均有证据。当前实现提交、命令结果和真实环境边界由 `implementation-status-实施状态.md` 持有。

公开稳定发布只剩三项外部状态：

1. DSH 通用前置分支通过上游评审、合并并进入受支持发行版；插件不得要求用户使用源码 worktree。
2. npm 发布与包名安装已完成：0.2.0 的真实用户验收发现 Typert 404 并 deprecate；0.2.1 使用裸 package identity 修复 Host Remote 注册，在全新 Profile 中验证安装、真实 health、启动、卸载后 404 与清洁启动。
3. 插件正式 Gitea 远端、0.2.1 预发布资产、真实受保护 Pull Request 创建/合并、默认分支更新和临时资源清理均已完成；它们不再是发布 blocker。

## 14. 安全与可靠性加固合同（0.3.0 源码增量）

本节保持 DSH 核心、Hermes 和旧 `data-governance` 工作区不变。

### 14.1 阶段一：安全权限边界

- `pactflow_record_review` 必须经过 DSH `Approval` 服务；只有 `allowed-once` 才能追加授权评审。授权评审事件携带 `approvalRequestId`、Need revision、证据摘要和 `source: dsh-approval`。旧 0.1/0.2 `approved` 事件只读展示，不解锁新门禁。
- 无授权上下文的 `recordReview` 不作为公开 Remote；Agent 只能发起审批请求，Host 只接受同一 Agent/Need/revision 的已授权结果。
- Git 验证使用用户拥有的 `ValidationProfile` ID。Agent 不再提交任意命令字符串；Host 只运行已登记 Profile，并使用最小环境白名单。历史 raw `validationCommands` 标记为 legacy-untrusted，迁移前不得 Closing。
- K3s Run Spec 增加 run nonce、Spec digest、claim token hash 和 Job UID；结果必须匹配 Job/Pod owner、镜像 digest、Spec digest、branch、commit 和 claim。prompt 不再写入 ConfigMap。

### 14.2 阶段二：持久化、调度与生命周期

- Producer 版本升至 `0.3.0`，继续只读注册 0.1/0.2；新增 `pactflow/run-queued`、`pactflow/run-queue-cancelled` 和 `pactflow/cleanup-recorded`，所有新增 payload 使用 `v: 1`。
- `WorkspaceProjectStore` 提供原子 `putIfRevision(expected, next)`；迁移、Workspace Git、Worker 策略和远程仓库写入均必须使用 CAS。
- 项目配额与全局 Worker Pool 由统一可取消调度器管理。Agent `exec.signal` 必须传入内部派发路径；队列有上限、严格 FIFO、幂等释放，并在重启时恢复项目及全局活动占用。
- Closing 清理以持久 cleanup ledger（清理账本）表示，支持 `pending/failed/succeeded`、attempt、错误摘要和下次重试时间；Need 可为 `deployed + cleanup-pending`，但不得丢失清理责任。
- K3s 恢复对临时 Kubernetes/Git/API 错误进行有界指数退避；取消采用子资源先删、Job 后删，404 幂等，非 404 错误不得吞掉。
- Closing 合并前接收并验证 `remoteRef + expectedCommit`，拒绝 force-push、任务集合变化和未经重新验证的旧 integration branch。

### 14.3 阶段三：Schema、Web 与发布验证

- 抽取单一事件/Settings Schema；Projection fold 前解析 payload，校验 Session/Need/Node 归属、revision 单调性和状态迁移；保留 checkpoint/wire 校验。
- Overlay 所有异步操作绑定 Session ID 和 generation，并在关闭时取消；过期响应不得覆盖当前状态。Client 按 Overlay、资源卡、项目配置和 Remote adapter 拆分，保持既有 Slot/Theme/Workspace 合同。
- Harbor/Gitea 列表支持有界分页、去重和 path-preserving URL join；Model/API/Harness 探针必须验证响应语义，HTTP 200 空响应不得标绿。
- 修复 Web E2E scaffold 的本地 `dsh-pactflow` 安装/链接，新增串行 `check:release`，强制执行 `check`、`test:web` 和 `verify:profile`；suite 失败或意外跳过均失败关闭。

### 14.4 兼容、回滚与验收

- 源码 Producer 使用 `0.3.0`，保留 0.1/0.2 只读恢复；旧批准不解锁新门禁，旧 raw 验证命令需用户迁移。
- 每阶段一个可独立验收提交，先在 `codex/pactflow-hardening` 验证，再由 Git owner 收口；不发布 npm，不修改 DSH 上游源码。
- 阶段验收必须覆盖：未授权评审、命令注入/环境泄漏、伪造 K3s 结果、清理重试、Workspace 并发 CAS、队列取消/重启恢复、损坏事件、过期 Web 响应和完整 Web E2E。

### 14.5 2026-09-06 复核后的持续迭代合同

用户已授权按评审建议顺序持续修复并推动闭环；不以旧测试通过替代已发现缺陷的验收。

1. 权限与状态可信性：公开阶段接口禁止直接推进 `deployed`（已部署），交付终态只由宿主完成 Git 收口后产生；人工审批必须显示具体决定、需求修订和有界证据正文。未登记原始验证命令在绑定和执行前拒绝；旧事件保留只读。K3s 新运行和恢复均要求完整安全身份。进一步统一实施节点准入、拒绝后返工及阶段合同。
2. 持久化与运行恢复：完整模式保留配置/身份字段，校验引用及状态迁移；工作区文件采用跨进程锁和失败关闭的损坏处理，外部仓库创建记录操作意图；恢复占用与新准入分离；获得执行槽位后、认领前重新核对取消信号、会话修订、工作区配置及选定资源池/执行模板/模型快照，漂移时拒绝认领、记录队列取消并释放槽位；清理采用精确持久目标及到期重试，修正临时错误分类；Git 收口只校验本次基线和任务集合。
3. 用户流程与发布：统一工作区项目配置在本地/K3s/收口的继承规则：显式会话 Git 绑定优先，缺失时继承工作区绑定，仓库检查、本地派发和收口保持相同语义，不将继承结果回写为会话覆盖；补全验证配置入口及持续投影、真实请求取消、通用任务文案；按职责拆分宿主和客户端；发布门禁明确必要套件执行证据，修复真实集成测试合同并验证受支持的官方 DSH 安装。
4. 完成条件：以上评审项逐项具备失败复现、修复后回归和相称的真实运行证据，重新评审后再执行 Git 主目录收口。当前不发布 npm、不删除 34 个历史无所有者 Pod、不修改 DSH 核心或旧业务工作区。

远端创建恢复合同：创建前以工作区 CAS 保存操作编号、提供者快照、仓库目标、默认分支和精确本地提交；确认创建响应后保存远端地址，再执行条件推送。其它配置写入不得丢弃操作记录。结果不明的创建不得自动重复或凭名称认领；已确认创建的重试只接续同一目标，拒绝本地提交、远端地址或提供者漂移。完成后保留操作记录供审计，不自动删除远端仓库。结果不明的身份对账及界面恢复入口仍属于待完成验收。

工作区锁恢复合同：锁用于本机配置文件；先在唯一临时目录完整写入主机与唯一所有者文件，再原子发布非空锁目录，进程身份编码于唯一文件名。只在本机进程明确不存在时回收；回收者通过原子改名旧所有者文件取得唯一所有权，禁止按年龄抢锁。释放先原子移走完整目录，再清理其内容，不在公开锁路径留下空目录，不递归删除目录。旧格式、未知主机或无法确认进程状态时拒绝自动回收。进程编号复用允许保守阻断，不以错误抢锁换取可用性。升级/回滚必须先停止所有旧宿主写入者，不支持旧目录发布协议与新协议同时写入同一文件；当前不执行运行环境升级。

临时锁治理只匹配当前配置文件的精确暂存/已移走目录命名，非空目录仍须证明本机所有者进程已退出；空暂存目录保留，空的已移走目录可直接移除。不得递归删除、跟随符号链接或按目录年龄清理其它产物。

探针临时资源合同：三个探针的 Job 均声明运行时限与完成后 TTL（1 小时），模型密钥在 Job 创建返回 UID 后尽力绑定 Job ownerReference；正常路径仍以进程内 UID 前置删除为准，绑定失败不影响探针结果。该 TTL 与归属绑定只兜底宿主崩溃窗口，不替代重启后可恢复的探针清理账本；账本仍未实施，不得据此宣称探针清理生命周期闭环。

探针清理账本合同：三个探针在创建任何 Kubernetes 资源前，先向插件持久清理账本写入意图（探针种类、任务/密钥名称、集群连接指纹、创建时间）；创建响应返回 UID 后立即确认补全；进程内精确清理成功后移除记录，清理失败保留记录。账本仅存非凭证字段，原子写入、损坏失败关闭；持久化失败时探针拒绝创建外部资源。宿主启动时扫描账本，按连接指纹（命名空间、kubeconfig 路径、上下文的非凭证哈希）匹配当前 K3s Provider，以 UID 前置精确清理并 404 幂等；指纹不匹配或身份未确认（崩溃于创建确认窗口）的记录保留责任，每次宿主启动重新尝试，一律不按名称删除；身份完整但清理失败的记录由启动监督按有界退避重试。

真实 Gitea 收口测试要求预先配置默认分支保护，脚本不得自动变更仓库权限。该套件的审批和执行器夹具仅隔离非 Git/Gitea 边界，不作为人工审批界面或真实 Worker（执行器）的验收证据；完整发布矩阵仍须独立证明这些真实路径。

验证配置用户入口位于现有零脉项目面板：按稳定编号编辑命令、JSON（结构化数据）参数数组、超时和默认收口选择，复用共享校验模式。保存仅登记，不执行所配置的验证命令；已保存编号不可直接改名，支持撤销未保存草稿。仅改变默认选择时不重写配置目录或递增其条目修订；提交完整目录时只递增实际变化条目的修订，过期条目修订继续拒绝。工作区写入仍遵循 CAS（比较并交换）。

## 15. 目标架构对照与收口计划（0.3 加固收尾）

基线：[目标架构](architecture-目标架构.md)（2026-09-06 立基线）。本节把"目标 vs 现状"的差距固化为显式合同，满足其 §7 的闭合规则：每条终局能力要么有验收证据，要么在本节标记为缺口并给出合同。本节组织并扩展 §14.5；§14.5 既有合同继续有效，直至对应条目在本节被替代或完成。条目进展只记录于实施状态，本节不维护状态。未列入缺口矩阵的既有回归一律不得削弱。

### 15.1 能力差距矩阵

对照目标架构 §3 十条能力。阻断类型：`A`=可直接实施（冻结范围）、`B`=需真实环境授权、`C`=阻断于上游 DSH 发行版、`D`=阻断于用户决策。

| 能力 | 已验证现状（2026-09-06） | 剩余缺口 | 阻断 |
| --- | --- | --- | --- |
| 1 官方生命周期 | 隔离官方 0.1.2-rc.1 安装/卸载曾通过；启动阻断于 `externalEventProducers` 缺失并显式报错 | 受支持官方发行版上的安装/启动/重复安装/卸载/清洁启动验收；升级路径验收；按官方新版本定期复核 | C |
| 2 项目身份 | 投影筛选、全局启动扫描、冷恢复占用登记已验证（控制器恢复为测试替身） | 真实官方发行版上的恢复验收 | C |
| 3 十阶段与人工门禁 | Approval 授权链、旧批准只读、证据正文与大小校验已验证 | 真实人工审批界面验收；节点准入、拒绝后返工及阶段合同统一（目标架构 §6.1 待确认） | B+D |
| 4 DAG 编排 | 引用缺失/跨需求/循环/阶段跳跃/终态复活/运行身份校验矩阵已闭环 | 无已知缺口；随真实环境验收复验 | — |
| 5 双执行路径 | K3s 四重身份、绑定失败 UID 补偿、创建分支取证、精确清理、恢复监督、启动对账、创建/清理调用独立时限（30 秒截止 + 竞速兜底）、跨项目公平性与队首严格性证据已验证；真实支线历史通过 | 真实 K3s 验收：运行、清理矩阵、TTL 回收、探针账本对账、真实跨重启；真实 worker 支线复跑 | B |
| 6 用户验证配置 | 面板入口、登记、共享模式、条目修订行为已验证（含浏览器）；跨条目修改经宿主保存入口到授权核对的传导已闭环 | 真实环境执行证据 | B |
| 7 代码收口 | 收口链、任务集合第一父链核验、精确清理目标、合并后恢复已验证（真实临时 Git） | 真实 Gitea 收口复跑（含默认分支保护只读前置检查） | B |
| 8 持久恢复 | 启动扫描、准入屏障、清理监督、探针清理账本、锁崩溃回收、释放路径中断恢复已验证（本机文件系统 + 替身） | 真实进程崩溃与存储落盘验收；锁跨操作系统；锁升级/回滚混写禁止的演练 | B |
| 9 资源化基础设施 | 六类卡片生命周期、健康存储、探针语义/脱敏/取消/日志溯源、结果字段与脚本表面敏感数据审查已验证；第七类对象存储（artifact-ref-handoff）登记与门禁见该 change | 真实 Harbor/Gitea 探针复验 | B |
| 10 原生 Web | 实时投影、会话隔离、取消接线、验证配置编辑、容量与工作区配置失效重查、移动视口已验证（隔离浏览器 8 通过 8 环境跳过）；宿主拆分至 2753 行、设置拆分至 646 行（行为基准对照通过） | 跨卡片未保存草稿并存验证（需资源卡夹具）；完整 `check:release` 真实运行（网页零跳过 + 官方安装验证） | B+C |

### 15.2 工作流组织

按阻断类型组织为五条工作流，`A` 项按下列优先序串行推进（唯一写入方），每项完成即进入下一项：

- **A1 创建/清理调用独立时限**：探针与运行路径的 Kubernetes 创建/删除调用增加独立时限与取消贯通，不通过竞争返回遗弃已创建资源；持久化意图先行保证崩溃可对账。验收：挂起调用注入回归 + 时限边界受控时钟测试。
- **A2 敏感数据审查**：探针结果其余字段与容器侧日志策略按"已知密钥先脱敏后截断"的同等标准审查并补回归；不扩大为任意未知秘密检测的声明。
- **A3 宿主拆分**：`index.ts` 按既有职责边界（调度、收口、清理、探针、设置适配）拆分为模块，导出与行为不变，逐模块以现有测试对照；拆分不得与行为修复混合验收。
- **A4 设置模块拆分**：`client/settings.tsx` 按卡片职责拆分，保持卡片生命周期合同。
- **A5 容量与工作区配置实时投影**：浮层对容量与工作区配置接入持续订阅或失效重查，与 §14.5.3 的持续投影合同对齐。
- **A6 调度公平性与关闭语义证据复核**：补跨项目公平性与关闭后语义的证据缺口，不改变 FIFO 合同。
- **A7 锁与并发治理补验**：多恢复者同刻回收、指令边界故障注入的隔离测试；跨操作系统差异以条件测试显式标记，不在 macOS 上虚构通过。
- **A8 网页边界验证**：移动视口、跨卡片草稿并存的浏览器验证。
- **A9 验证配置跨条目修订复核**：真实使用路径复核修订行为。
- **A10 创建结果不明对账（目标决策 2 选 A，2026-09-06）**：宿主提供两个入口——只读候选查询（按意图的所有者与名称列出候选，展示与意图的逐项比对：精确名称、默认分支、可见性、描述中是否含操作编号线索；不做任何持久化）与人工确认（请求携带精确仓库编号，宿主按编号复核所有者/名称/可见性/默认分支与意图精确一致，才以 CAS 将 `creating` 持久化为 `created` 地址；确认后由既有推送路径接续）。描述与操作编号仅作线索；编号复核不匹配一律拒绝且不落任何写入；非 `creating` 状态两入口均拒绝。验收：候选只读性、四类不匹配拒绝、404 拒绝、确认后接续推送完成，均以隔离替身 + 真实临时 Git 先失败后通过。
- **决策 1 选 B（2026-09-06）已被替代**：`docs/architecture-目标架构.md` §6 决策 1 的用户裁决（2026-09-12）要求所有实际执行代理调度先通过原生选择确认具体方案，明确替代「就绪即可派发、无方案确认」。代码已按新裁决收紧，本条保留仅为记录被替代的历史约定，**不得再据此拒绝收紧**。**决策 3 选 B**：远程企业平台列入永久非目标，无实现工作。

- **B 需真实环境授权**（脚本与合同可先行就绪，执行前逐项确认精确范围）：真实 K3s 运行/清理矩阵与 TTL 回收、探针账本真实对账、真实跨重启崩溃验收、真实 Gitea 收口、真实人工审批界面、`check:release` 的真实集成部分、真实 worker 支线复跑。
- **C 阻断于上游**：官方发行版安装/启动/恢复/卸载验收；每次官方新版本发布时复核兼容性，不将历史结论当作永久事实。
- **D 阻断于用户决策**：目标架构 §6 的三项；确认后按"目标变更 → 计划合同 → 实现 → 验收"完整流程进入 A 类。
- **E 收尾**：分阶段可独立验收的提交与主目录同步（需授权）；版本收口仍以官方兼容为前置，不发布 npm。

### 15.3 验收与证据规则

- 每项修复：可证伪失败复现 → 最小修复 → 原条件回归 → 风险相称的真实运行验证；先失败后通过。
- `pnpm run check`、`git diff --check` 在每个收口点通过；测试断言与超时不得为通过而削弱。
- `B` 类执行前由唯一写入方给出精确影响清单（目标、分支、合并、清理），取得适用授权后批量执行并留证；凭证不进入任何输出。
- 全部 `A` 类完成且 `B`/`C`/`D` 类闭环后，按目标架构 §7 宣告收口；未运行或跳过的验证在最终报告中显式列出，不制造假闭环。
