# DSH 零脉 CURRENT STATUS（当前状态单一视图）

本文件是**可再生成的只读视图**，回答「此刻每项能力的结论是什么」。它不是计划 owner、不是业务事实源；历史过程保留在
`implementation-status-实施状态.md` 与 `openspec/changes/archive/`，本文件只呈现当前结论与证据指针。

状态取值：`passed`（有相称证据）/ `failed`（有失败证据）/ `blocked`（受阻于上游/授权/决策）/ `not-run`（未运行，不得计为通过）。

**基线**：分支 `codex/pactflow-hardening`；`pnpm run check` = 62 文件 / 515 测试 / 13 包产物，全绿；`git diff --check` 通过；
`openspec validate --all --strict` 通过（spec 数见下）。**本批已提交到本地分支（2 个提交：OpenSpec 治理与文档 / 实现与测试），尚未推送。**

## 1. 隔离层能力（A 类，已有证据）

| 能力 | 结论 | 证据（spec / 测试） |
| --- | --- | --- |
| 凭据与目标绑定（F01） | passed | `git-credential-binding`；`git-credential-binding.spec.ts`（7） |
| K3s 资源身份链（F02/F08） | passed | `k3s-resource-identity`；`k3s-resource-identity.spec.ts`（9）、`run-ledger.spec.ts`（3） |
| 收口精确提交与幂等（F05/F06） | passed | `git-closing-integrity`；`closing.spec.ts`（13，含 `main-advances`/`phase-interrupt-retry`） |
| 依赖代码输入（F03） | passed | `dependency-code-inputs`；`dependency-input.spec.ts`、`task-set-authorization.spec.ts`（2）、`closing.spec.ts#code-input-chain`、`k3s-worker.spec.ts#folds-code-inputs`；**真实集群两节点链已验证**（见下 dogfood） |
| 批准绑定交付对象（F04） | passed | `review-subject-binding`；`approval-subject.spec.ts`（4）、`closing.spec.ts#subject-drift` |
| 本地派发统一准入（F07） | passed | `worker-admission-uniformity`；`local-admission.spec.ts`（2） |
| 展示/错误脱敏（A10） | passed | `credential-safe-display`；`display-redaction.spec.ts`（6） |
| 工具链卫生（A3/A1/A4） | passed | `tooling-hygiene`；`script-hygiene.spec.ts`（5）、`acceptance-gate.spec.ts`（6） |
| 发布产物完整性（A2） | passed | `release-artifact-integrity`；`release-artifact.spec.ts`（14）+ 注入验证 |
| 前端请求顺序（A06） | passed | `client-request-ordering`；`client-request-ordering.spec.ts`（6） |
| 运行时数据新鲜度（R11） | passed | `runtime-data-freshness`；`runtime-freshness.spec.ts`（7） |
| 集群连接身份（A07） | passed | `cluster-connection-identity`；`cluster-identity.spec.ts`（3） |
| 时间合同分离（A02） | passed | `run-time-contracts`；`run-time-contracts.spec.ts`（3） |
| 验证完整性信号（A03 部分） | passed | `validation-integrity-signals`；`validation-integrity.spec.ts`（5） |
| 本地失败保留（A05） | passed | `local-failure-retention`；`local-failure-retention.spec.ts`（2）、`cleanup-retention-guard.spec.ts`（2） |
| 运行预算（A11） | passed | `run-budgets`；`run-budgets.spec.ts`（6，含 `retryNode` 强制 + **输出上限由预算单一权威决定并实际生效**） |
| Harness 能力分级（A10） | passed | `harness-capability-levels`；`harness-capabilities.spec.ts`（9：级别推导 + **不可证级别不虚报**对抗守卫 + **声明可查询**）+ `k3s-cleanup.spec.ts#capability-level`（镜像/API 探针均报级别）+ **真实集群** `pactflow-harness-probes`（四模板 2/2） |
| 只读项目移交（A12） | passed | `project-handover`；`project-handover.spec.ts`（3） |
| 代码输入过期追踪（F03 增强） | **partial** | `code-input-staleness`；检测器与记录已就位并通过测试，但**触发路径当前不可达**（成功节点不可重跑）——见 §4 |
| 宿主窄端口（R12/J9） | passed | `host-narrow-ports`；`host-narrow-ports.spec.ts`（4：cleanup/probe + 派发/恢复均在不含 `ctx` 的宿主替身上驱动）+ `cleanup-retention-guard.spec.ts`（2）。`CleanupHost`/`ProbeRecoveryHost`/`DispatchHost`/`RecoveryHost` 四个端口均已剥离整个 `ctx` |
| K3s 批次收尾阶段（R04） | **passed** | `k3s-batch-finalization`；2026-09-11 真实集群验证 TTL 回收（两次）与零残留归零（两态）；见 `docs/b-class-k3s-acceptance-20260911.md` |
| 保留窗口与陈旧标记（A05 扩展） | passed | `failure-scene-retention-policy`；`retention-policy.spec.ts`（10：窗口/陈旧 + 容量汇总 + 有界测量 + 端到端体积） |
| 保留现场磁盘容量（A05 扩展） | passed | `failure-scene-retention-policy`；`retainedBytes`/`measured`/`overBudget` 只读呈现，`sizeBytes` 有界测量（未测量不谎报总量）；绝不自动删除 |
| 跨进程工作区文件锁 | passed | `multiprocess-workspace-lock`；`workspace-lock-multiprocess.spec.ts`（2：**真实 4 进程**×15 迭代经锁精确=60，无锁对照 <60，防止空转断言）。此前该锁零测试 |
| Worker 工具作用域（A08） | passed | `worker-tool-scope`；`domain.spec.ts#readonly-orchestrator`（Worker 子会话保留 `bash/write/edit` 且 `write` 可执行；编排器仍被拒）+ 真实 `test:real-worker` 通过 |

## 2. 真实环境（B 类）

| 项 | 结论 | 说明 |
| --- | --- | --- |
| 真实 K3s（`test:real-k3s`） | passed | 2026-09-11 复跑：首次 5/6（负载偶发）、立即复跑 6/6；真实模型 + 真实 Job/Pod |
| 真实 Gitea 收口（`test:real-gitea`） | passed | 2026-09-11 **F05 之后复跑**：真实受保护 PR 合并，断言 `merge_commit_sha === release.commit`（精确 merge SHA）且隔离复验路径成立，临时 ref 清零；见 `docs/b-class-k3s-acceptance-20260911.md` §6 |
| 真实 worker 支线（`test:real-worker`） | **passed** | 2026-09-11 **修复后通过**。根因是本仓缺陷：`agent/session-start` 的编排器只读守卫**错误地施加到被委派的 Worker 子会话**，拦截其全部修改类工具（Worker 原话：`every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem`）。修复：守卫仅作用于编排器（`origin='subagent'` 直接返回）；并把 Worker 自身报告折入失败原因以便诊断。change `harden-worker-tool-scope`（已归档） |
| 真实探针账本对账（`test:real-probe-ledger`） | **passed** | 2026-09-11 真实集群 2/2（UID 前置删除 + 404 幂等 + 未确认身份失败关闭）；骨架已实现 |
| 真实跨进程崩溃重启（`test:real-crash-restart`） | **passed** | 2026-09-11 多进程基建（独立宿主子进程 + SIGKILL + 同 DSH_HOME 重启）两次稳定通过；非终态 Run 及精确 K3s 身份从持久事实恢复 |
| 真实人工审批界面（`test:real-approval`） | **not-run** | 需用户本人在原生 UI 操作 |
| `run-real-k3s-batch` 的 TTL/ZeroProof 阶段 | **passed** | 2026-09-11 真实集群运行通过（含修复 namespace 缺失与假阳性风险后复跑） |
| 真实待办网页 dogfood（`test:real-todo`，两节点依赖链） | **passed** | 2026-09-11 真实模型 + 真实 Job/Pod + 真实 Git：A 建 `todo.html`，B 以 A 为代码输入在其基线上文档化；宿主验证 `node test-todo-smoke.js` exit 0；真实浏览器驱动增/勾选/删除/刷新持久通过。**此运行发现并修复 K3s 代码输入断链**；见 `docs/b-class-k3s-acceptance-20260911.md` §7 |
| 真实依赖链矩阵（真实集群） | **passed** | 2026-09-11 完整 `test:real-k3s-batch`：`suites` 阶段 3 套件 6/6（k3s-worker / harness-probes / harness-tasks×3）+ TTL 回收 + 零残留归零；两节点依赖链另见 `test:real-todo` |
| 多宿主并发 | **partial** | 跨进程文件锁已用**真实 4 进程**验证互斥（`workspace-lock-multiprocess.spec.ts`）；跨主机（NFS/共享盘）语义未验证 |

## 3. 上游与决策边界

| 项 | 类型 | 说明 |
| --- | --- | --- |
| 官方 DSH 安装/启动/升级/卸载验收 | C（上游） | 兼容性受 `externalEventProducers` 等能力约束；每次官方新版本发布时复核 |
| 远程企业平台（kubeconfig 托管/多租户/中心服务端） | D（已裁决非目标） | 目标架构 §5 永久非目标 |
| 节点准入时机、严格全局 FIFO | D（已裁决） | 决策 1B / §15-A6；不得收紧/静默更改 |
| `deployed` 枚举语义（merged vs deployed） | D（**已裁决：保持现状** 2026-09-11） | 仍表示「已合并/已交付」；不擅改领域枚举 |
| 不可信代码的强隔离（沙箱/出网策略） | D（**已裁决：保持现状** 2026-09-11） | 维持「本机信任执行 + 容器受限执行」的现有声明，不扩大安全承诺 |
| F03 触发前置「已成功节点重跑」能力 | D（**已裁决：保持现状** 2026-09-11） | `code-input-staleness` 检测器已交付但不触发；不新增该能力 |

## 4. 明确未实现（诚实清单）

- **A11 完整形态**：token/模型调用数用量统计（Harness termination document 无 token 字段，需先扩展 Harness 能力）、「预算耗尽进入 paused/needs-decision」（当前以**显式拒绝**表达，改为持久 paused 属领域状态机变更）。**输出/日志容量上限已交付**（预算单一权威，实际生效）。
- **A10 完整形态**：为 `tool-invocation`/`verification` **增设专门探针阶段并做真实六级实证**——当前二者无可证证据（前者需 Harness runner 上报工具调用，不在本仓所有权内；后者需专门验证阶段），故诚实性上**不虚报**（已显式入合同与测试）；跨 Harness 能力协商未做。
- **A12 完整形态**：卸载前 drain 检查、前端移交入口。
- **A03 完整形态**：宿主侧独立验收基线、按任务类型的最小验证策略、测试基础设施改动单独审查——本批只做了「验证基础设施改动可见」与「零验证可识别」。
- **A05 完整形态**：保留现场 UI 入口与只读查询的界面呈现仍未做；磁盘容量**已交付**（窗口/陈旧标记/容量计量/超预算标记）。
- **A04**：Gitea 保护分支的 `waiting-review/waiting-checks` 协作闭环（当前遇 required approvals/status checks 即拒绝自动收口）；需真实受保护仓库的审核/CI 状态，属 B 类环境前置。
- **R12/J9 窄接口重构**：四个宿主端口（`CleanupHost`/`ProbeRecoveryHost`/`DispatchHost`/`RecoveryHost`）均已剥离整个 `ctx`，改为窄端口；剩余未做的是「跨进程锁/时钟/环境」的显式可注入端口（D 类设计建议），属更大重构。
- **A09**：本文件即该建议的落地；历史批次记录未合并（保留在实施状态与 archive）。

## 5. 证据可靠性说明

- 上表 `passed` 的隔离层结论基于**隔离测试 + 本地 HTTP + 真实临时 Git**；不替代真实集群/官方发行版验收。
- 每个 change 都做了「先失败后通过」；关键改动另有对抗性验证：发布产物（`src` 注入被拦）、任务集合不变量（未授权提交被拒）、
  清理保留（retain 记录零重试）、脱敏（嵌入消息 URL）、F03（依赖链被接受）。
- 多处「首版测试是弱/假通过」被 review 发现并修正：F07（与 Git I/O 赛跑）、A05（清理失败掩盖断言）、脱敏（只处理整串 URL）。
