# DSH PactFlow（零脉模式）

DSH PactFlow 是独立的 DeepSeek Harness Profile Bundle。安装到 DSH `web` Profile 后，新会话 Preset 选择器会出现「零脉模式」，并通过 DSH 原生 Host Service、Session Event、Typert Remote、Client Slot、Subagent、Workflow 和 Worker Provider 完成软件开发编排。

本仓库与 Hermes 版零脉互相独立，不共享源码、数据、协议或运行时。

## 当前状态

2026-09-06 官方环境核验：当前 npm 默认 DSH `0.1.2-rc.1` 可以安装插件包，但缺少 `externalEventProducers`（外部会话事件生产者注册能力），插件无法启动。安全与可靠性加固仍在进行中；本地开发分支的测试通过不构成官方兼容或发布证明。详见[当前实施状态](docs/implementation-status-实施状态.md)。

0.2.1 已完成外部 Bundle、事件/Projection、十阶段/DAG、原生 Web、Settings、Git worktree、真实 Gitea admission/closing、K3s、多 Harness/API、恢复和安装卸载实现。公开稳定发布仍取决于三项 DSH 通用能力进入官方发行版；当前版本按 Pre-release（预发布版）交付。

## 安装

```bash
dsh plugin --profile web add dsh-pactflow@0.2.1
```

该命令由 DSH 将 Package 安装到 `web` Profile，并自动把 `dsh.bundle` 加入配置层。0.2.1 仍等待上游通用能力进入官方 DSH，因此当前只面向使用已验证 fork 的开发者预发布；插件本身不修改 DSH 源码，也不使用隐式 `postinstall`。

GitHub Release 同时提供可校验 tarball 安装入口：

```bash
dsh plugin --profile web add https://github.com/tianyuegithub/dsh-pactflow/releases/download/v0.2.1/dsh-pactflow-0.2.1.tgz
```

- [目标架构](docs/architecture-目标架构.md)（终局意图与完成定义）
- [最终开发计划](docs/development-plan-开发计划.md)
- [当前实施状态](docs/implementation-status-实施状态.md)
- [安装与运维](docs/installation-operations-安装运维.md)
- DSH 上游研究仓库：`/Users/ty/Codes/deepseek-harness`

## 验证边界

`pnpm run verify:profile` 和发布检查要求通过 `DSH_CLI_ENTRY` 提供已安装 DSH 的 JavaScript 入口，并独立核验其官方来源；不会隐式回退到源码分支。当前官方默认版本的兼容阻断见上文。

仅用于本地开发构建的安装/卸载检查使用 `pnpm run verify:profile:dev`，可用 `DSH_SOURCE` 指定开发源码目录；此结果不是发布证据。

本项目采用 [Apache License 2.0](LICENSE)。
