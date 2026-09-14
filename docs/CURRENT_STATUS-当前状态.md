# DSH 零脉 CURRENT STATUS（当前状态单一视图）

本文件是**手动维护的只读摘要视图**（当前无自动生成器；改动事实后在收口时同步），回答「此刻每项能力的结论是什么」。它不是计划 owner、不是业务事实源；历史过程保留在
`implementation-status-实施状态.md` 与 `openspec/changes/archive/`，本文件只呈现当前结论与证据指针。

状态取值：`passed`（有相称证据）/ `failed`（有失败证据）/ `blocked`（受阻于上游/授权/决策）/ `not-run`（未运行，不得计为通过）。

> **历史固化快照（2026-09-11，`36d9057`）**：该提交当时的终态记录，**已不再描述当前基线**（当前基线见下方「基线」段，距此快照 36 个提交）。用户指令「把当前成果固化收尾」。终态：`check` 72 文件 / 561 测试 / 13 包产物全绿；`openspec validate --all --strict` 37/37；46 change 归档 / 37 spec；`origin` 与主目录 `/Users/ty/Codes/dsh-pactflow`（`main`）三方一致；工作树干净。发布物 `dist/dsh-pactflow-0.2.1.tgz` SHA256 `ce9b3537f58fdbd3eb145789b1f191dd2ff512775456c3427574ca1c92edfae0`（构建确定性由「build 前后产物哈希相同 + 测试直接导入产物」保证）。密封扫描收据两份（`…93cb38201725` / `…0178b1d09938`，后者覆盖全部当日代码；结论 `inconclusive`，三族处置见 `docs/security-scan-20260911.md`）。**无待用户裁决事项**；此后启动新工作即属新目标立项（见 §4 与待办清单）。

**基线（2026-09-15 实测）**：分支 `main`，HEAD `f8fddaf`（距上述固化快照 36 个提交）；`pnpm run check` = **104 文件 / 745 用例（738 通过 / 7 按环境门控跳过 / 0 失败）/ 229 套件全过 / 19 个必需包产物**，全绿；
`openspec validate --all --strict` **49/49** 通过（**48 个 spec / 61 个已归档 change / 1 个活跃 change `artifact-ref-handoff`**）。7 个跳过全部来自未武装的真实存储套件（`artifact-store.real` 2、`artifact-handoff.real` 4）与 1 项平台相关预检，**按规则不计为通过**。

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
| 前端请求顺序（A06） | passed | `client-request-ordering`；`client-request-ordering.spec.ts`（6）。**接线已核实**：`project-panel.tsx` 用独立 `refreshGate`/`gitSecretsGate`（`invalidate→next→isLatest`）——即评审点名的 refresh 与 gitSecrets 两个 effect 已有请求身份/取消检查 |
| 运行时数据新鲜度（R11） | passed | `runtime-data-freshness`；`runtime-freshness.spec.ts`（7）。**接线已核实**：`overlay.tsx` 实际调用 `createFreshnessTracker` 与 `PACTFLOW_RUNTIME_REQUERY_INTERVAL_MS` |
| 集群连接身份（A07） | passed | `cluster-connection-identity`；`cluster-identity.spec.ts`（3） |
| 时间合同分离（A02） | passed | `run-time-contracts`；`run-time-contracts.spec.ts`（3） |
| 验证完整性信号（A03） | passed | `validation-integrity-signals`；`validation-integrity.spec.ts`（5）+ `verification-label.spec.ts`（3：**零验证显式标为「无自动验证」**）+ `review-surface.spec.ts`（3：**清单在事件折叠后存活**——修复 `gitResultSchema` 未声明致字段被剥除的真实缺陷；**审批理由携带验证敏感清单/显式「无」**）。零验证与「改了测试配置」均已贯通到人眼前 |
| 卸载前 drain 检查（A12-a） | passed | `uninstall-drain-safety`；`drain-status.spec.ts`（5：无责任/活跃 Run/未完成清理/**冷会话可读**/文档绑定 Remote 名）。新增只读 `@Remote('drainStatus')`，跨会话汇总非终态 Run 与未成功清理，只读不自动清理 |
| 本地失败保留（A05） | passed | `local-failure-retention`；`local-failure-retention.spec.ts`（2）、`cleanup-retention-guard.spec.ts`（2）+ **客户端保留现场只读区**（`overlay` 呈现总数/体积/度量/超预算/逾期，e2e 覆盖） |
| 运行预算（A11） | passed | `run-budgets`；`run-budgets.spec.ts`（6，含 `retryNode` 强制 + **输出上限由预算单一权威决定并实际生效**） |
| Harness 能力分级（A10） | passed | `harness-capability-levels`；`harness-capabilities.spec.ts`（9：级别推导 + **不可证级别不虚报**对抗守卫 + **声明可查询**）+ `k3s-cleanup.spec.ts#capability-level`（镜像/API 探针均报级别）+ **真实集群** `pactflow-harness-probes`（四模板 2/2） |
| 只读项目移交（A12） | passed | `project-handover`；`project-handover.spec.ts`（5：含**包版本与 reader 版本可追溯**）+ **前端只读入口**（`overlay` 导出摘要 JSON + 复制，e2e 覆盖） |
| 代码输入过期追踪（F03 增强） | **partial** | `code-input-staleness`；检测器与记录已就位并通过测试，但**触发路径当前不可达**（成功节点不可重跑）——见 §4 |
| 宿主窄端口（R12/J9） | passed | `host-narrow-ports`；`host-narrow-ports.spec.ts`（4：cleanup/probe + 派发/恢复均在不含 `ctx` 的宿主替身上驱动）+ `cleanup-retention-guard.spec.ts`（2）。`CleanupHost`/`ProbeRecoveryHost`/`DispatchHost`/`RecoveryHost` 四个端口均已剥离整个 `ctx` |
| K3s 批次收尾阶段（R04） | **passed** | `k3s-batch-finalization`；2026-09-11 真实集群验证 TTL 回收（两次）与零残留归零（两态）；见 `docs/b-class-k3s-acceptance-20260911.md` |
| 保留窗口与陈旧标记（A05 扩展） | passed | `failure-scene-retention-policy`；`retention-policy.spec.ts`（10：窗口/陈旧 + 容量汇总 + 有界测量 + 端到端体积） |
| 保留现场磁盘容量（A05 扩展） | passed | `failure-scene-retention-policy`；`retainedBytes`/`measured`/`overBudget` 只读呈现，`sizeBytes` 有界测量（未测量不谎报总量）；绝不自动删除 |
| 跨进程工作区文件锁 | passed | `multiprocess-workspace-lock`；`workspace-lock-multiprocess.spec.ts`（2：**真实 4 进程**×15 迭代经锁精确=60，无锁对照 <60，防止空转断言）。此前该锁零测试 |
| Worker 工具作用域（A08） | passed | `worker-tool-scope`；`domain.spec.ts#readonly-orchestrator`（Worker 子会话保留 `bash/write/edit` 且 `write` 可执行；编排器仍被拒）+ 真实 `test:real-worker` 通过 |
| 真实套件自清理（新） | passed | `real-suite-hygiene`；`test:real-crash-restart` 清理可验证且失败可见（此前静默泄漏远程分支） |
| 验证脚本可运行（新） | passed | `verification-script-runnability`；`script-hygiene.spec.ts`（7：逐个 `node --check` + 超时常量先于顶层 try）；**`verify:profile:dev` 真实跑通**（此前因 TDZ `ReferenceError` 从未运行） |
| 最小验证策略（A03-b） | passed | `validation-policy`；`validation-policy.spec.ts`（6）。要求组由**人登记、宿主收口强制**（缺失逐项指名），模型零接口；被引用 profile 删除失败关闭 |
| 宿主自有收口基线（A03-c） | passed | `host-owned-baseline`；`host-baseline.spec.ts`（5）。断言命令**存于任务仓之外**，在候选提交上先于任务验证执行，失败阻断收口；证据带 host-baseline 来源持久于收口记录 |
| 预算耗尽持久暂停（A11） | passed | `run-budgets`（扩展）；`node-pause.spec.ts`（4）。节点进入持久 `paused`（落账/可见/派发指名拒绝），显式 `resumeNode` 恢复留痕 |
| 卡片草稿隔离（A8） | passed | `card-draft-isolation`；`card-drafts.spec.ts`（4）+ overlay e2e。按键草稿 store，跨卡片并存不互污；面板关闭两步确认不静默丢弃 |
| 探针读当前已保存配置 | passed | `infrastructure-probe-freshness`；`saved-probe-freshness.spec.ts`（2）。诊断面读当前已保存配置，运行时面仍重启生效，边界显式 |
| 模型探针认证与路径 | passed | `model-probe-auth-fallback`；`model-probe-auth-fallback.spec.ts`（4：401 触发、恰一次、两头互斥、凭证不进日志）、`model-probe-path.spec.ts`（3：`/v1` 不重复拼接，探针与运行时同端点）。火山方舟 Ark 网关实测驱动 |
| 本地执行仓库隔离 | passed | `local-execution-workspace`；`local-workspace.spec.ts`（13）、`local-preflight.spec.ts`（4/5，1 项平台门控跳过）、`local-recovery.spec.ts`（6）+ 真实 `test:real-worker` 通过（`isolated-clone` 派发 → 真实 spawn Worker 提交，26.8 秒） |
| 远程 DSH 审批与提问中继 | passed | `worker-interaction-relay`；`worker-interaction-host.spec.ts`（10）、`worker-interaction-bridge.spec.ts`（10）、`worker-interaction-redaction.spec.ts`（3）+ **真实集群** `test:worker-interactions` 1 项通过（断线重连/浏览器重载/取消后迟到批准拒绝）+ 断网容器 `test:worker-container`。签名私钥留宿主，Pod 只有只读公钥 |
| 按需求挂机到代码交付 | passed | `need-autopilot`；`autopilot.spec.ts`（12）。预算、暂停恢复、宿主持久推进；模型停顿/浏览器关闭/宿主重启不静默丢责任 |
| 原生执行方案选择 | passed | `execution-plan-choice`；`execution-plan-choice.spec.ts`（13）。单节点优先、选择即批准、派发受方案约束；任务/节点/依赖/资源变化使旧批准失效 |
| 会话工作台对齐 DSH | passed | `session-workbench`；`session-workbench-view.spec.ts`（12）+ 浏览器回归 15 项（原生明暗主题、键盘/焦点、草稿、窄屏、长文折叠、错需求预览拒绝） |
| 项目面板按需加载 | passed | `project-panel-loading`；`project-panel-loading.spec.ts`（3）。列表独立就绪、详情与迁移候选按需读取、迟到响应不污染当前选择 |
| 收口认证来源（F05 加固） | passed | `git-closing-integrity`（新增 Requirement 钉死来源）；`closing.spec.ts`（14，含 `binding-auth-source`）、`git-closing-identity.spec.ts`（3）。修复「以任意首个运行的历史规格解析收口凭据」的真实宿主缺陷；**真实受保护 PR #2 合并入 main**（`f64cb9ff`） |
| Web 控制台原生组成 | passed | `client-composition-guard`；`client-composition.spec.ts`（3）。守护完成条件「无 iframe、无第二层 Web 壳、无私有 DSH 源码导入」 |
| 出网目标来源约束 | passed | `egress-url-origin`；`egress-url-origin.spec.ts`（4）。Agent 面只能以注册 id 引用出网目标，不接受任意 URL |
| 大内容外置传址（第七类资源） | **partial** | `artifact-ref-handoff`（**活跃 change，未归档**）；隔离级全绿：`artifact-store`（11）、`artifact-store-binding`（7）、`artifact-upload-gate`（6）、`artifact-retention`（5）、`artifact-channels`（8）、`k3s-artifact-store`（7）、`worker-log-upload`（6）。真实 RustFS 连通已验（SigV4 PUT/GET/HEAD/LIST、后端不返回 versionId）；**5.1/7.1 全链真实验收 not-run**——见 §4 |

## 1.5 仓库纪律守卫（元能力）

这些 spec 不交付用户可见功能，而是**守护仓库自身不被削弱**（改脚本、文档计数或 spec 结构时它们会红）。此前本文件从未收录，但它们同样是「此刻的结论」的一部分。
（`tooling-hygiene` / `real-suite-hygiene` / `verification-script-runnability` 已列于 §1，不重复。）

| 守卫 | 结论 | 证据（spec / 测试） |
| --- | --- | --- |
| B 类影响清单门禁 | passed | `b-class-impact-list-gate`；`impact-list-gate.spec.ts`（5）。变更型运行提供清单则要求**已授权**（`pending` 被拒），未提供则显式告警门禁未施加 |
| B 类阶段武装守卫 | passed | `b-class-stage-arm-guard`；`k3s-batch-stage-guards.spec.ts`。变更型批处理阶段未显式武装即失败关闭，且**在接触真实集群前**就拒绝 |
| 证据采集器覆盖 | passed | `evidence-collector-coverage`；`evidence-collect.spec.ts`（4：收齐/缺项/失败关闭） |
| 证据校验单一路径 | passed | `evidence-validation-single-path`；`acceptance-gate.spec.ts`（6）。调用点必须复用同一实现，不得各自内联 |
| OpenSpec 规格卫生 | passed | `openspec-spec-hygiene`；`openspec-spec-hygiene.spec.ts`（3）。每个 capability 必须带真实 Purpose，不得残留归档工件 |
| 运维文档数字准确 | passed | `operator-doc-accuracy`；`ops-doc-event-count.spec.ts`（3）。手册中各发行版写入/读取的外部事件类数**绑定代码元组**（曾修复 0.2.1 行写 13 而代码写 17） |
| 分发清单版本准确 | passed | `operator-doc-accuracy`（扩展）；`release-manifest-accuracy.spec.ts`（2）。worker 镜像清单的 `hostEventProducerVersion` / `hostPluginVersion` 绑定代码事实，任一侧漂移即失败并指名两侧取值 |
| 发布门禁可诊断 | passed | `release-gate-diagnosability`；`release-gate.spec.ts`（12）。拒绝时必须指名具体责任方，不得只报「不通过」 |
| 发布门禁前置覆盖 | passed | `release-gate-prerequisite-coverage`；`real-web-gate-prerequisites.spec.ts`（4）。门禁前置逻辑自身的确定性分支被测试覆盖（2026-09-15 已离线化，不再依赖真实集群可达） |

## 2. 真实环境（B 类）

| 项 | 结论 | 说明 |
| --- | --- | --- |
| 真实 K3s（`test:real-k3s`） | passed | 2026-09-11 复跑：首次 5/6（负载偶发）、立即复跑 6/6；真实模型 + 真实 Job/Pod |
| 真实 Gitea 收口（`test:real-gitea`） | passed | 2026-09-11 **F05 之后复跑**：真实受保护 PR 合并，断言 `merge_commit_sha === release.commit`（精确 merge SHA）且隔离复验路径成立，临时 ref 清零；见 `docs/b-class-k3s-acceptance-20260911.md` §6 |
| 真实 worker 支线（`test:real-worker`） | **passed** | 2026-09-11 **修复后通过**。根因是本仓缺陷：`agent/session-start` 的编排器只读守卫**错误地施加到被委派的 Worker 子会话**，拦截其全部修改类工具（Worker 原话：`every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem`）。修复：守卫仅作用于编排器（`origin='subagent'` 直接返回）；并把 Worker 自身报告折入失败原因以便诊断。change `harden-worker-tool-scope`（已归档） |
| 真实探针账本对账（`test:real-probe-ledger`） | **passed** | 2026-09-11 真实集群 2/2（UID 前置删除 + 404 幂等 + 未确认身份失败关闭）；骨架已实现 |
| 真实跨进程崩溃重启（`test:real-crash-restart`） | **passed** | 2026-09-11 多进程基建（独立宿主子进程 + SIGKILL + 同 DSH_HOME 重启）；非终态 Run 及精确 K3s 身份从持久事实恢复。**本轮修复其清理缺陷**：清理用 K8s 对象名校验器校验含 `/` 的分支名而抛错、被 `catch {}` 吞掉 → 每次运行都残留远程分支且套件仍报通过；已改用 `refName()` 并做可验证清理 + 失败可见（`real-suite-hygiene`） |
| 真实人工审批界面（`test:real-approval`） | **passed** | 2026-09-11 骨架扩为可运行半自动形态（`scripts/run-real-approval-e2e.mjs`）；真实模型（`deepseek-v4-flash`）+ 原生弹窗点击 + 落账断言，连续 3 次通过。**关键断言证明「决定前无任何落账」**（asked 有、decided/review-recorded 均无）→ 无自动批准路径；见 §8 |
| 完整真实网页零跳过门禁（`test:real-web-gate`） | **passed** | 2026-09-11 修复门禁武装集缺陷后**真实全绿**：20 套件 / 21 测试，**0 跳过 / 0 失败**（含真实 K3s、Gitea、模型、浏览器、人工审批）。此前该门禁因漏注凭据 + 漏装两个开关而**结构上不可满足** |
| `run-real-k3s-batch` 的 TTL/ZeroProof 阶段 | **passed** | 2026-09-11 真实集群运行通过（含修复 namespace 缺失与假阳性风险后复跑） |
| 真实待办网页 dogfood（`test:real-todo`，两节点依赖链） | **passed** | 2026-09-11 真实模型 + 真实 Job/Pod + 真实 Git：A 建 `todo.html`，B 以 A 为代码输入在其基线上文档化；宿主验证 `node test-todo-smoke.js` exit 0；真实浏览器驱动增/勾选/删除/刷新持久通过。**此运行发现并修复 K3s 代码输入断链**；见 `docs/b-class-k3s-acceptance-20260911.md` §7 |
| 真实依赖链矩阵（真实集群） | **passed** | 2026-09-11 完整 `test:real-k3s-batch`：`suites` 阶段 3 套件 6/6（k3s-worker / harness-probes / harness-tasks×3）+ TTL 回收 + 零残留归零；两节点依赖链另见 `test:real-todo` |
| 多宿主并发 | **closed（非目标形态）** | 同机跨进程锁互斥已用**真实 4 进程**验证（`workspace-lock-multiprocess.spec.ts`）；跨主机锁语义已防御性合同化（`harden-cross-host-lock-semantics`：异宿主遗留锁失败关闭且绝不夺取，真实子进程验证）。**跨主机双客户端部署 = 非目标形态**（2026-09-12 用户裁决，与「远程企业平台=永久非目标」同族）；真实 NFS 验证不排期，runbook 留存手册 §6.1 |
| 真实远程交互（`test:worker-interactions`） | **passed** | 2026-09-13 真实集群 1 项通过（最终按宿主代码复跑 120.26 秒）：真实 DSH 原生审批批准、业务单选、第二审批拒绝，3 条记录均有执行器收讫；强制终止精确连接进程后新连接继续同一问题；浏览器重载不丢状态；任务停止后迟到批准被拒绝。验收仓库真实任务分支提交 `90acb975` |
| 真实需求全流程闭环（dogfood） | **passed** | 2026-09-13 真实会话 `data-governance` 走完 需求→设计→计划→执行（含崩溃后恢复）→验证→code_review→closing→deployed：Worker 真实提交推送任务分支 `90c1dfdf`，受保护 PR #2 合并入 `main`（发布提交 `f64cb9ff`，`ls-remote` 独立核验）。**此运行暴露并修复两个真实宿主缺陷**（生产者声明冻结 → 走上游 change；收口凭据取自历史运行规格 → `close-with-binding-auth`） |
| 真实 RustFS 对象存储连通 | **passed** | 2026-09-14 宿主→NodePort 32571 真实 SigV4 PUT/GET/HEAD/LIST/建桶/不可覆写全链实测，凭据仅经 env 注入未进日志。**关键后端观测：该 RustFS 不返回 versionId**（合同按「有则必存、etag+hash 钉版」设计即为此情形，无需收窄）；ListObjectsV2 前缀列举可用 |
| 集群内 Pod 经 ClusterIP 上传 | **passed** | 2026-09-14 按 digest 拉新镜像的一次性 Pod 经 ClusterIP `10.43.146.89:9000` 直连 RustFS SigV4 上传成功（凭据 Secret 注入、用后即删）——补全 pod→存储路径与镜像内上传链 |
| artifact 全链真实验收（5.1 / 7.1） | **not-run** | 需真实 K3s + 真实 RustFS + UI 绑定后派发 + 真实模型额度，本机集群不可达。**承载已铺好**：`tests/artifact-handoff.real.spec.ts`（4 项，存储侧真实链路）+ `pnpm run test:real-artifact`——**未武装时显式失败并声明「跳过不是通过」**，不静默跳过。按规则**不计为通过** |

## 3. 上游与决策边界

| 项 | 类型 | 说明 |
| --- | --- | --- |
| 官方 DSH 安装/启动/升级/卸载验收 | C（上游，**已实证缺口**） | 2026-09-11 装入官方 `@deepseek-ai/dsh` 两个发行版实测（隔离临时目录，未改本仓）：`0.1.5-rc.1`（`latest`）与 `0.1.5-rc.2`（`next`）均可安装、`--version` 正常，但 **`verify:profile` 在其上真实失败**：`PactFlow requires DSH external Session event producers; this DSH runtime is unsupported`。已确认 `sessions.externalEventProducers` 只存在于开发源码（`packages/core/session/src/external-event-producers.ts`），两个官方发行版均无 → **确为上游能力缺口，非本仓检测 bug**。开发通道 `verify:profile:dev` 已真实跑通（install→boot→upgrade→remove→clean boot）。**2026-09-15 复查 npm registry：`latest` 仍为 `0.1.5-rc.1`、`next` 仍为 `0.1.5-rc.2`，与实证缺口的两个版本完全相同，四天来无新发行版 → 阻断依旧成立**。本仓插件侧已就绪（`src/index.ts:368` 硬要求该能力，0.1.0–0.5.0 只读注册已具备），上游发版后**插件无需改动**。上游实现已在 fork 完成并经验收（`06d3202146`：声明序列化 + 严格 semver 比较 + 按段准入；core/session 81 项、persistence 372 项通过），已按上游惯例作双语 Agent Note 提交 PR |
| 远程企业平台（kubeconfig 托管/多租户/中心服务端） | D（已裁决非目标） | 目标架构 §5 永久非目标 |
| 节点准入时机、严格全局 FIFO | D（已裁决） | 决策 1B / §15-A6；不得收紧/静默更改 |
| `deployed` 枚举语义（merged vs deployed） | D（**已裁决：保持现状** 2026-09-11） | 仍表示「已合并/已交付」；不擅改领域枚举 |
| 不可信代码的强隔离（沙箱/出网策略） | D（**已裁决：保持现状** 2026-09-11） | 维持「本机信任执行 + 容器受限执行」的现有声明，不扩大安全承诺 |
| F03 触发前置「已成功节点重跑」能力 | D（**已裁决：保持现状** 2026-09-11） | `code-input-staleness` 检测器已交付但不触发；不新增该能力 |

## 4. 明确未实现（诚实清单）

> 2026-09-15 复核补记：以下 A03/A05/A10/A11/A12/R12 各条的结论维持不变（多数已裁决「保持现状」或已全部交付）。本轮**新增四条**，列在本节末尾的「2026-09-15 新增」。

- **A11 完整形态**：token/模型调用数用量统计（Harness termination document 无 token 字段，需先扩展 Harness 能力）、「预算耗尽进入 paused/needs-decision」（当前以**显式拒绝**表达，改为持久 paused 属领域状态机变更）。**输出/日志容量上限已交付**（预算单一权威，实际生效）。
- **A10 完整形态**：为 `tool-invocation`/`verification` **增设专门探针阶段并做真实六级实证**——当前二者无可证证据（前者需 Harness runner 上报工具调用，不在本仓所有权内；后者需专门验证阶段），故诚实性上**不虚报**（已显式入合同与测试）；跨 Harness 能力协商未做。
- **A12 完整形态**：**已全部交付**——卸载前 drain 检查（`uninstall-drain-safety` + 手册 §7 前置）、版本可追溯（`packageVersion`/`eventProducerVersion`）、**前端移交入口**（浮层「导出移交摘要」只读 JSON + 复制）。
- **A03 完整形态**：**零验证可识别与验证基础设施改动可见均已贯通到人眼前**（界面「无自动验证」标注 + 审批理由携带验证敏感清单，并修复字段被剥除的缺陷）；**剩**宿主侧独立验收基线、按任务类型的最小验证策略——二者引入新的基线资产所有权/策略语义，属新目标，未做。
- **A05 完整形态**：**已全部交付**——磁盘容量（窗口/陈旧标记/容量计量/超预算标记）与**客户端只读呈现**（保留现场总数/体积/度量/超预算/逾期）。
- **A04**：Gitea 保护分支的 `waiting-review/waiting-checks` 协作闭环（当前遇 required approvals/status checks 即拒绝自动收口）；需真实受保护仓库的审核/CI 状态，属 B 类环境前置。
- **R12/J9 窄接口重构**：四个宿主端口（`CleanupHost`/`ProbeRecoveryHost`/`DispatchHost`/`RecoveryHost`）均已剥离整个 `ctx`，改为窄端口；剩余未做的是「跨进程锁/时钟/环境」的显式可注入端口（D 类设计建议），属更大重构。
- **A09**：本文件即该建议的落地；历史批次记录未合并（保留在实施状态与 archive）。
- **「已实现但未强制执行」的脚本（诚实清点，2026-09-11 穷尽扫描）**：
  - `scripts/impact-list.schema.mjs`：**已接线**（change `harden-enforce-impact-list-gate`）——`run-real-k3s-batch` 现对变更型运行施加门禁：提供清单则要求**已授权**（`pending` 被拒），未提供则**显式告警**门禁未施加。
  - `scripts/evidence-schema.mjs`：`validateAcceptanceEvidenceFile`、`ACCEPTANCE_EVIDENCE_VERDICTS`、`ACCEPTANCE_EVIDENCE_CONCLUSIONS` 三个导出**零消费者**（其余导出在用：`validateAcceptanceEvidence`/`validateZeroProof`/`ACCEPTANCE_EVIDENCE_TARGETS`）。
  - `src/validation-integrity.ts` 的 `validationExecutedCount`：**已接线**（change `harden-wire-validation-count`）——复核合同后确认「零自动验证必须可识别」属**既有合同未接线**（非新目标），已接入只读移交摘要（`artifacts[].validationsExecuted`，零即表示无自动验证）。**前端视觉标记已交付**（change `harden-drain-and-verification-visibility`：`verification-label` 纯函数把零计数标为「无自动验证」，overlay 运行行接线）。
  - 说明：`tests/` 与 `scripts/` 中「断言可空转」的形态已抽查（`toBeDefined()` 仅 6 处，均伴随失败路径断言，非空转）；未做穷尽式变异测试——那属工具链改动，不在本批。
  - **静默吞错排查（2026-09-11）**：对 `src/` 全部 catch 块做穷尽扫描（28 处候选），逐一核对后**未发现真正静默吞错的块**——其中「租约续期失败」`catch { controller.abort(...) }`、探针清理失败 `catch { success=false; stages.push(...) }`、取消路径 `catch { failures.push(error) }` 等均**有显式动作**（中止/记失败/入集合）。**结论：本仓 `src/` 无「catch 后什么都不做」的块**（此前修复的静默吞错在 `scripts/` 的 crash-restart runner，已由 `real-suite-hygiene` 处置）。

### 2026-09-15 新增

- **`artifact-ref-handoff` 的 5.1 / 7.1 未跑（not-run）**：实现链完整且 fail-closed（存储客户端、四通道门禁、脱敏门、凭据注入、保留账本、第七类卡片、工作台呈现全部已交付并有定向测试），缺的只是**真实环境**——真实 K3s + 真实 RustFS + UI 绑定后派发 + 真实模型额度。验收承载已铺好（`tests/artifact-handoff.real.spec.ts` + `pnpm run test:real-artifact`，未武装时显式失败）。**该 change 因此不得归档**。
- **~~`worker/dsh/release-manifest.json` 的 `hostEventProducerVersion` 漂移~~ 已修复（2026-09-15，change `manifest-producer-version-guard`）**：清单曾写 `0.5.0` 而代码为 `0.6.0`，自引入提交 `1594fa5` 起即为旧值且全仓库无任何测试校验。已修正为 `0.6.0` 并补守卫 `release-manifest-accuracy.spec.ts`（2：生产者版本绑定 `PACTFLOW_EVENT_PRODUCER_VERSION`、插件版本绑定 `package.json`），常量迁至 `src/domain.ts` 使单测可导入（单测不以模块方式 import `index.ts`）。守卫按先红后绿交付。镜像自身标识字段（digest / `adapterVersion` / `dshVersion` / `protocol`）不在守卫范围——它们由构建钉版产生，无「代码里的另一份」可比对。
- **两处门禁设计张力（已识别，未处置）**：① `real-suite-inventory` 的 `REQUIRED_NOT_RUN` 桶与 `check:release` 的零跳过要求**互斥**——任何 `expect.fail` 骨架或环境门控套件放进 `e2e/` 都会让发布门禁结构上不可满足（该桶当前为空，故暂未触发）。② `real-web-gate-prerequisites` 靠正则 `^const (enabled|record|realDescribe)\b` 从套件源码反推必需开关，**改个门控变量名即可绕过**该守卫。
- **终局能力 2（项目身份）与 4（DAG 编排）无专属 capability spec**：行为由单元测试与 `docs/development-plan-开发计划.md` §2.3 承载，散落在多份 spec 中。按架构 §7 判定二者「有证据」，不构成隐性未完成；但若要按终局能力逐条举证，这两条需要现场拼装证据链。属**观察，非缺陷**。

## 5. 证据可靠性说明

- 上表 `passed` 的隔离层结论基于**隔离测试 + 本地 HTTP + 真实临时 Git**；不替代真实集群/官方发行版验收。
- 每个 change 都做了「先失败后通过」；关键改动另有对抗性验证：发布产物（`src` 注入被拦）、任务集合不变量（未授权提交被拒）、
  清理保留（retain 记录零重试）、脱敏（嵌入消息 URL）、F03（依赖链被接受）。
- 多处「首版测试是弱/假通过」被 review 发现并修正：F07（与 Git I/O 赛跑）、A05（清理失败掩盖断言）、脱敏（只处理整串 URL）。
