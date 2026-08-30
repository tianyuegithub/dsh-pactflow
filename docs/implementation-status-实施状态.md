# DSH 零脉实施状态

- 当前里程碑：7 —— 安装升级、持续运行与发布总审计
- 状态：`CONDITIONAL_GO（有条件可发布）`；里程碑 1—7 的本地与已授权真实环境范围已完成
- 最后已验证提交：DSH 通用能力分支 `aa888ad0fb`；Bundle 仓库以当前 `main` HEAD 为准

## 已完成合同

- 外部 Bundle：单一 Loader 身份交付 Host、Agent Preset、Client、Typert 和 Remote；临时 Profile 的 tarball 安装、配置展开、启动、卸载和无插件重启已通过。
- 持久事实：0.2.0 写入 13 类带 `v: 1` 的外部 Session Event，并以 read-only 注册兼容 0.1.0 的 12 类精确词汇；5 个 Projection、十阶段与四个人工门禁、DAG revision CAS、Run claim/renew/settle、租约边界和第一终态获胜已通过回归测试。
- 当前模式权威：`SessionHeader.agentPreset` 只表示创建时模式；项目发现、授权和冷恢复以 `agentPreset` Projection 的当前值为准，裸 Host 嵌入才回退到 Header。Settings 不维护第二项目注册表。
- 本地 Worker：零脉 Preset 暴露 8 个作用域编排工具，并组合 Bash、文件读写/搜索与工作区指令等编码能力；`dispatchLocalNode()` 使用 DSH 原生 Subagent Runtime，父 Provider/prompt 预检先于 claim，自动续租，失败和基础设施拒绝均持久终结。
- Git worktree：DSH 通用 `SubagentStartRequest.cwd` capability 已在独立上游分支完成；零脉可绑定无密钥远端身份，从远端跟踪分支冻结 base commit，由 Host 生成任务分支与 DSH Home 下的 worktree，并只接受该分支上干净、可追溯的后代 commit。
- Git 同步与验证：项目可保存 HTTPS 用户名和 DSH Credential Ref，不保存 token；Host 在清除凭证环境后执行结构化 `{command,args,timeoutMs}` 验证，复核 commit/clean tree，再用私有临时 AskPass push 任务分支并由根 checkout fetch/比对 commit。真实 Basic Auth Smart HTTP 集成测试通过，验证失败不会 push。
- K3s Provider：使用 Kubernetes Client、不可变 ConfigMap/Job、digest 镜像、无 ServiceAccount token、非 root UID/GID 1001、SecretKeyRef、严格 SSH known_hosts 和 0 backoff；Pod 只 push 任务分支并通过 termination document 报告，Host fetch/快进本地 worktree、执行验证后才结算。Agent 恢复时会按持久 Job/spec 对账，接受租约内已完成结果、继续等待活动 Job、取消过期 Job或失败关闭缺失 Job。
- Harness/协议矩阵：Harbor 实际项目为 `datavdl`，治理后镜像精确为 Claude Code、Codex、OpenCode、DSH 四个 digest；协议分别固定为 Anthropic Messages、OpenAI Responses、OpenAI Chat Completions、OpenAI Chat Completions。`probeHarness` Remote 与原生模板表会显示 template/image/model/baseUrl/API mode/真实 prompt、逐步状态和有界输出；四个真实 K3s Harness 探针均返回 `hi` 并自动清理 Job。
- Settings 与测试 UI：`pactflow` Settings namespace 持久化非密钥 K3s/Harness 元数据并声明 restart-applied；原生 Plugins 配置卡可查看模板、透明编辑/禁用并持久保存。控制台模板表提供 API/Harness 双测试，默认真实内容 `say hi to me`，显示 path/payload、阶段和滚动输出；四种协议的直接 API 探针与四个 Harness 探针均通过。
- Gitea admission：Git 绑定保存 credential-free API base/owner/repo/token Credential Ref；Host 只读核验仓库 full name、默认分支、归档状态、branch protection、required approvals、status checks 和 merge style，Remote/UI 不返回 token。专用 `PACTFLOW_GITEA_API_TOKEN` 以最小 `write:repository + write:user` scope 保存于权限受控 DSH Credentials。
- Closing：只有 Need 位于 closing、最新 verification review 批准、全部 DAG 节点成功、Gitea 默认分支受保护且没有未满足 approvals/status checks 时，Host 才在隔离 worktree 合并任务 refs、复验、push integration branch、创建并合并 PR、核验默认分支 ancestry、记录 release event 并推进 deployed。真实 Gitea 1.22 验收发现 PR 创建后的异步 405 窗口，Client 现等待精确 head 可合并并只重试 transient 状态；永久错误失败关闭。完成后精确删除 integration/task worktree、本地/远端任务分支及 K3s Job/ConfigMap。
- 原生 Web：外部 Client Module 的条件 Header Action 与 `shell.overlay` 读取真实 Projection/Remote；冷 Session 可恢复并显示 Project、Need、DAG 和 Run，不存在 iframe、第二 Web 壳或 mock 数据。

## 最新真实验收

- `pnpm run test:real-worker`：真实浏览器选择零脉模式，真实 DeepSeek 父 Agent 调用初始化、Git 绑定、Need/Node 创建与 Git 派发工具；DSH `spawn` 子 Agent 在独立 worktree 创建文件、验证、`git add/commit`，Host 校验 branch、clean tree、base ancestry 和 commit 后记录成功 `pactflow/run-settled`。
- `pnpm run test:real-k3s`：真实 DSH K3s Pod 基于 `tianyue/zeromai-demo` base commit 创建证明文件并提交/push 随机任务分支，Host fetch 到对应本地 worktree、运行 `/bin/test` 并成功结算；测试 Job、ConfigMap 和远端分支已全部删除。
- `pnpm run test:real-gitea`：在受保护的 `tianyue/pactflow-acceptance/main` 上，由零脉 Host 创建任务与 integration 分支、真实 PR、等待异步 mergeability、合并、更新 main、记录 release/deployed，并清理全部临时分支和 worktree。
- npm 包名安装：在全新 `DSH_HOME` 中执行 `dsh plugin --profile web add dsh-pactflow@0.2.0`，验证 Package 下载、Bundle/Preset 激活、真实 Web 启动、卸载与清洁启动全部通过。
- 凭证只由测试启动器从 DSH Credentials 读取并作为子进程环境传入；原值未进入 argv、URL、Session Log、Tool result、测试输出或 Git。
- 调试修复了两个真实边界：活动模式必须读 Projection，而非不可变 Header；Preset 内部 Package 必须包含 name/version，才能通过 DeepSeek request extension inventory 校验。

## 当前边界与下一安全动作

- 完整任务矩阵：Claude Code、Codex、OpenCode、DSH 均已在真实 K3s Pod 中修改 `zeromai-demo`、测试、commit/push，Host fetch 到独立 worktree 并运行 `git diff --check` 后成功结算；三条新增矩阵与既有 DSH case 均已删除 Job、ConfigMap 和远端测试分支。
- 离线恢复：`dist/` 包含 0.2.0 npm tarball、插件完整 Git Bundle、DSH 三提交通用前置分支完整 Git Bundle 和 `SHA256SUMS`；三项校验与两份 Bundle 完整历史验证均通过。
- npm 分发：Package 采用 Apache-2.0，所有未发布的 DSH/Cordis/React in-box peer 保留版本声明并标为 optional，由 DSH 安装本身解析；用户通过官方 `dsh plugin --profile web add dsh-pactflow@0.2.0` 安装。
- 公共发现：源码同步到 `https://github.com/tianyuegithub/dsh-pactflow`，带 `dsh-plugin`、`deepseek-harness`、`pactflow`、`multi-agent` topics；GitHub Release tarball 与 npm 包名都走 DSH 官方安装命令。
- npm 发布：`dsh-pactflow@0.2.0` 已发布，`next/latest` 指向该版本；唯一 `latest` 无法由 npm 删除，因此设置可逆 deprecation 警告，明确上游前提。7 天 granular publish token 按产品 Owner 要求暂时保留，便于测试期修复重发。
- 尚未完成：DSH 三项通用能力尚未进入官方发行版。设置卡仍是透明 JSON 编辑器，后续可增强为逐字段表单但不阻塞配置能力。
- 下一安全动作：完成产品 Owner 实际验收；上游能力进入正式 DSH 后解除 0.2.0 deprecation 或发布新的稳定版本。
