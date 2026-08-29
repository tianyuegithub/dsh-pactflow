# DSH 零脉实施状态

- 当前里程碑：2 —— 事件模型、Projection 与冷恢复
- 状态：进行中
- 最后已验证提交：DSH P0 `a4633e650b`、外部 Typert `817b9e6120`；本仓库基线 `564bddb`
- 已通过验证：DSH 架构评审 Agent Note 的 `test:docs`、`doc-sync` 32/32、`doc-typecheck`、双语配对和 `diff --check`
- 已证实 blocker：官方 DSH 读取仓库外 Session Event 时被 `KNOWN_SESSION_EVENT_TYPES` 拒绝，尚无外部注册机制
- 侧车结论：已证实外部事件冷读拒绝链和生成边界；已冻结最小外部 Bundle/Typert/Client/Preset/remove PoC 路径
- P0 合同：DSH proposed Agent Note `2026-08-29-durable-external-session-event-producers` 已写入；本地隔离分支已实施生产者注册、绑定追加、JSONL/SQLite 冷读与卸载/精确重装语义，尚未推送或进入官方发行版
- P0 验证：相关 527/527 测试、全量 typecheck/lint、`doc-sync` 32/32 通过；默认全仓两次各有 1-2 个不同的并发时序 flake，对应文件隔离重跑全部通过
- 里程碑 1：单一 Loader 身份的 `dsh-pactflow` Package 已预构建 Host、Client、Typert、Remote 和 Preset；临时 Profile 的 tarball install、dump-config、带插件启动、remove、无插件重启全部通过
- 发行边界：当前 DSH alpha 包尚未全部发布到 npm，源码 Profile 安装会报 peer 缺失警告，但 Loader 通过官方 in-box 解析成功启动；正式发行前必须在对应已发布 DSH 版本上重跑干净安装
- 下一安全动作：冻结 PactFlow Branded ID、带 `v` payload 的完整事件家族、Projection Unit 和非终态项目冷恢复合同
