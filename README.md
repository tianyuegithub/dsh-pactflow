# DSH PactFlow（零脉模式）

DSH PactFlow 是独立的 DeepSeek Harness Profile Bundle。安装到 DSH `web` Profile 后，新会话 Preset 选择器会出现「零脉模式」，并通过 DSH 原生 Host Service、Session Event、Typert Remote、Client Slot、Subagent、Workflow 和 Worker Provider 完成软件开发编排。

本仓库与 Hermes 版零脉互相独立，不共享源码、数据、协议或运行时。

## 当前状态

0.2.0 已完成外部 Bundle、事件/Projection、十阶段/DAG、原生 Web、Settings、Git worktree、真实 Gitea admission/closing、K3s、多 Harness/API、恢复和安装卸载实现。公开稳定发布仍取决于三项 DSH 通用能力进入官方发行版；当前版本按 Pre-release（预发布版）交付。

## 安装

```bash
dsh plugin --profile web add dsh-pactflow@0.2.0
```

该命令由 DSH 将 Package 安装到 `web` Profile，并自动把 `dsh.bundle` 加入配置层。0.2.0 仍等待上游通用能力进入官方 DSH，因此当前只面向使用已验证 fork 的开发者预发布；插件本身不修改 DSH 源码，也不使用隐式 `postinstall`。

npm 发布前，外部用户可从公开 GitHub Release 安装同一校验 tarball：

```bash
dsh plugin --profile web add https://github.com/tianyuegithub/dsh-pactflow/releases/download/v0.2.0/dsh-pactflow-0.2.0.tgz
```

- [最终开发计划](docs/development-plan-开发计划.md)
- [当前实施状态](docs/implementation-status-实施状态.md)
- [安装与运维](docs/installation-operations-安装运维.md)
- DSH 上游研究仓库：`/Users/ty/Codes/deepseek-harness`

本项目采用 [Apache License 2.0](LICENSE)。
