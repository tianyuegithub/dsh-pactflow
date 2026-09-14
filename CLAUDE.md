# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

DSH PactFlow（零脉模式）是一个 **DeepSeek Harness（DSH）Profile Bundle 插件**：装到官方 DSH 的 `web` Profile 后，为新会话提供「零脉模式」，用 DSH 原生的 Host Service / Session Event / Typert Remote / Client Slot / Subagent / Worker Provider 编排「需求 → DAG → 执行 → 验证 → Git 收口」的持久工作流。仓库交付物只有一个包：`packages/dsh-pactflow`。

**交流与输出一律使用简体中文**：回复正文、总结、清单、表格、命令说明与打印输出都用中文；英文术语首次出现时括注中文（如 `fail-closed`（失败关闭）、`artifact store`（对象存储）、`narrow port`（窄端口）），命令本身、代码标识符、文件路径与环境变量名保持原样不翻译。结论必须区分**已验证事实 / 工作假设 / 未知项**。

## 项目规则（`AGENTS.md` 是规则 owner，此处为摘要）

- **OpenSpec 是开发管理第一入口**。任何长期行为合同（跨 Host / Agent / Client / Remote / Session Event / Worker Provider）的增删改，一律走 `openspec/changes/<change>` 的 propose → apply → verify → archive；`openspec/specs/` 与 change artifacts 是计划与行为合同的唯一正文 owner。归档需用户授权，**"代码写完"不等于完成**。
- 本仓库是 DSH 零脉插件的唯一源码 owner；**禁止导入、调用、共享或理解 Hermes 零脉**的源码、数据库、协议和运行时。
- 用户宿主的生产安装必须运行在**未修改的官方 DSH** 上；宿主缺通用能力时走独立上游 change 等待发行版，禁止宿主私有 patch 回落。容器内 DSH 执行器可由本仓库维护适配插件与源码补丁，按固定镜像摘要独立分发。
- 所有 Cordis 注册归属 `ctx.effect()` / `ctx.on()` 或显式 disposer；**禁止不可卸载的模块级副作用**。
- 原始凭证不得进入 Session Log、Remote payload、Tool result、Git、argv、截图或持久日志。
- Mock 只用于边界清晰的隔离测试；安装、Bundle 卸载、Typert、Client Module、Session 冷恢复、Git、Gitea、Harbor、K3s 验收**必须走真实路径**。
- 禁止 `reset --hard`、无范围 `restore/clean`、强制推送、提交与当前里程碑无关的文件。

## 依赖前提

`package.json` 的 DSH 依赖全部是 `link:` 到**兄弟目录的 DSH fork checkout**：`../deepseek-harness-pactflow-p0`（主体）与 `../deepseek-harness-pactflow-upstream-pr`（上游 PR 分支）。`vitest.e2e.config.ts` 也从前者导入 `vitest.shared.ts`。这两个目录不存在时 `pnpm install` / build / e2e 均无法进行。Node ≥ 22.19（或 ≥ 24），pnpm 11（`corepack enable`）。

## 常用命令

```bash
pnpm run build          # 默认构建：tsc -b host → generate-typert → tsdown(host/agent) → tsc -b client → tsdown(client)
pnpm run typecheck      # 纯类型检查（--noEmit，不删产物、不打包）；与 build 不是一回事
pnpm test               # 单元测试：vitest run packages/dsh-pactflow/tests --maxWorkers=1（串行）
pnpm run check          # 默认门禁 = build + test + pack:check
pnpm run pack           # build 后打 tarball 到 dist/
pnpm run pack:check     # 校验 tarball 清单：必需产物齐全、无 src/tests/密钥/.ts 等禁止路径
openspec validate --all --strict   # 规格严格校验（外部 CLI，不在 devDependencies）
```

单个测试文件 / 单个用例：

```bash
pnpm exec vitest run packages/dsh-pactflow/tests/closing.spec.ts
pnpm exec vitest run packages/dsh-pactflow/tests/closing.spec.ts -t 'main-advances'
pnpm exec vitest run --config vitest.e2e.config.ts packages/dsh-pactflow/e2e/pactflow-overlay.e2e.spec.ts
```

真实环境验收（各自被环境变量门控，**未运行/被跳过一律不得计为通过**）：

```bash
pnpm run test:web              # e2e 全量（vitest.e2e.config.ts）
pnpm run test:real-worker      # 真实模型 + 本地 Worker，隔离任务工作树提交
pnpm run test:autopilot        # 同一 runner 的 --autopilot 形态（挂机到代码交付）
pnpm run test:real-k3s         # 真实集群 Worker + 四 Harness 探针（DSH_K3S_E2E=1）
pnpm run test:real-gitea       # 真实受保护仓库 PR 收口
pnpm run test:real-approval    # 真实原生审批/提问（需人在浏览器里真实点批准）
pnpm run test:real-probe-ledger / test:real-crash-restart / test:real-todo   # scripts/run-real-suite.mjs
PACTFLOW_RELAY_IMAGE=<release-manifest 的 acceptanceImage> pnpm run test:worker-interactions
pnpm run build:worker-image    # 构建 worker 镜像；--acceptance 构建验收变体
pnpm run test:worker-container # 断网容器检查
pnpm run verify:profile        # 安装后 Profile 校验，需 DSH_CLI_ENTRY 指向已安装官方 DSH 入口
pnpm run verify:profile:dev    # 开发源码版（DSH_SOURCE=<dsh 源码目录>），不是发布证据
pnpm run evidence:collect / evidence:verify   # 真实验收证据采集与 fail-closed 门禁
```

常用环境门：`DSH_K3S_E2E`、`DSH_REAL_CRASH`、`KUBECONFIG`、`PACTFLOW_RELAY_IMAGE`、`PACTFLOW_REAL_ARTIFACT_{ENDPOINT,BUCKET,ACCESS_KEY,SECRET_KEY}`、`DSH_CLI_ENTRY`、`DSH_SOURCE`、`PACTFLOW_ACCEPTANCE_EVIDENCE_DIR`。

## 架构要点

### 四个面（face），一个包

| 面 | 源码 | 产物 | 说明 |
| --- | --- | --- | --- |
| Host | `src/index.ts` + `src/host/*` + 领域模块 | `lib/index.js` | Cordis 服务类，持有全部权限与落账 |
| Client | `src/client/*.tsx` | `lib/client.js`（CJS，`__ModuleLoader__` 包裹） | DSH 原生 Slot/Store/Locale/Theme，无 iframe、无第二层 Web 壳 |
| Agent | `src/agent/index.ts` | `presets/pactflow/plugin/index.js` | 暴露给会话模型的 `pactflow_*` 工具 |
| Worker | `src/worker/*` + `worker/dsh/*` | `lib/worker/*.js` + 镜像 | 容器内执行器桥接、脱敏、日志外置 |

`cordis.patch.yml` 是 Bundle 的配置层补丁：插入 `pactflow` Host row，并让 `agent-presets` 注入 `pactflowPresetRoot`（包自带 preset 目录），一个 Loader identity 同时供 Host 与 client 面。

### 事实源与投影

- **领域状态只有一个持久事实源：DSH Session Event**；`src/domain.ts` 的 projections 与任何缓存永远只是可重建视图。Session ID 即项目 ID，Settings 中不存在第二份项目注册表。
- `domain.ts` 里的 `PACTFLOW_EVENT_TYPES_V0_1 … V0_6` 是**各版本写入过的精确词汇表，必须逐条字面保留、绝不可由新常量推导**——旧事件只读兼容靠它。
- 新增事件类型会提升 external producer 声明版本；DSH 宿主要求同一会话内声明完全一致，**升级前创建的老会话会被写冻结**（已由上游声明升级通道修复，见实施状态 2026-09-14 条目）。改事件词汇前先确认这条影响面。
- 十阶段推进由 `PACTFLOW_NEXT_PHASE` 单一合同驱动：backlog → discussion → confirmed → design → planning → executing → code_review → verification → closing → deployed。

### 窄端口 seam（R12 / `openspec/specs/host-narrow-ports`）

`src/index.ts` 是服务类，但派发、恢复、清理、探针对账、设置适配的实现体在 `src/host/*.ts`，以 `xxxImpl(host, …)` 形式导出，`host` 是 `DispatchHost` / `RecoveryHost` / `CleanupHost` / `ProbeRecoveryHost` 这类**窄接口，不含整个 Cordis `ctx`**。新增宿主逻辑遵循同一模式：能力用窄端口声明（`agents()`、`subagents()`、`logger`、`liveSession`…），行为必须能在无 `ctx` 的宿主替身上被驱动和测试；成员方法留在服务类上，host 对象回路到实例方法，测试的实例级覆盖才继续有效。

### Typert Remote

Host 上的 `@Remote('name')` 装饰器（约 68 个）经 `scripts/generate-typert.mjs`（`WorkspaceTypertGenerator`）生成 `lib/typert.host.*` 与 `lib/typert.remote-client.*`；客户端 `src/client/index.tsx` 用 `ctx.remote.$mount(pactflowRemote)` 挂载并取 `remote.pactflow` 命名空间。**改 Remote 签名必须重跑 build**（typecheck 不生成 Typert 产物）。

### 执行与资源

- 双执行路径共享统一准入与容量调度（FIFO、可取消、重启恢复占用）：本地 DSH Subagent（`src/local-workspace.ts` 独立克隆 + `src/local-preflight.ts` 原生沙箱预检）与真实 K3s 多 Harness Worker（`src/k3s-worker.ts`）。容量两层：项目层 Agent 组合 Worker 数（声明需求，非预留）+ 全局池并发总量（跨项目共享，超限排队不失败）。
- 七类可引用基础设施资源：K3s 集群、Harbor、Gitea、Harness 模板、模型连接、执行资源池、对象存储（artifact store）。删除被引用资源**失败关闭**。
- 大内容不进有界通道：超阈值内容外置为 `s3://…` 结构化 `artifactRef`（`src/artifact-store.ts` 手写 SigV4，零新依赖），通道只传地址 + 摘要 + hash；**零签名 URL**；消费侧先解析校验再执行。
- 每任务一分支一 worktree；Worker 只提交任务分支，**只有宿主在 closing 阶段合并受保护默认分支**后才产生交付终态。K3s 结果必须绑定精确身份（Job/Pod owner、镜像 digest、spec digest、分支、基线提交、claim hash）；删除持久资源一律带 UID 前置条件，404 幂等，身份未确认的资源绝不按名删除。

### TypeScript 工程

`tsconfig.host.json` / `tsconfig.client.json` 用**显式 `files` 数组**（不是 include glob）。**新增任何 `src/**` 文件都必须手动登记到对应工程**，否则既不编译也不进产物。两个工程共用 `tsconfig.base.json`：strict + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` + `noUnusedLocals/Parameters`，源码内 import 写 `.ts` 扩展名（`rewriteRelativeImportExtensions`）。

## 测试约定

- 单元测试（`packages/dsh-pactflow/tests/*.spec.ts`）串行运行，**不以模块方式 import `src/index.ts`**（只当文本读取做静态断言）——默认 vitest 运行没有标准装饰器转换，该转换只在 `vitest.e2e.config.ts` 里。因此服务类的行为要么下沉到 `src/host/*` seam 模块用单测覆盖，要么走 e2e。
- 关键修复遵循**先失败后通过**：先用测试复现生产错误原文，再转绿。**禁止削弱断言、放宽超时或跳过失败项**来换绿。
- 有若干"元测试"守卫仓库自身纪律：`openspec-spec-hygiene`、`real-suite-inventory`、`release-gate`、`acceptance-gate`、`ops-doc-event-count`、`client-composition` 等。改脚本、文档计数或 spec 结构时它们会红。

## 文档 owner 分工（不要混写）

| 文档 | 拥有 | 谁能改 |
| --- | --- | --- |
| `docs/architecture-目标架构.md` | WHY + 终局 WHAT（North Star、终局不变量、永久非目标） | **仅用户**；Agent 只能提案 |
| `openspec/changes/`、`openspec/specs/`、`openspec/config.yaml` | HOW + 顺序 + 行为合同 | 唯一计划 owner |
| `docs/implementation-status-实施状态.md` | WHERE-now + 验证证据，**按批次追加、最新在顶部** | 按证据更新 |
| `docs/CURRENT_STATUS-当前状态.md` | 当前每项能力的结论与证据指针（手工维护的只读视图） | 收口时同步 |
| `AGENTS.md` | 协作规则 | 用户 |

实现细节不进架构文档；发现的问题分三类分流：目标本身有缺陷 → 向用户提案；目标无误尚未做到 → 走 OpenSpec 合同；纯实现细节 → 只进代码、测试与实施状态。

## OpenSpec change 结构

`openspec/changes/<change>/` = `proposal.md`（Why / What Changes / Capabilities / Impact，New·Modified Capabilities 必须与 `specs/` 子目录双向一致）+ `specs/<capability>/spec.md`（Requirement + Scenario，含 fail-closed 行为）+ `design.md` + `tasks.md`（只写可验收里程碑）。归档后并入 `openspec/specs/<capability>/spec.md`，change 目录移入 `openspec/changes/archive/<date>-<name>/`。人读正文用中文，Requirement/Scenario 结构标题与 SHALL/MUST 等规范关键词保留英文。
