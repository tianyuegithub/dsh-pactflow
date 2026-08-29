# DSH 零脉实施状态

- 当前里程碑：6 —— Git/Gitea、K3s/Harbor 与多 Harness Worker
- 状态：进行中；里程碑 1—4 已完成，里程碑 5 的原生控制台基础链已完成
- 最后已验证提交：DSH 通用能力分支 `a18ee41c60`；Bundle 仓库 `9110755`，本轮 Git worktree 增量待提交

## 已完成合同

- 外部 Bundle：单一 Loader 身份交付 Host、Agent Preset、Client、Typert 和 Remote；临时 Profile 的 tarball 安装、配置展开、启动、卸载和无插件重启已通过。
- 持久事实：0.2.0 写入 13 类带 `v: 1` 的外部 Session Event，并以 read-only 注册兼容 0.1.0 的 12 类精确词汇；5 个 Projection、十阶段与四个人工门禁、DAG revision CAS、Run claim/renew/settle、租约边界和第一终态获胜已通过回归测试。
- 当前模式权威：`SessionHeader.agentPreset` 只表示创建时模式；项目发现、授权和冷恢复以 `agentPreset` Projection 的当前值为准，裸 Host 嵌入才回退到 Header。Settings 不维护第二项目注册表。
- 本地 Worker：零脉 Preset 暴露 8 个作用域编排工具，并组合 Bash、文件读写/搜索与工作区指令等编码能力；`dispatchLocalNode()` 使用 DSH 原生 Subagent Runtime，父 Provider/prompt 预检先于 claim，自动续租，失败和基础设施拒绝均持久终结。
- Git worktree：DSH 通用 `SubagentStartRequest.cwd` capability 已在独立上游分支完成；零脉可绑定无密钥远端身份，从远端跟踪分支冻结 base commit，由 Host 生成任务分支与 DSH Home 下的 worktree，并只接受该分支上干净、可追溯的后代 commit。
- 原生 Web：外部 Client Module 的条件 Header Action 与 `shell.overlay` 读取真实 Projection/Remote；冷 Session 可恢复并显示 Project、Need、DAG 和 Run，不存在 iframe、第二 Web 壳或 mock 数据。

## 最新真实验收

- `pnpm run test:real-worker`：真实浏览器选择零脉模式，真实 DeepSeek 父 Agent 调用初始化、Git 绑定、Need/Node 创建与 Git 派发工具；DSH `spawn` 子 Agent 在独立 worktree 创建文件、验证、`git add/commit`，Host 校验 branch、clean tree、base ancestry 和 commit 后记录成功 `pactflow/run-settled`。
- 凭证只由测试启动器从 DSH Credentials 读取并作为子进程环境传入；原值未进入 argv、URL、Session Log、Tool result、测试输出或 Git。
- 调试修复了两个真实边界：活动模式必须读 Projection，而非不可变 Header；Preset 内部 Package 必须包含 name/version，才能通过 DeepSeek request extension inventory 校验。

## 当前边界与下一安全动作

- 尚未完成：Gitea 凭证引用、fetch/push 与结构化提交通知后的 Host 更新/验证/closing；K3s Run Spec、Secret、Job/Pod 对账；Harbor 模板与 Harness/协议兼容矩阵；远端真实 Worker。
- 下一安全动作：在当前 Git Run Spec 上接入 DSH Credentials 的 Gitea 引用，完成任务分支 push、Host fetch/验证和冲突失败语义；随后复用同一规格实现 K3s Provider。
