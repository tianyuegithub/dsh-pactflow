# DSH 零脉实施状态

- 当前里程碑：6 —— Git/Gitea、K3s/Harbor 与多 Harness Worker
- 状态：进行中；里程碑 1—4 已完成，里程碑 5 的原生控制台基础链已完成
- 最后已验证提交：DSH 通用能力分支 `817b9e6120`；Bundle 仓库 `5810c89`，本轮真实 Worker 增量待提交

## 已完成合同

- 外部 Bundle：单一 Loader 身份交付 Host、Agent Preset、Client、Typert 和 Remote；临时 Profile 的 tarball 安装、配置展开、启动、卸载和无插件重启已通过。
- 持久事实：12 类带 `v: 1` 的外部 Session Event、5 个 Projection、十阶段与四个人工门禁、DAG revision CAS、Run claim/renew/settle、租约边界和第一终态获胜已通过回归测试。
- 当前模式权威：`SessionHeader.agentPreset` 只表示创建时模式；项目发现、授权和冷恢复以 `agentPreset` Projection 的当前值为准，裸 Host 嵌入才回退到 Header。Settings 不维护第二项目注册表。
- 本地 Worker：零脉 Preset 精确暴露 6 个作用域工具；`dispatchLocalNode()` 使用 DSH 原生 Subagent Runtime，父 Provider/prompt 预检先于 claim，自动续租，失败和基础设施拒绝均持久终结。
- 原生 Web：外部 Client Module 的条件 Header Action 与 `shell.overlay` 读取真实 Projection/Remote；冷 Session 可恢复并显示 Project、Need、DAG 和 Run，不存在 iframe、第二 Web 壳或 mock 数据。

## 最新真实验收

- `pnpm run test:real-worker`：真实浏览器选择零脉模式，真实 DeepSeek 父 Agent 调用 `pactflow_initialize/create_need/create_node/dispatch_local`，DSH `spawn` 子 Agent 完成任务，父 Session 记录 `pactflow/run-settled`，Run 与 Node 均为 `succeeded`。
- 凭证只由测试启动器从 DSH Credentials 读取并作为子进程环境传入；原值未进入 argv、URL、Session Log、Tool result、测试输出或 Git。
- 调试修复了两个真实边界：活动模式必须读 Projection，而非不可变 Header；Preset 内部 Package 必须包含 name/version，才能通过 DeepSeek request extension inventory 校验。

## 当前边界与下一安全动作

- 尚未完成：项目 Git/Gitea 绑定、任务分支/worktree、提交证据与本地验证；K3s Run Spec、Secret、Job/Pod 对账；Harbor 模板与 Harness/协议兼容矩阵；远端真实 Worker。
- 下一安全动作：先冻结并实现不含密钥的 Git Project/Run Spec 与本地 git worktree Provider，使用临时仓库证明“一任务一分支一 worktree、Worker 只提交任务分支、Host 验证后才允许 closing”；再接 Gitea 和 K3s。
