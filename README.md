# DSH PactFlow（零脉模式）

DSH PactFlow 是独立的 DeepSeek Harness Profile Bundle。安装到 DSH `web` Profile 后，新会话 Preset 选择器会出现「零脉模式」，并通过 DSH 原生 Host Service、Session Event、Typert Remote、Client Slot、Subagent、Workflow 和 Worker Provider 完成软件开发编排。

本仓库与 Hermes 版零脉互相独立，不共享源码、数据、协议或运行时。

## 当前状态

2026-09-06 官方环境核验：当前 npm 默认 DSH `0.1.2-rc.1` 可以安装插件包，但缺少 `externalEventProducers`（外部会话事件生产者注册能力），插件无法启动。安全与可靠性加固仍在进行中；本地开发分支的测试通过不构成官方兼容或发布证明。详见[当前实施状态](docs/implementation-status-实施状态.md)。

0.2.1 已完成外部 Bundle、事件/Projection、十阶段/DAG、原生 Web、Settings、Git worktree、真实 Gitea admission/closing、K3s、多 Harness/API、恢复和安装卸载实现。公开稳定发布仍取决于三项 DSH 通用能力进入官方发行版；当前版本按 Pre-release（预发布版）交付。

## 开发迭代与需求记录

本插件使用 **OpenSpec（规格管理）** 管理长期行为变更：`openspec/specs/` 保存已生效合同，`openspec/changes/<change>/` 保存需求动机、方案、差异规格和可验收任务清单；验证结果及运行证据入口由 [实施状态](docs/implementation-status-实施状态.md) 记录。真实执行日志仍由宿主会话日志持有，不把日志复制成另一套任务状态。

变更经规格校验、实现和真实验收后再归档；归档需用户授权，不将“代码写完”标记为完成。当前原生执行方案选择见 [需求](openspec/changes/confirm-execution-granularity/proposal.md)、[设计](openspec/changes/confirm-execution-granularity/design.md)、[任务](openspec/changes/confirm-execution-granularity/tasks.md)。

## 会话工作台

「打开零脉」按当前需求提供「进展、执行记录、验收交付」三个视图：查看阶段与阻塞、处理执行器确认、核对评审及真实交付证据。没有正式需求时只显示引导，不自动立项。面板采用 DSH 原生主题与控件，支持明暗主题、键盘焦点循环和关闭后返回原入口。

「挂机设置、移交摘要、保留现场、运行诊断」为次级入口；项目配置跳转到当前会话对应的工作区，全局模型和镜像探测保留在既有设置中。找不到当前工作区时明确提示选择，不能默认打开另一个项目。需求与验收由 [工作台变更](openspec/changes/align-session-workbench-with-dsh/proposal.md) 和其 [交付里程碑](openspec/changes/align-session-workbench-with-dsh/tasks.md) 持有。

## 按需求挂机到代码交付

在零脉会话中先明确一个需求并绑定仓库、执行规格和验证命令，然后打开「零脉」→「挂机设置」→「准备挂机」。预算默认折叠在「调整预算」内，授权预览完整展示全部上限；核对目标仓库、默认分支和预算后，点击「授权并开始挂机」。宿主在这次授权内推进十阶段，优先完整单节点，最终以实际验证和代码合并为完成依据；关闭浏览器不会停止宿主续跑。

可暂停、恢复或停止；发新消息会转为人工接管。默认建议 4 小时、60 次编排模型调用、10 次执行、并发 1。编排调用预算不包含远端执行器内部模型调用，不是费用上限。挂机不扩大原生文件权限、不执行真实部署、不预留常驻执行代理。宿主本身需要持续运行；本地执行器在宿主重启后须重新授权，集群执行按原配置对账恢复。

需求与验收口径见 [挂机需求](openspec/changes/need-autopilot-code-delivery/proposal.md)、[设计](openspec/changes/need-autopilot-code-delivery/design.md)、[执行里程碑](openspec/changes/need-autopilot-code-delivery/tasks.md)。真实模型验收命令为 `pnpm run test:autopilot`，凭证经既有凭证引用解析器注入，使用指定验收仓库。

## 远程 DSH 审批与提问

DSH 执行器的原生审批和问题可回到「打开零脉 → 执行代理待确认」。支持批准、拒绝、单选、多选和文本回答；答案先保存再发送，执行器收讫后单独显示“已送达”。关闭页面或同一执行进程的短暂断线不会丢失问题；取消后的迟到答案被拒绝。

启用方式：在设置的执行器模板中选择 DSH 专用镜像，勾选「启用远程审批与提问」，保存并按提示重启宿主，然后在项目中选用该模板。既有模板默认不启用，不能给普通镜像只勾选开关就声称支持。使用随包提供的 [镜像清单](packages/dsh-pactflow/worker/dsh/release-manifest.json) 中 `image` 指定的镜像；`acceptanceImage` 仅用于隔离验收，不用于业务任务。

用户宿主仍以插件方式扩展；镜像内执行器独立固定版本。当前验证了 DSH `0.1.1-rc.2` 的提问提供器接口；较新版本的事件式适配路径尚未做对应镜像验收。任意终端程序自己等待输入不在本版覆盖范围；容器销毁后不恢复原调用栈。宿主凭证服务持有交互签名私钥，容器仅获得只读公钥，不获得集群管理凭证。

需求和方案见 [交互需求](openspec/changes/relay-dsh-worker-interactions/proposal.md)、[技术设计](openspec/changes/relay-dsh-worker-interactions/design.md)、[交付里程碑](openspec/changes/relay-dsh-worker-interactions/tasks.md)。可运行 `pnpm run build:worker-image` 构建分发镜像；先运行 `node scripts/build-worker-interaction-image.mjs --acceptance` 构建测试变体，再运行 `pnpm run test:worker-container` 做断网容器检查。集群界面验收通过 `PACTFLOW_RELAY_IMAGE=<清单中的 acceptanceImage> pnpm run test:worker-interactions` 执行，凭证由既有引用解析器读取。

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
- [同事上手手册](docs/getting-started-同事上手手册.md)（从零安装 + 七类资源配置 + 镜像导入 + 跑通第一条链路）
- DSH 上游研究仓库：`/Users/ty/Codes/deepseek-harness`

## 验证边界

`pnpm run verify:profile` 和发布检查要求通过 `DSH_CLI_ENTRY` 提供已安装 DSH 的 JavaScript 入口，并独立核验其官方来源；不会隐式回退到源码分支。当前官方默认版本的兼容阻断见上文。

仅用于本地开发构建的安装/卸载检查使用 `pnpm run verify:profile:dev`，可用 `DSH_SOURCE` 指定开发源码目录；此结果不是发布证据。

本项目采用 [Apache License 2.0](LICENSE)。
