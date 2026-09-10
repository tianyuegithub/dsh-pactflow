# DSH 零脉实施状态

## 2026-09-11 核对计划的两条完成条件（静态可验部分）

`docs/development-plan-开发计划.md` §1 列出「才能声称完成」的硬条件。对其**静态可验**的两条做了核对：

- **「官方 DSH 源码工作树对 PactFlow 为零差异」**：本仓为唯一源码 owner；已核实 `src/` 无任何指向相邻 DSH 开发仓的导入（`deepseek-harness-pactflow-p0`、`../../`、`packages/*/src` 检索均为 0 命中）。
- **「Web 控制台使用 DSH Client Module/Slot/Store/Locale/Theme/Typert Remote，不存在 iframe、第二层 Web 壳或私有 DSH 源码导入」**：已核实无 `iframe`/`webview`/`createRoot`/`ReactDOM.render`；客户端只导入官方 Client 原语（`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-store`、`dsh-client-locale`、`dsh-client-ui-*`、`dsh-api-remotes`、`dsh-typert-protocol` 等）。
- 结论：上述两条**成立**（有源码级证据）。其余条件（安装/升级/卸载全通过、真实多 Harness 支线、安全验收等）依赖真实环境或用户操作，见 CURRENT_STATUS 与待办清单。
- 说明：本次为**静态核对**，不替代 `verify:profile` 的真实安装/启动证据（后者 release 通道仍阻断，dev 通道已跑通）。

## 2026-09-11 修复不可运行的发布门禁 verify-profile（TDZ；change harden-verify-profile-tdz，已归档）

- **发现**：`scripts/verify-profile.mjs` 从第一次调用即抛 `ReferenceError: Cannot access 'COMMAND_TIMEOUT_MS' before initialization`——常量声明在顶层 `try`（首个 `runDsh` 调用处）**之后**，属暂时性死区。
- **影响面**：`pnpm run verify:profile` 与 `verify:profile:dev` **从未真正运行过**；`check:release` 的首个真实步骤即 `verify:profile`，故该发布门禁同样从未跨过此点。比「缺门禁」更糟：它以与验证对象无关的原因报错。
- **修复**：两常量上移至顶层 `try` 之前。此后 `verify:profile:dev` **真实跑通**：`install → boot → upgrade → remove → clean boot passed`；release 通道不再 TDZ 崩溃，而给出设计好的明确错误（`Set DSH_CLI_ENTRY …`）。
- **守卫**：`tests/script-hygiene.spec.ts` 新增 2 项——逐个 `node --check` 全部 `scripts/*.mjs`；断言 `COMMAND_TIMEOUT_MS` 声明早于首个顶层 `try {`。
- **`check:release` 的实际阻断点（已实跑确认）**：运行 `pnpm run check:release` 在其第 9 行 `resolveProfileRuntime` 处失败，错误为本机未设 `DSH_CLI_ENTRY`（需已安装的官方 JavaScript CLI，禁止源码回落）。这是**设计好的上游前置**，与上面 TDZ 那类「脚本自身缺陷」性质不同——前者是「条件未满足」，后者是「脚本根本不可运行」。两者外观相似（都立即抛错），须区分。
- 验证：`pnpm run check` 65 文件 / 528 测试；`openspec validate --all --strict` 30/30。
- 未推送。

## 2026-09-11 本批提交后的真实环境回归验证（22 提交后）

- 目的：本批提交改动了真实路径代码（`k3s-worker.ts` 的代码输入折入与清理、`host/dispatch.ts`、`project-handover.ts` 等），需确认**无回归**。
- 真实集群复跑 `pnpm run test:real-k3s`（真实模型 + 真实 Job/Pod）：**3 个套件 6/6 全通过**——k3s-harness-tasks 3/3（claude/codex/opencode）、harness-probes 2/2、k3s-worker 1/1。
- 残留核对：`pactflow` namespace 无本轮 Job/Pod；验收远程 `pactflow/need/node/*` 分支数**未增加**（仍为 7 个历史残留），即本轮未产生新的分支泄漏。
- 结论：本批改动在真实路径上行为正确、无回归。
- **追加：全部真实套件的提交后复跑（29 提交后）**——`test:real-k3s` **6/6**、`test:real-gitea` **1/1**（受保护 PR 合并，临时 ref 清理）、`test:real-crash-restart` **1/1** 且远程任务分支数 **7→7 未增加**（清理修复持续生效）、`test:real-worker` **1/1**、`test:real-probe-ledger` **2/2**、`verify:profile:dev` install→boot→upgrade→remove→clean boot。`pactflow` namespace 无残留。
- 即：本批 29 个提交在**全部真实路径**上均已复验无回归，而非仅单元测试通过。

## 2026-09-11 证据管线端到端验证（补：收敛重构的真实执行验证）

- 背景：上一项「收敛证据读取/校验为唯一路径」（change `harden-consolidate-evidence-validation`）改动了会被真实命令使用的 `acceptance-gate.mjs` 与 `evidence-collect.mjs`，但当时**只有单测**覆盖。
- 本轮以真实命令端到端验证（非单测）：
  - 构造含 7 个 target + zero-proof 的完整批次 → `pnpm run evidence:verify batch-smoke` **通过**（`acceptance gate: 7 targets verified`）；`node scripts/evidence-collect.mjs batch-smoke` **7/7 collected**。
  - 反例一（未知 conclusion）：`evidence:verify` **失败关闭**并给出 `conclusion must be one of verified-fact|working-assumption|unknown`。
  - 反例二（未知字段 `sneaky`）：`evidence:verify` 报 `unexpected fields sneaky`；`evidence:collect` **同样失败关闭**——证明收敛后**仍在真实校验**，未因重构而跳过校验（若跳过，正向用例也会通过，具误导性）。
- 结论：收敛重构在真实命令路径上行为等价且校验未削弱；临时批次目录已清理。

## 2026-09-11 修复真实崩溃重启套件的远程分支泄漏（change harden-real-suite-cleanup，已归档）

- 真实运行发现：验收远程累积 `pactflow/need/node/*` 分支，而 `test:real-crash-restart` **一直报告通过**——静默泄漏 + 假绿。
- 根因：清理函数用 `names()`（Kubernetes 对象名校验器，禁止 `/`）去校验 **git 分支名** `pactflow/need/node/<id>`，立即抛 `unsafe object name`；外层 `catch { /* may never have pushed */ }` 静默吞掉，因此**从不删除**。
- 修复：新增 `refName()`（允许 `/`，拒绝 `..`/结尾 `.`/结尾 `/`/`.lock`）；清理改为**可验证**（删除后确认引用消失并复核，防被 SIGKILL 的 Worker 迟到 push 重建），失败则显式 `WARNING`；分支未清理时 `verdict.ok=false` 使套件失败（不再假绿）；删除 Job 后先等待再删分支。
- 真实复跑：`test:real-crash-restart` **1/1 通过且无新增残留**；已手动删除本会话产生的 4 个残留分支；历史残留（本 change 之前、含其它前缀）未擅自删除，已记录。
- 同类排查：`test:real-todo`、`test:real-k3s`（harness-tasks）的清理路径**无该校验器误用**，但同样**删除后不复核**——已记为已知边界，未扩范围。
- 验证：`pnpm run check` 62 文件 / 515 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 25/25。
- 未推送。

## 2026-09-11 接线 Harness 能力声明查询 + 未接线助手排查（change harden-harness-capability-query，已归档）

- **排查方法**：逐模块统计「每个导出符号在自身文件之外的引用数」，找「导出且被单测引用、但生产未接线」的助手（对照基线：本轮早前发现的死代码 `maxOutputBytes`）。
- **发现真实缺口**：`harnessCapabilityProfile` 零生产引用，而 `harness-capability-levels` 的场景以「**查询**任一受支持 Harness 的能力声明」表述——声明无法查询，测试在死代码上通过。
- 修复：新增 `PactFlowHarnessCapabilityView`（可序列化）与 `@Remote('harnessCapabilities') listHarnessCapabilities()`（按模板 id 去重，上限取可证级别）；`harness-capabilities.spec.ts` 新增断言（claude `native` / codex `text` / `maxLevel===harnessProbeMaxLevel()`）。
- **非缺口判定（诚实）**：`validationExecutedCount` 与 `retentionRemainingMs` 同为未接线，但经核对**不构成缺口**——契约要求的「运行结果」与「保留清单」已由 `snapshot()`（含 `gitResult.validations`）与 `retentionStatus()`（含 `retainUntil`）提供，计数/剩余时间可据数据得出；属薄包装，**刻意不加线也不删**（加线冗字段、删线破坏既有单测），已在 change 内记录理由。
- 验证：`pnpm run check` 62 文件 / 515 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 24/24。
- 未推送。

## 2026-09-11 修复真实 worker 支线（本仓缺陷；OpenSpec change harden-worker-tool-scope，已归档）

- 现象：`test:real-worker` 长期稳定失败于 `PactFlow Worker produced no commit`；子会话 `stopReason=completed`、工作树零改动。
- **先补可诊断性**（本轮关键突破）：Git 侧结算被拒时把 Worker 自身有界 outcome 折入失败原因。真实运行随即给出 Worker 原话：`every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem.`
- **真因（本仓缺陷）**：`src/agent/index.ts` 的 `agent/session-start` 钩子对**所有** Agent 施加「编排器只读守卫」（deny `bash`/`pwsh`/`write`/`edit`），未区分被委派的 **Worker 子会话**，于是 Worker 的修改类工具在到达文件系统前被拒。
- 更正此前错误结论：早前记录的「宿主沙箱/批准策略」经机制核实不成立（base bundle 默认 `workspace-write`，边界取会话 cwd，子会话 cwd 即任务工作树），已在 `6518f37` 更正。
- 修复：守卫在 `agent.session.header.origin === 'subagent'` 时直接返回；编排器自身只读语义不变。保留 `PACTFLOW_WORKER_PERSONA`（解决独立的只读 persona 文本叠加因素）。
- 对抗性验证：把 origin 判定改为 `false &&` → 回归断言失败（`write` 返回 `isError: true`）；已还原。
- 真实复跑：`pnpm run test:real-worker` **1/1 通过（exit 0）**，此前稳定失败。
- 验证：`pnpm run check` 62 文件 / 514 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 24/24。
- 未推送。

## 2026-09-11 真实 K3s 全批次 + 跨进程锁验证（P3-11/12 推进）

- **P3-12 完整 `test:real-k3s-batch` 真实集群运行**：`suites` 阶段 3 套件 **6/6 通过**（k3s-worker 1/1、harness-probes 2/2、harness-tasks 3/3：claude/codex/opencode）→ `ttl` 阶段观测到 `ttl-after-finished` 回收（`pf-ttl-probe-mtvxhcnk`）→ `zero-proof` 阶段 `{"zero":true,"remaining":[]}`。全程真实模型 + 真实 Job/Pod。
- **P3-11 跨进程锁互斥（新增能力 verified）**：OpenSpec change `harden-multiprocess-lock-verification`（已归档）。发现 `src/workspace-lock.ts` 的 `withWorkspaceFileLock`（跨进程互斥的**唯一**实现）**此前零测试**。新增 `tests/workspace-lock-multiprocess.spec.ts`：**真实 4 个子进程** × 15 次迭代经锁递增共享计数 → 精确 **60**；并配**无锁对照**必须 **<60**，证明断言非空转。
  - 过程缺陷（测试自身）：首版用 `execFileSync`（子进程**顺序**执行），对照用例失败 `expected 60 to be less than 60` → 暴露测试根本不并发；改为 `spawn` + `Promise.all` 后通过。连续 3 次运行稳定 2/2。
  - 归档时 `openspec archive` 写入占位 `## Purpose`（TBD）导致 `validate --all` 失败；已直接改写主 spec 的 Purpose 修复。
- 验证：`pnpm run check` 62 文件 / 514 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` **23/23**。
- 已知边界：**跨主机**（NFS/共享盘）锁语义未验证；`check:release` 仍阻断于上游（需已安装官方 DSH CLI）。
- 未推送。

## 2026-09-11 OpenSpec change harden-harness-capability-honesty（A10 有界增量：能力级别诚实性，已归档）

- 修复两处诚实性缺口：① 级别推导在 `k3s-worker.ts` 有一份本地镜像，与 `harness-capabilities.ts` 并列维护（存在漂移风险）；② `tool-invocation`/`verification` 无探针证据，此前仅靠「无对应分支」隐式不虚报，无常量/测试守护。
- 已实现：新增 `PACTFLOW_HOST_ATTESTABLE_LEVELS`（connection/protocol/artifact/cancellation）、`PACTFLOW_PROBE_STAGE_LEVEL`（阶段→级别）、`harnessProbeMaxLevel()`；`harnessAchievedLevel` 改为按显式映射取最高成功阶段、未知阶段（含 `tool-invocation`/`verification`/未来名）**忽略而非推断**；`k3s-worker.ts` 删除本地重复推导并委托共享函数；镜像探针与 API 探针补报 `achievedLevel`/`maxLevel`；`PactFlowApiProbeResult` 补字段。
- 对抗性验证：把 `verification` 加回映射 → 诚实性测试失败（2 failed / 6 passed）；已还原。
- 验证：`pnpm run check` 61 文件 / 511 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：未为 `tool-invocation`/`verification` 增设证据来源（属新能力）。
- 真实集群复跑：`DSH_K3S_E2E=1` 跑 `pactflow-harness-probes.e2e.spec.ts`（真实模型 + 真实 Job/Pod，claude/codex/opencode/dsh 四模板）**2/2 通过**，级别断言（探针 `achievedLevel='cancellation'`、API 探针阶段不含 `cli-response`）在真实路径成立。
- 未提交、未推送。

## 2026-09-11 真实 dogfood 发现并修复 K3s 代码输入断链（OpenSpec change harden-k3s-code-input-baseline，已归档）

- 用真实小网页项目（`zeromai-demo`）跑**两节点依赖链** dogfood（`test:real-todo`：真实模型 + 真实 K3s + 真实 Git + 真实浏览器），发现真实缺陷：`dependency-code-inputs` 的「代码输入成为后序基线」**只在本地 Git 路径实现**，K3s 远端容器从不取回/合并代码输入。
- 真实表现：B 的 `node test-todo-smoke.js` 因 `todo.html` 缺失 exit 1；B 工作树文件列表无前序成果。
- 已修复：`WORKER_SCRIPT` 容器内按精确提交 `fetch --no-tags origin <commit>` + `merge --no-ff --no-edit <commit>`（失败关闭），并以折叠后的 `BASELINE_COMMIT` 衡量 Worker 自身改动；`spec.json` 与 `pactFlowK3sSpecDigest` 纳入 `codeInputs`；K3s 派发的 `materialize` 传 `{ foldCodeInputs: false }` 以保留本地精确 fast-forward。
- 验证：真实两节点链**复跑通过**（B 继承 A 的 `todo.html`；宿主验证 `node test-todo-smoke.js` exitCode 0）；`pnpm run check` 61 文件 / 507 测试 / 13 包产物；`openspec validate --all --strict` 22/22。
- 证据：`docs/b-class-k3s-acceptance-20260911.md` §7。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-output-budget-authority（A11 有界增量：输出上限归预算，已归档）

- 修复一处**名义存在、实际未接线**的预算：`run-budget.ts` 有 `maxOutputBytes` 与测试，但 `boundedOutcome` 用的是硬编码 4096，预算字段从未生效。
- 已实现：`boundedOutcome` 改用 `boundOutputToBudget(redacted, this.runBudget.maxOutputBytes)`（保留先脱敏后截断 + 默认回退）；默认 `maxOutputBytes` 调为 4096（不放大存量）。
- 先失败后通过（观测）：把上限硬编码回 4096 → 新增测试失败（1 failed / 5 passed）；还原后转绿。
- 验证：`pnpm run check` 61 文件 / 505 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：token/用量统计与 paused 状态**未做**（前者 Harness 无 token 字段、后者属领域状态机变更，均需先确认目标/上游能力）。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-retention-capacity（A05 扩展：保留现场磁盘容量，已归档）

- 补 J13（来源 FULL:A05）的容量维度：保留现场可计量、有界、只读呈现，绝不自动删除。
- 已实现：`retention-policy.ts` 新增 `summarizeRetentionCapacity`（未测量场景不贡献字节并令 `measured=false`；`overBudget` 仅在完整测量且达预算时为真）、`measureRetainedSceneBytes`（有界遍历：条目/字节上限即停，缺失根 0 不抛错，返回 `{bytes, capped}`）；`sizeBytes` 入 `types.ts`/`domain.ts`（schema + `cleanupIdentity` 排除集）；`retainLocalFailure` 测量写入；`retentionStatus` 返回容量字段。
- 对抗性验证：将 `measured` 硬改为 `true` → 容量测试失败（1 failed / 9 passed），已还原。
- 验证：`pnpm run check` 61 文件 / 504 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：保留现场 UI 入口未做；体积为有界下界（默认 512MB / 20000 条目上限）；不引入自动清理。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-host-narrow-ports-dispatch-recovery（R12 剩余：派发/恢复宿主窄端口，已归档）

- 完成上一 change `harden-host-narrow-ports` 遗留的 `DispatchHost` / `RecoveryHost` 的 `ctx` 剥离。
- 已实现：`DispatchHost` 移除 `ctx`，改 `agents()` / `subagents()`（`localExecutionImpl`）；`RecoveryHost` 移除 `ctx`，改 `logger` / `liveSession()`（`recovery.ts` 6 处日志 + 1 处会话读取）；`index.ts` 两工厂提供窄端口，`logger` 为惰性 getter 以保留 `recovery-retry` 纯助手契约。
- 先失败后通过（观测）：收窄接口但工厂 `logger` 仍急切读取 `this.ctx` 时，`recovery-retry.spec.ts` 13 项在**不含 `ctx`** 的宿主替身上全部失败 `Cannot read properties of undefined (reading 'logger')`；改惰性后转绿。`dispatch` 侧为先失败同机制推理（已诚实标注）。
- 验证：`pnpm run check` 61 文件 / 500 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 归档产物：`host-narrow-ports` spec 新增「派发与恢复宿主不得依赖整个上下文」+3 场景。
- 已知边界：仅剥离整 `ctx` 依赖，端口方法面仍较多（既定「成员回路由实例方法」模式）；跨进程锁/时钟/环境可注入端口未做。
- 未提交、未推送。

## 2026-09-11 真实 Gitea 收口复跑（F05 之后，待办优先级 P1-3）

- 命令：`pnpm run test:real-gitea`（真实受保护仓库 `tianyue/pactflow-acceptance`）。**1/1 通过**（8.7s）。
- F05 契约真实验证：真实保护分支 PR 合并后断言 `pull.merge_commit_sha === closed.release.commit`（release 绑定精确 merge SHA），被合并提交含任务产物，`closeGitNeed` 走隔离复验路径；`cleanupFailures` 为空，派发/PR head 分支真实删除。
- 区别于 2026-09-10 首跑（F05/F06 落地之前）：本次是**行为已改后的真实复跑**。
- 证据：`docs/b-class-k3s-acceptance-20260911.md` §6（该文件已扩为「真实环境 B 类验收证据」，同时覆盖 K3s 与 Gitea）。
- 未提交、未推送。

## 2026-09-11 P0 文档卫生与死骨架清理（待办优先级 P0-1/P0-2）

- P0-1：`CURRENT_STATUS` 中两项 D（`deployed` 枚举语义、强隔离承诺）与「F03 触发前置」标注为**已裁决：保持现状 2026-09-11**，不再列「待裁决」；删除重复的 A04 行。
- P0-2：删除冗余骨架 `e2e/pactflow-k3s-ttl.e2e.spec.ts`（TTL 存在性由 `tests/k3s-cleanup.spec.ts` 断言、真实回收由 `run-real-k3s-batch ttlStage` 验证）；`tests/real-suite-inventory.spec.ts` 守卫重写为显式三分桶（REQUIRED_NOT_RUN / IMPLEMENTED / COVERED_ELSEWHERE），防止骨架被静默清空或误删。
- 验证：`pnpm run check` 61 文件 / 498 测试 / 13 包产物全绿；`git diff --check` 通过。测试数较上批 -1（删除的 TTL 骨架中 1 项被守卫取代）。
- 未提交、未推送。

## 2026-09-11 真实 K3s 验收（用户授权，B 类）

- 用户 2026-09-11 授权真实 K3s 验收；两个 D 类项（`deployed` 枚举语义、强隔离承诺）裁决为**保持现状**。
- **TTL 真实回收**：`PACTFLOW_K3S_TTL_PROBE=1` 跑 `ttlStage`，真实集群观测到 `ttl-after-finished` 回收（两次：`pf-ttl-probe-mtvsd0h1`、`pf-ttl-probe-mtvseqra`），脚本 `finally` 清理探针。
- **零残留归零**：真实 ConfigMap 两态验证——存在时 `zeroProofStage` 判非零并列出精确 UID，删除后判归零。
- **真实运行发现并修复 3 处脚本缺陷**：① `ttlStage` 的 `kubectl wait/get` 缺 `-n pactflow`（首跑失败）；② `kubectlSucceeds` 把任何 `get` 失败当「已消失」→ 假阳性风险，改为只认真正 `NotFound` 的 `observeJobAbsence`；③ `kubectl` stderr 噪音，收紧 `stdio`。修复后在真实集群**复跑通过**。
- 归零自证：`pactflow` namespace 仅剩 7 天前既有 `pf-clone-diag` 与既有 ConfigMap/Secret，无本轮残留。
- 证据：`docs/b-class-k3s-acceptance-20260911.md`。
- 追加（探针账本真实对账）：实现并运行 `pactflow-real-probe-ledger.e2e.spec.ts`（真实 Kubernetes API，无替身）——真实 Job 的 intent→confirmed(UID)→`cleanupProbeIdentity` 按 UID 前置删除→Job 真实消失→重复对账 404 幂等→cleaned 移除；以及「无确认 UID 时失败关闭、不按名删除、责任保留」。**2/2 通过**，集群归零。
- 追加（完整真实 K3s 套件 `test:real-k3s`）：首跑 5/6（负载偶发）、立即复跑 **6/6 通过**（k3s-worker 1/1、harness-probes 2/2、k3s-harness-tasks 3/3）；两次不一致属负载偶发，非本轮改动引入的确定性回归。
- 追加（真实跨进程崩溃重启）：新建多进程验收基建——`scripts/crash-restart-driver.mjs`（独立进程组合真实插件 + JSONL 持久化到共享磁盘根；start 派发真实 K3s Job 后等待被 SIGKILL，resume 在全新进程从磁盘加载）+ `scripts/crash-restart-runner.mjs`（编排 boot→SIGKILL→离线观测→同 DSH_HOME 重启→断言→清理）+ 瘦 e2e spec。**两次稳定通过**：hostKilled、jobObservableAfterCrash、projectPresent、recovered、jobName/branch 精确匹配均为真。修复 2 处真实缺陷：resume 读取恢复会话需用投影而非 live Remote；清理需按 label 补删崩溃遗留 Pod。


## 2026-09-11 OpenSpec change harden-retention-policy（A05 扩展：保留窗口与陈旧标记，已归档）

- A05 已实现「保留失败现场、绝不自动删除」；本 change 补上「有界窗口 + 陈旧标记 + 只读查询」，避免保留成为无界沉默残留，同时仍不自动删除。
- 已实现：新增 `src/retention-policy.ts`（默认 14 天窗口、`retentionRemainingMs`、`isRetentionOverdue`、`summarizeRetainedScenes`）；`CleanupRecord.retainUntil?`（类型+schema）；`retainUntil` 加入 `cleanupIdentity` 可变字段排除集；`retainLocalFailure` 写窗口；只读 Remote `retentionStatus`。
- 过程修正：初版函数名 `retentionAgeMs` 与「剩余窗口」语义不符，被自身测试暴露后改名 `retentionRemainingMs`。
- 验证：`pnpm run check` 61 文件 / 499 测试 / 13 包产物；`git diff --check` 通过。
- 归档产物：`failure-scene-retention-policy` spec。
- 已知边界：未实现自动到期清理与 UI 入口；窗口为固定默认值；未统计保留占用体积。

## 2026-09-11 OpenSpec change harden-k3s-batch-stages（R04 K3s 批次收尾阶段，已归档）

- 覆盖 GPT 评审 R04：`run-real-k3s-batch.mjs` 的 `ttlStage`/`zeroProofStage` 原为 `throw not implemented` 占位。
- 已实现：新增 `scripts/k3s-batch-stages.mjs`（`buildTtlProbeJob` / `evaluateTtlRecycle` / `evaluateZeroProof`）；两个 stage 由占位改为真实实现（TTL：apply 探针 Job→等完成→轮询回收→finally 清理；归零：按 UID 核对并输出结构化 ZeroProof）；未显式武装时失败关闭，不假装已验证。
- 先失败后通过：`tests/k3s-batch-stages.spec.ts` 5 项（UID 替换分支做了 fail-first）；手工验证未武装时两 stage 均以「B-class operation」报错。
- 验证：`pnpm run check` 60 文件 / 493 测试 / 13 包产物；`git diff --check` 通过。
- 归档产物：`k3s-batch-finalization` spec。
- 已知边界：真实集群运行属 B 类未执行；追踪资源清单由调用方提供，未自动收集；「未解释残留」仅接受传入列表。

## 2026-09-11 OpenSpec change harden-host-narrow-ports（R12/J9 宿主窄端口，已归档）

- 覆盖 GPT 评审 R12：宿主拆文件但仍传整个 Cordis Context，职责未真正解耦。
- 已实现：`CleanupHost` 与 `ProbeRecoveryHost` 移除 `ctx: Context`，改窄端口（`logger`；cleanup 另加 `delivery(session)`）；两个模块内 `host.ctx.*` 调用点与 `index.ts` 宿主工厂同步改造。
- 先失败后通过：`tests/host-narrow-ports.spec.ts` 用**不含 `ctx`** 的宿主替身驱动清理对账（先报 `Cannot read properties of undefined (reading 'sessionProjections')`），并更新既有 `cleanup-retention-guard` 替身。
- 验证：`pnpm run check` 59 文件 / 488 测试 / 13 包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
- 归档产物：`host-narrow-ports` spec。
- 已知边界：仅收窄 cleanup/probe-recovery 两个模块；`DispatchHost`/`RecoveryHost` 仍为较大宿主对象（收窄风险高，未做）；纯 reducer（`domain.ts`）已核实无 I/O。

## 2026-09-11 OpenSpec change harden-input-staleness（F03 增强：代码输入过期追踪，已归档）

- 新增纯模块 `src/input-staleness.ts`（`staleCodeInputs`：按依赖比对后序实际消费的提交 vs 依赖最新成功提交）；`codeInputs` 增加可选 `dependency`（含 schema）；只读 Remote `staleCodeInputs(sessionId, nodeId)` 报告过期输入、不修改状态。
- 测试：`input-staleness.spec.ts` 4 项纯函数；`input-staleness-e2e.spec.ts` 1 项可达性边界。
- **Review 关键发现（诚实）**：当前生命周期下「前序成功后再成功重跑」不可达（`retryNode` 仅允许 failed/cancelled，`settleRun` 拒绝二次结算终态），故该触发器在真实路径上不会发生；检测原语与记录已就位，待「已成功节点重跑」能力落地后生效。**未伪造不可达绿灯**。
- 验证：`pnpm run check` 58 文件 / 486 测试 / 13 包产物。
- 归档产物：`code-input-staleness` spec。
- 已知边界：触发路径不可达；未实现自动重跑/自动失效批准。

## 2026-09-11 OpenSpec change harden-run-budgets / harness-capabilities / project-handover（A11/A10/A12，已归档）

- `harden-run-budgets`（A11）：新增 `src/run-budget.ts`（尝试次数上限、输出字节上限，越界显式说明原因）；`retryNode` 超预算即拒绝。测试 `run-budgets.spec.ts` 5 项（含 `retryNode` 强制路径 fail-first）。
- `harden-harness-capabilities`（A10）：新增 `src/harness-capabilities.ts`（六级能力：connection→protocol→tool-invocation→artifact→verification→cancellation；按 stages 推导实际级别，cleanup 失败不得声称 cancellation）；Harness 探针结果新增 `achievedLevel`/`maxLevel`。测试 5 项。
- `harden-project-handover`（A12）：新增 `src/project-handover.ts`（只读移交摘要：阶段、精确 Git 产物、未完成责任含保留现场）与只读 Remote `projectHandover`（在线/冷会话一致）。测试 3 项；过程中修正 Remote 边界类型必须定义在公开类型子路径（Typert 约束）。
- 验证：`pnpm run check` 56 文件 / 481 测试 / 13 包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
- 归档产物：`run-budgets`、`harness-capability-levels`、`project-handover` 三个 spec。
- 已知边界：A11 未含 token/模型调用数用量与「预算耗尽进入 paused」；A10 未含 tool-invocation/verification 的专门探针阶段与真实六级实证；A12 未含卸载前 drain 与 UI 入口。

## 2026-09-11 OpenSpec change harden-local-failure-retention（A05 本地失败保留，已归档）

- 覆盖 GPT 评审附录 A05：本地失败结算不登记清理责任，失败 worktree/分支成为沉默残留；但不应该一律删除（可能含未提交代码）。
- 已实现：`PactFlowCleanupRecord.retain?` 保留标记；`retainLocalFailure` 在本地四处失败结算登记固定 id（`git:<branch>`）责任并去重；`reconcileCleanupsImpl` 跳过 `retain === true` 记录（不重试、不删除）；保留现场默认不删除。
- 过程发现并修正弱验证：集成用例只断言「非 succeeded」时，禁用保留守卫仍通过（清理尝试失败而非成功）；补确定性守卫测试 `cleanup-retention-guard.spec.ts` 直接断言 `retryCleanup` 对 retain 记录零调用。
- 验证：`pnpm run check` 53 文件 / 468 测试 / 13 包产物。
- 归档产物：`openspec/specs/local-failure-retention/spec.md`（2 需求 / 5 场景）。
- 已知边界：未实现保留期限/磁盘体积策略与用户提示；与 K3s 的「失败即清理」刻意不对称；无 UI 展示入口。

## 2026-09-11 OpenSpec change harden-validation-integrity（A03 验证完整性信号，已归档）

- 覆盖 GPT 评审附录 A03 的可实施部分：命令被批准不等于测试实现不可被改弱；空验证配置可能被当成已验证。
- 已实现：新增纯模块 `src/validation-integrity.ts`（`validationSensitiveChanges` 识别任务改动验证敏感文件，确定性/去重/排序；`validationExecutedCount` 报告实际执行数）；`validateResult` 记录该提交的验证敏感改动（**仅上报不阻断**），经 `PactFlowGitResult.validationSensitiveChanges?` 传播。
- 先失败后通过：`tests/validation-integrity.spec.ts` 5 项。
- 验证：`pnpm run check` 51 文件 / 464 测试 / 13 包产物。
- 归档产物：`openspec/specs/validation-integrity-signals/spec.md`（2 需求 / 5 场景）。
- 已知边界：只做可见性，不阻断、不自动判定「测试被弱化」；评审建议的宿主侧独立验收基线与按任务类型的最小验证策略未实现；敏感文件清单为启发式。

## 2026-09-11 OpenSpec change harden-run-time-contracts（A02 时间合同，已归档）

- 覆盖 GPT 评审附录 A02：`activeDeadlineSeconds` 由 `leaseDurationMs` 推导，而 Host 续租只延长所有权——健康长任务会在首个租约间隔被 K3s 终止。
- 已实现：新增 `jobMaxWallClockSeconds`（默认 3600、下限 60）；`plan()` 的墙钟预算不再由租约推导；`leaseDurationMs` 保留为所有权租约并注释说明。
- 先失败后通过：`tests/run-time-contracts.spec.ts` 3 项（先报 `expected 5 to be greater than 60`）；并修正既有 `k3s-worker.spec.ts` 中固化缺陷行为的 `activeDeadlineSeconds: 60` 断言为 3600。
- 验证：`pnpm run check` 50 文件 / 459 测试 / 13 包产物。
- 归档产物：`openspec/specs/run-time-contracts/spec.md`（1 需求 / 3 场景）。
- 已知边界：只分离租约与墙钟预算；心跳停滞与清理时限的显式上限未引入（API 超时已由既有 `withRequestDeadline` 覆盖）。

## 2026-09-10/11 OpenSpec change harden-cluster-identity（A07 集群身份，已归档）

- 覆盖 GPT 评审附录 A07：kubeconfig 路径不是集群不可变身份，同路径换集群后指纹不变。
- 已实现：`connectionFingerprint` 改为摘要 **namespace + 解析出的集群身份（server + 证书颁发机构）**；构造时从 KubeConfig 取当前集群 server 与 CA（`caData`，或 `caFile` 内容摘要）。
- 先失败后通过：`tests/cluster-identity.spec.ts` 3 项（同路径换集群改变、仅 CA 不同改变、同集群稳定）。
- 验证：`pnpm run check` 49 文件 / 456 测试 / 13 包产物。
- 归档产物：`openspec/specs/cluster-connection-identity/spec.md`（1 需求 / 3 场景）。
- 已知边界：以 server+CA 而非集群侧 UID（K8s 无通用全局集群 UID）；指纹变化使历史账本保留责任、不误删，但未实现显式「暂停自动清理并提示复核」流程。

## 2026-09-10 OpenSpec change harden-approval-subject（F04 批准绑定交付对象，已归档）

- 覆盖 GPT 评审 FULL:F04（复现 R08）：批准摘要只绑文本，`createNode` 不推进 Need 修订，故批准后可悄悄扩大交付集合。
- 已实现：新增纯函数 `pactFlowDeliverySubjectDigest`（排序后 (remoteRef, commit) 集合 → SHA-256）；`PactFlowReview.subjectDigest?`（可选，兼容旧事件）；`recordReview` 对 verification 写入摘要；`closeGitNeed` 要求最新 verification 批准摘要等于当前交付对象摘要，缺失或不符即拒绝。
- fail-first 两次：纯函数 4 项先红；收口校验用 `if (false && …)` 禁用后 `subject-drift` 用例收口成功（证明旧批准放行了更大的集合），恢复后转绿。
- Review 修复：`latestVerificationSubject` 改为显式接收 `needRevision`，与 `latestReviewApproved` 基准一致，消除漂移风险。
- 验证：`pnpm run check` 46 文件 / 449 测试 / 13 包产物；`typecheck` 通过。
- 归档产物：`openspec/specs/review-subject-binding/spec.md`（2 需求 / 6 场景）。
- 已知边界：「成功提交变化」的收口级端到端用例未单独构造（由摘要函数单测 + 收口比对同一函数覆盖）；历史无摘要批准失败关闭，需重新确认。

## 2026-09-10 OpenSpec change harden-local-admission（F07 本地派发准入，已归档）