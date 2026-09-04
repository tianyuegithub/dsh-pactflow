# DSH 零脉实施状态

- 当前里程碑：6 增量 —— 资源化基础设施与逻辑 Worker Pool
- 状态：`LOCAL_UAT_PENDING（等待本地用户验收）`；代码和自动回归已通过，未提交、未打包、未发布
- 最后已验证提交：DSH 通用能力分支 `aa888ad0fb`；Bundle 仓库以当前 `main` HEAD 为准

## 已完成合同

- 外部 Bundle：单一 Loader 身份交付 Host、Agent Preset、Client、Typert 和 Remote；临时 Profile 的 tarball 安装、配置展开、启动、卸载和无插件重启已通过。
- 持久事实：0.2.1 写入 13 类带 `v: 1` 的外部 Session Event，并以 read-only 注册兼容 0.1.0 的 12 类词汇与 0.2.0 的 13 类词汇；5 个 Projection、十阶段与四个人工门禁、DAG revision CAS、Run claim/renew/settle、租约边界和第一终态获胜已通过回归测试。
- 当前模式权威：`SessionHeader.agentPreset` 只表示创建时模式；项目发现、授权和冷恢复以 `agentPreset` Projection 的当前值为准，裸 Host 嵌入才回退到 Header。会话 Need/DAG/Run 仍由 Session Projection 持有；工作区级 Git 与 Agent 策略由插件自己的 `workspace-projects.json` 按稳定 `workspaceId` 持有，不进入 Settings。
- 只读编排器：零脉 Preset 在每个真实 Agent Scope 上限制继承工具，只暴露 `read/read_image/glob/grep` 与受控 PactFlow 工具；`bash/pwsh/write/edit` 和模型侧 `pactflow_dispatch_local` 不进入编排器请求头，强行构造调用也由同 Agent 的执行前门禁返回中文引导。所有代码施工必须通过 `pactflow_dispatch_git` 或 `pactflow_dispatch_k3s` 进入隔离任务分支；普通 DSH 会话与 Worker 子作用域自行注册的施工工具不受影响。
- 本地 Run 恢复：Host 继续只读兼容历史 `dispatchLocalNode()` 事件与冷恢复，但当前零脉 Preset 不再向模型暴露同工作区本地派发工具。Host 冷重启后不伪造重连只存在旧进程内存中的 `spawn/fork` Worker；非终态历史本地 Run 在租约内保留所有权，到期后幂等追加过期失败并将同 revision 节点恢复 `ready`。`pactflow_retry_node` 只允许无活动 Run 的 `failed/cancelled` 节点通过 revision CAS 恢复，旧 Run/claim/outcome/attempt 不覆盖，新派发创建 attempt+1。
- Agent 评审门：`pactflow_record_review` 将 requirement/design/plan/code/verification 的 approved/rejected/changes-requested 决策写入当前 Need Session Event，并与 `pactflow_transition_need` 组成可持久、可审计的人工门禁链；不再存在 Host Remote 可用但 Agent 无法记录决策的断路。
- Git worktree：DSH 通用 `SubagentStartRequest.cwd` capability 已在独立上游分支完成；零脉可绑定无密钥远端身份，从远端跟踪分支冻结 base commit，由 Host 生成任务分支与 DSH Home 下的 worktree，并只接受该分支上干净、可追溯的后代 commit。
- Git 同步与验证：项目可保存 HTTPS 用户名和 DSH Credential Ref，不保存 token；Host 在清除凭证环境后执行结构化 `{command,args,timeoutMs}` 验证，复核 commit/clean tree，再用私有临时 AskPass push 任务分支并由根 checkout fetch/比对 commit。真实 Basic Auth Smart HTTP 集成测试通过，验证失败不会 push。
- K3s Provider：使用 Kubernetes Client、不可变 ConfigMap/Job、digest 镜像、无 ServiceAccount token、非 root UID/GID 1001、SecretKeyRef、严格 SSH known_hosts 和 0 backoff；Pod 只 push 任务分支并通过 termination document 报告，Host fetch/快进本地 worktree、执行验证后才结算。Agent 恢复时会按持久 Job/spec 对账，接受租约内已完成结果、继续等待活动 Job、取消过期 Job或失败关闭缺失 Job。
- K3s 终态清理：ConfigMap 与短命 Model Secret 带 Job ownerReference；清理改为先删子资源、再删 Job，两层 404 均视为幂等已清洁。禁止三者并发删除与 Kubernetes GC 竞态产生 409，Closing 不再把已完成 Job 误报为 cleanup failure。
- Harness/协议矩阵：Harbor 实际项目为 `datavdl`，治理后镜像精确为 Claude Code、Codex、OpenCode、DSH 四个 digest；协议分别固定为 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions、OpenAI Chat Completions。`probeHarness` Remote 与原生模板表会显示 template/image/model/baseUrl/API mode/真实 prompt、逐步状态和有界输出；四个真实 K3s Harness 探针均返回 `hi` 并自动清理 Job。
- Settings 与测试 UI：`pactflow` Settings namespace 持久化非密钥 K3s/Harness 元数据并声明 restart-applied；原生 Plugins 配置卡可查看模板、透明编辑/禁用并持久保存。控制台模板表提供 API/Harness 双测试，默认真实内容 `say hi to me`，显示 path/payload、阶段和滚动输出；四种协议的直接 API 探针与四个 Harness 探针均通过。
- Gitea admission：Git 绑定保存 credential-free API base/owner/repo/token Credential Ref；Host 只读核验仓库 full name、默认分支、归档状态、branch protection、required approvals、status checks 和 merge style，Remote/UI 不返回 token。专用 `PACTFLOW_GITEA_API_TOKEN` 以最小 `write:repository + write:user` scope 保存于权限受控 DSH Credentials。
- Gitea 认证兼容：Git/Gitea 绑定显式支持 `giteaUsername`，使 Password Credential 走 Basic Auth；历史 Session binding 未持久 username 时，Host 会按 credential-free base URL + Credential Ref 从当前 Provider 补回非密钥 username。Closing Basic Auth 回归覆盖已验证，不再把密码误作 API token 发送。
- Closing：只有 Need 位于 closing、最新 verification review 批准、全部 DAG 节点成功、Gitea 默认分支受保护且没有未满足 approvals/status checks 时，Host 才在隔离 worktree 合并任务 refs、复验、push integration branch、创建并合并 PR、核验默认分支 ancestry、记录 release event 并推进 deployed。真实 Gitea 1.22 验收发现 PR 创建后的异步 405 窗口，Client 现等待精确 head 可合并并只重试 transient 状态；永久错误失败关闭。完成后精确删除 integration/task worktree、本地/远端任务分支及 K3s Job/ConfigMap。
- 原生 Web：外部 Client Module 的条件 Header Action 与 `shell.overlay` 读取真实 Projection/Remote；冷 Session 可恢复并显示 Project、Need、DAG 和 Run，不存在 iframe、第二 Web 壳或 mock 数据。
- 资源化基础设施：Settings 新增 K3s Cluster、Harbor Registry、Gitea Git Provider、Harness Template、Model Connection 和 Worker Pool 六类引用资源，保留旧 `k3s` 读取兼容但禁止两套调度源同时启用。
- 逻辑容量池：每个 Pool 绑定 Cluster/Registry/Templates，以 FIFO 管理 `maxConcurrency`；排队、等待取消、幂等释放、重启时对活动 Job 恢复容量占用均有代码边界。
- 自动 Gitea 匹配：Git 绑定从本地 remote 读取无凭证 URL，按 host 匹配全局 Provider 并提取 owner/repo；多匹配失败关闭。
- 连接测试：Cluster 读取真实 Namespace；Harbor 调用 v2 ping/project API、只访问配置的 `pactflow-worker` 仓库并识别四类 Harness 镜像；Gitea 调用 version API；Harness 已保存卡片在 K3s 中拉取镜像、运行独立 CLI `--version` 临时 Pod，不再错误依赖 Worker Pool 或模型；Model 发送真实消息；Pool 验证资源图。Remote 只返回分阶段脱敏证据。
- 测试凭证事务：未保存的 Harbor/Gitea/模型凭证只写入随机 `_PROBE_` 临时 Credential Ref，测试草稿引用临时 Ref；测试、模型发现、清理与保存共享互斥门禁，保存时先确认临时 Ref 清理成功，再写正式 Ref。取消或保存时清理失败会保留引用以便重试并给出明确反馈；K3s 临时 Job、Pod 或模型 Secret 清理失败会使整体测试失败，不再显示绿色成功。真实浏览器验收确认模型发现期间临时 Ref 数量从 0→1，取消后回到 0，正式 Ref 未被覆盖。
- 设置 UI：六类基础设施资源均为 DSH 原生风格的多行响应式卡片；一次只编辑一张卡片，成功测试且表单未变化时才允许保存。保存后收缩为摘要，支持编辑回显、取消、删除影响检查和二次确认；高级 JSON 仅用于只读排障，容量快照在控制台显示运行/等待数。
- 易用性收口：Kubeconfig 使用 DSH Host 原生文件选择并从文件解析 Context 下拉；Harbor/Gitea/模型页面显示账号和写后不可读的密码框，内部 Credential Ref 隐藏；Harbor 连接成功后从 `pactflow-worker` 自动同步 Claude Code、Codex、OpenCode、DSH 四个模板的不可变 digest，保留人工资源规格；K3s imagePullSecret 由真实服务列表选择。
- 测试可观测：K3s、Harbor、Gitea 和执行资源池的测试直接使用当前未保存卡片草稿；每张卡片就地显示准备、凭证、配置校验、连接、资源发现和详细失败日志，不再把错误写到设置卡底部或浏览器控制台。
- Harness/模型解耦：Harness Profile 只保存工具、Harbor Artifact 和资源规格，Model Connection 独立保存协议、model ID、base URL 和 DSH Credential；Host 在 Run 时组合兼容项并创建 Job-owned 短命 Kubernetes Model Secret。
- 模型发现：模型连接按“协议 → URL/API Key → 加载模型 → 下拉选择 → 真实测试 → 保存”配置，复用 DSH `llm-pi-ai` discovery；结果按 model ID 去重并显示 `name (id)`，当前 ID 未被服务端返回时明确标为未验证。发现失败保留详细错误和显式手工填写入口。
- 可用性状态：六类已保存卡片均显示可用性测试按钮和灰/黄/绿/红状态灯；Host 将最近结果、时间、配置指纹与脱敏分步日志保存到插件独立运行状态，重进页面和重启后恢复，配置变化自动失效，超过 5 分钟标记过期，不做后台轮询。
- Worker 并发与调度：配置向用户只展示名称、运行集群、允许调度的 Harness、同时运行的 Worker 上限和 Harbor 镜像拉取密钥；内部 ID、Registry 引用和固定 FIFO 不显示。Harness 使用可点击选项，缺少兼容模型的项明确禁用；所选 Namespace 的 dockerconfigjson Secret 自动加载，唯一值自动选择。
- 严格插件化项目入口：Client 只注册 DSH 现有 `sidebar.footer.action`，左侧栏底部显示“零脉项目”；不修改工作区菜单、不注入 DOM、不覆盖 DSH 全局 CSS。面板从 Workspace API 读取工作区并通过 Typert Remote 管理插件自有项目数据。
- 工作区 Git 向导：可只执行安全的本地 `git init`（不暂存/提交文件）、识别现有 origin、迁移会话 Git 配置，并在显式二次确认后使用全局 Gitea 创建仓库；AskPass 凭证只进入子进程环境，不进入 argv、URL、日志或项目文件。
- Agent Profile：项目先指定一个 K3s 集群和该集群下的执行资源池，再动态组合多个稳定身份的 `Harness + 兼容模型 + Worker 数量` 规格；同一 Harness 可搭配多个不同模型，重复组合失败关闭。项目可用 Worker 总量由各规格数量求和得出，不再设置第二个手工项目总并发；实际运行仍由全局 Pool FIFO 限流，Run 固化 `projectConfigRevision` 与 `agentProfileId`。

## 最新真实验收

- `pnpm run test:real-worker`：真实浏览器选择零脉模式，真实 DeepSeek 父 Agent 调用初始化、Git 绑定、Need/Node 创建与 Git 派发工具；DSH `spawn` 子 Agent 在独立 worktree 创建文件、验证、`git add/commit`，Host 校验 branch、clean tree、base ancestry 和 commit 后记录成功 `pactflow/run-settled`。
- `pnpm run test:real-k3s`：真实 DSH K3s Pod 基于 `tianyue/zeromai-demo` base commit 创建证明文件并提交/push 随机任务分支，Host fetch 到对应本地 worktree、运行 `/bin/test` 并成功结算；测试 Job、ConfigMap 和远端分支已全部删除。
- `pnpm run test:real-gitea`：在受保护的 `tianyue/pactflow-acceptance/main` 上，由零脉 Host 创建任务与 integration 分支、真实 PR、等待异步 mergeability、合并、更新 main、记录 release/deployed，并清理全部临时分支和 worktree。
- npm 包名安装：0.2.0 暴露了 Host Typert 404；0.2.1 的 Profile 门禁新增真实 cookie exchange 与 `/api/pactflow/health` Remote 验证，覆盖 Package 下载、Bundle/Preset 激活、真实 Web 启动、卸载后 404 与清洁启动。
- 凭证只由测试启动器从 DSH Credentials 读取并作为子进程环境传入；原值未进入 argv、URL、Session Log、Tool result、测试输出或 Git。
- 调试修复了两个真实边界：活动模式必须读 Projection，而非不可变 Header；Preset 内部 Package 必须包含 name/version，才能通过 DeepSeek request extension inventory 校验。
- 真实业务 DAG 与受保护 main 收口：`data-governance` 的 `quality-issue-closedloop-gaps` 七个节点（五功能 + 跨节点 code-review fix + Closing 集成祖先）均通过工作区 `dsh-model` Agent Profile 在真实 K3s Job/Pod 中修改代码/集成分支、commit/push Gitea，并由 Host 隔离 worktree 强制 Maven 验证后结算 `succeeded`。N6 修复了 resume 归属死路、聚合 SLA 双延期、null-safe 精确去重与新重跑结果 ID 关联；N7 保证 6 个已验证 commit 全为祖先且最终 tree 同 N6。五条 review event 均 approved，Gitea PR #1 已合入受保护 `main`=`7676ee267aef0dd3d46d3e28085b74a3428cc868`，Need=`deployed` revision 10，release 已登记，任务/closing 分支与 K3s Job/Pod 已清理为 0。

## 当前边界与下一安全动作

- 完整任务矩阵：Claude Code、Codex、OpenCode、DSH 均已在真实 K3s Pod 中修改 `zeromai-demo`、测试、commit/push，Host fetch 到独立 worktree 并运行 `git diff --check` 后成功结算；三条新增矩阵与既有 DSH case 均已删除 Job、ConfigMap 和远端测试分支。
- 离线恢复：`dist/` 包含 0.2.1 npm tarball、插件完整 Git Bundle、DSH 三提交通用前置分支完整 Git Bundle 和 `SHA256SUMS`；三项校验与两份 Bundle 完整历史验证均通过。
- npm 分发：Package 采用 Apache-2.0，所有未发布的 DSH/Cordis/React in-box peer 保留版本声明并标为 optional，由 DSH 安装本身解析；用户通过官方 `dsh plugin --profile web add dsh-pactflow@0.2.1` 安装。
- 公共发现：源码同步到 `https://github.com/tianyuegithub/dsh-pactflow`，带 `dsh-plugin`、`deepseek-harness`、`pactflow`、`multi-agent` topics；GitHub Release tarball 与 npm 包名都走 DSH 官方安装命令。
- npm 发布：0.2.0 已 deprecate；0.2.1 修复外部 Typert package identity 并保持历史事件兼容。7 天 granular publish token 按产品 Owner 要求暂时保留，便于测试期修复重发。
- 当轮验证：`pnpm run check` 通过，包含构建、13 个测试文件/65 项测试和 13 项发布产物检查；新增覆盖本地 Run 过期回收幂等性、Agent 恢复后定时回收、活动 Run 重试拒绝、revision CAS/attempt 递增、Agent 评审工具、Gitea Basic Auth 历史 binding 兼容、K3s child-first 终态清理、临时凭证清理失败重试与并发替换失败关闭。Gitea main 干净 clone 的 `mvn -o test -pl dg-quality -am` 为 103/103 通过；`dg-ui-hdmy` Vite production build 通过；`dg-ui` 在 Node 22 下以 `NODE_OPTIONS=--openssl-legacy-provider npm run build:prod` 通过。`git diff --check` 通过。全仓 lint 仍有 5.7 万个历史基线问题，不归因本变更。
- 浏览器生命周期验收：9120 本地 UAT Profile 已真实完成 K3s 卡片“新增 → 测试日志成功 → 保存解锁 → 摘要收缩 → 编辑原值回显 → 修改后取消不污染 → 关闭再进入仍持久化 → 删除影响提示与二次确认 → 删除后重载为空”。测试前保存禁用、修改已测试字段后测试失效也已验证；磁盘 `settings.yaml` 最终恢复为 `clusters: []`。
- Harbor 回归验收：真实 `datavdl/pactflow-worker` 通过完整测试并显示绿色联通状态，自动持久同步四个 Harness 模板；不再读取 Prometheus 等其它项目仓库。既有 `datavdl/` 配置自动规范化为 `datavdl`。关闭设置和重启 Host 后，绿色状态与模板仍恢复。
- 模型发现验收：真实 Coding API 使用已保存 Credential 加载并去重为 130 个服务端模型，加上占位项和当前未返回的 `ark-code-latest` 共 132 个唯一下拉值；Anthropic Messages 不支持列表时显示原始兼容错误并出现“手动填写模型 ID”入口，取消编辑不污染保存配置。
- Harness 状态回归：旧列表测试因没有 Worker Pool 误报红色；新合同将 Harness 镜像测试与模型 API 解耦，并使旧合同记录自动失效。已加入执行资源池的 Harness 会按每条资源池路由分别使用对应 K3s 集群和镜像拉取密钥测试；未加入资源池时才对全部配置集群执行独立镜像测试。Harness 模板与执行资源池必须引用同一 Registry，禁止跨仓库混用镜像拉取密钥。Claude Code 真实创建临时 K3s Job、运行 `claude --version`、5.3 秒成功转绿且 Job 清理后集群无残留。
- Worker 调度验收：默认草稿自动选择 K3s 集群、三个具有兼容模型的 Harness 和唯一 Harbor 拉取 Secret；Claude Code 因缺少 Anthropic 模型明确禁用。资源图测试成功，草稿随后取消，未写入用户配置。
- 工作区项目与视觉验收：9120 本地 UAT 通过现有侧栏 Slot 打开项目面板，真实列出 `data-governance`、Git/工作树状态和会话迁移候选。选定视觉方案实现为模块化 Agent 组合器，在 1440×1024 下生成 DSH/Codex/OpenCode 三个规格，无横向溢出、无浏览器 warning/error；重复 Harness/模型组合被拒绝，编辑回填成功。设计对比见根目录 `design-qa.md`，最终结果 `passed`。
- Agent 数量回归：删除可编辑的“项目总并发”，项目可用 Worker 总量改为各 Agent Profile 数量自动求和；旧版持久字段仅保留模式兼容，不再形成额外调度闸门。超过全局执行资源池的瞬时任务由 Pool 统一排队。
- 只读编排器验收：真实新建零脉会话的请求头仅含 15 个只读/受控工具，明确不含 `bash/pwsh/write/edit/pactflow_dispatch_local`；首轮按指令实际调用 `pactflow_view`，Project/Need/DAG/Run 保持零状态且未产生文件修改。真实 Preset 挂载、普通 Agent 隔离和 Worker 子作用域工具恢复均有自动测试覆盖。
- 保存反馈：插件内全部保存按钮统一提供“保存中…”、DSH 原生 Toast 成功提示与包含具体原因的失败提示；长页面底部的持久状态仍保留。真实浏览器已验证 Agent 策略保存与 K3s 资源卡保存两条入口，均在当前视口顶部显示成功消息。
- 侧栏入口对齐：“零脉项目”与 DSH 原生“设置”统一整行宽度、42px 高度、图标起点、内边距、字号、行高和圆角；收起侧栏时两者均为 36×36 圆形按钮。真实浏览器盒模型测量与展开/收起截图均通过。
- 项目配置实际激活：用户批准后，将 `data-governance` 的会话 Git 配置迁移到工作区修订 1，保存三个 Agent Profile 到修订 2，并自动发现/保存 `pactflow-git-data-governance` 到修订 3。存储文件权限为 `0600`，不含密码、Token 或 API Key；页面重载和 Host 进程重启后均恢复修订 3、三个规格和 Git Secret。会话“打开零脉”读取到同一工作区修订 3。
- 尚未完成：Gitea 新仓库创建向导未在额外仓库执行（当前 `data-governance` 已有真实远程，无必要制造第二个仓库）；DSH 三项通用前置能力进入官方发行版仍是公开稳定发布前置。本地 `data-governance` 旧工作区保留 154 个修改/171 个未跟踪的用户既有工作，不与新 Gitea main 强行对齐。
- 下一安全动作：将当前插件增量做精确 Git 提交/推送并重启 UAT 冷恢复验收；不发布 npm 新版本，不改写用户旧 `data-governance` 工作区。
