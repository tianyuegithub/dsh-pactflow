# DSH PactFlow（零脉模式）

DSH PactFlow 是独立的 DeepSeek Harness Profile Bundle。安装到 DSH `web` Profile 后，新会话 Preset 选择器会出现「零脉模式」，并通过 DSH 原生 Host Service、Session Event、Typert Remote、Client Slot、Subagent、Workflow 和 Worker Provider 完成软件开发编排。

本仓库与 Hermes 版零脉互相独立，不共享源码、数据、协议或运行时。

## 当前状态

0.2.0 已完成外部 Bundle、事件/Projection、十阶段/DAG、原生 Web、Settings、Git worktree、Gitea admission/closing、K3s、多 Harness/API、恢复和安装卸载实现。公开发布仍取决于三项 DSH 通用提交进入官方发行版，以及获得授权后完成一次真实受保护 Gitea PR/merge。

- [最终开发计划](docs/development-plan-开发计划.md)
- [当前实施状态](docs/implementation-status-实施状态.md)
- [安装与运维](docs/installation-operations-安装运维.md)
- DSH 上游研究仓库：`/Users/ty/Codes/deepseek-harness`
