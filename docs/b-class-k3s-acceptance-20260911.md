# 真实环境（B 类）验收证据（2026-09-11，授权运行）

授权范围：**真实环境验收**（用户 2026-09-11 选择「全部真实套件」）。本文件合并两处真实环境证据：真实 K3s（§1–5）与真实 Gitea（§6）。两个 D 类项（`deployed` 枚举语义、强隔离承诺）用户裁决为**保持现状**。

## 环境

| 项 | 值 |
| --- | --- |
| kubectl context | `default` |
| namespace | `pactflow`（可达） |
| 节点 | amd64 ×4（node2/3/4/ty-w）、arm64 ×1（spark-ty） |
| 拉取密钥 | `pactflow-registry-home-harbor`（dockerconfigjson，仅既有） |
| 探针镜像 | `busybox:1.36`（实测可拉取并可运行） |
| 基线 | 仅 7 天前既有 `job/pf-clone-diag` + 既有 ConfigMap/Secret |

## 结果

### 1. TTL 真实回收（`ttlStage`）—— 通过

- 命令：`PACTFLOW_K3S_TTL_PROBE=1 PACTFLOW_K3S_TTL_SECONDS=60 node -e "…ttlStage()"`
- 观测：创建 `pf-ttl-probe-*`（`ttlSecondsAfterFinished: 60`、`restartPolicy: Never`、`backoffLimit: 0`）→ `kubectl wait --for=condition=complete` → 轮询至 Job 对象 `NotFound`。
- 输出：`[k3s-batch] ttl: observed ttl-after-finished recycle of pf-ttl-probe-mtvsd0h1` / `TTL STAGE OK`。
- 复跑一次同样通过（第二次 `pf-ttl-probe-mtvseqra`）。
- 清理：脚本 `finally` 删除探针；namespace 无残留。

### 2. 零残留归零（`zeroProofStage`）—— 通过（含正常对照）

- 用真实 ConfigMap 走完整两态：
  - 存在时：`evaluateZeroProof` → `zero = false`，`remaining` 含该 ConfigMap 的精确 UID（非零判定正确）。
  - 删除后：`zero = true`。
- 输出：`ZERO-PROOF STAGE OK`。
- 清理：被测 ConfigMap 与其创建均已删除。

## 真实运行发现并修复的脚本缺陷（review 产出）

1. **namespace 缺失**：`ttlStage` 的 `kubectl wait`/`get` 未带 `-n pactflow`（apply 的 JSON 内含 namespace），导致在 default namespace 找不到 Job、首跑失败。已修复为显式 `-n <namespace>`。
2. **假阳性风险**：原 `kubectlSucceeds` 把**任何** `get` 失败都当作「资源已消失」，若因瞬时 API 错误失败会被误判为 TTL 回收成功。已改为 `observeJobAbsence`：只有真正的 `NotFound` 才算消失，其他错误记录并继续轮询。
3. **stderr 噪音**：`kubectl` 的 stderr 直通终端；已收紧 `stdio`。

以上修复在**真实集群复跑验证通过**（TTL 与归零均 OK），并非仅源码改动。

### 3. 探针清理账本真实对账（`pactflow-real-probe-ledger.e2e.spec.ts`）—— 通过

- 命令：`DSH_K3S_E2E=1 pnpm exec vitest run --config vitest.e2e.config.ts packages/dsh-pactflow/e2e/pactflow-real-probe-ledger.e2e.spec.ts`
- 结果：**2/2 通过**（513ms），全程驱动**真实 Kubernetes API**（无替身）：
  1. 创建真实 Job → 账本先写 intent → 取得真实服务端 UID 后写 confirmed → `cleanupProbeIdentity` 按 **UID 前置**删除 Job 与所属 Pod → Job 真实从集群消失 → 重复对账 **404 幂等**成功 → 写 cleaned 后记录移除。
  2. 仅有 intent（无确认 UID）时，`cleanupProbeIdentity` **失败关闭**（`requires a confirmed Job UID`），真实 Job **未被按名删除**，记录保留待人工恢复。
- 归零：`pactflow` namespace 无 `pf-ledger-*` 残留。

### 4. 完整真实 K3s 套件（`test:real-k3s`：k3s-worker + harness-probes + k3s-harness-tasks）—— 通过（含一次负载偶发）

- 命令：`pnpm run test:real-k3s`（`DSH_K3S_E2E=1`，真实模型 + 真实 Job/Pod）
- 第 1 次：**5/6 通过，1 项失败**（未捕获具体名）。
- 第 2 次（同一命令立即复跑）：**6/6 通过**
  - `pactflow-k3s-worker`：1/1（Pod 内提交/推送/本地 fetch/登记验证/结算，10.2s）
  - `pactflow-harness-probes`：2/2（真实模型输出与短时 Job 清理 15.5s；逐模板协议载荷 6.4s）
  - `pactflow-k3s-harness-tasks`：3/3（claude 17.4s / codex 24.3s / opencode 13.2s）
- 结论：两次结果不一致，属**负载下偶发**（与本仓已记录的「真实环境测试在负载下超时」先例一致），非本轮源码改动（A02 时间合同 / 清理路径）引入的确定性回归。
- 归零：`pactflow` namespace 仅剩 7 天前既有 `pf-clone-diag`；本轮无 Job/Pod/ConfigMap/Secret 残留。

### 5. 真实跨进程崩溃重启（`test:real-crash-restart`）—— 通过（两次稳定）

- 基建（新实现）：`scripts/crash-restart-driver.mjs`（独立 Node 进程组合**真实插件**：Cordis + SessionStore + SessionProjectionRegistry + **JSONL 持久化到共享磁盘根** + 真实 kubeconfig 的 PactFlowService；`start` 模式派发真实 K3s Job 后空闲等待被 SIGKILL，`resume` 模式在**全新进程**里从磁盘加载会话）+ `scripts/crash-restart-runner.mjs`（编排：boot→SIGKILL→离线 kubectl 观察→同 DSH_HOME 重启→断言→清理）+ 瘦 e2e spec（只以字面量 argv 启动 runner，解析其单行 JSON 判决）。
- 命令：`pnpm run test:real-crash-restart`（`DSH_K3S_E2E=1 DSH_REAL_CRASH=1`）
- 结果：**两次稳定通过**（3.9s / 4.1s）。判决：`hostKilled=true`、`jobObservableAfterCrash=true`、`crashedState=running`、`projectPresent=true`、`recovered=true`、`jobNameMatched=true`、`branchMatched=true`。
- 即：宿主被 SIGKILL 后，其真实 K3s Job 仍在集群可观测；重启的**独立进程**仅凭 `DSH_HOME` 磁盘上的持久事实，恢复出该非终态 Run 及其**精确 K3s 身份**（jobName、branch）与项目投影。
- 真实运行发现并修复 2 处缺陷：① `resume` 初版用 `pactflow.project()`（要求会话 live）读恢复会话 → 改为从投影读取；② **清理缺口**：崩溃宿主遗留的 Pod 未被 Job 删除完全回收，runner 现按 label selector 补删 Pod（`--cascade=foreground` + label 兜底）。修复后两次运行 residue 检查均为零。

### 6. 真实 Gitea 收口复跑（F05 之后，`test:real-gitea`）—— 通过

- 命令：`pnpm run test:real-gitea`（`DSH_GITEA_E2E=1`，真实受保护仓库 `tianyue/pactflow-acceptance`，Gitea `http://192.168.31.7:30000`）
- 前置：凭据 `~/.dsh/.credentials.yaml` 的 `PACTFLOW_GITEA_API_TOKEN` 存在；`main` 保护规则已预置（`requireMainProtection` 只读校验，不修改仓库权限）。
- 结果：**1/1 通过**（8.7s）。真实路径：clone → 绑定 Git/Gitea → `verifyGitea`（`branchProtected=true`）→ 派发真实任务并产生提交 → 经 `closing` 调 `closeGitNeed` → 真实保护分支 PR **merged**。
- **F05 契约被真实验证**：断言 `pull.merge_commit_sha === closed.release.commit`（release 绑定**精确 merge SHA**，非模糊匹配），且被合并提交确含任务产物（`show <release.commit>:<proof>`）；`closeGitNeed` 内部即走隔离复验路径，故该断言同时验证了 F05 的隔离复验在真实远程下成立。
- 幂等与清理：`closed.cleanupFailures` 为空；派发分支与 PR head 分支经 `ls-remote` 确认真实删除（无临时 ref 残留）。
- 与 2026-09-10 首跑的差别：那次在 `harden-closing-correctness`（F05/F06）落地**之前**；本次为**行为已改后的真实复跑**，是本清单最高优先的真实正确性项。

### 7. 真实待办网页 dogfood（`test:real-todo`，两节点依赖链）—— 通过（并发现修复一处真实缺陷）

- 目的：用一个**小而真实**的项目验证插件端到端可用度（真实模型 + 真实 K3s 容器 + 真实 Git + 真实浏览器），并覆盖**多节点依赖链**。
- 命令：`pnpm run test:real-todo`（`DSH_K3S_E2E=1`）；仓库 `ssh://git@192.168.31.7:30022/tianyue/zeromai-demo.git`（既有 `notes.html`/`leave.html` 等静态页 + `test-*-smoke.js` 冒烟脚本约定）。
- 任务（两节点链）：
  - **节点 A**（`todo-page`）：真实 Worker 按既有页面约定新增 `todo.html`（中文 UI、localStorage、增/勾选/删除）与 `test-todo-smoke.js`，暴露可测契约（`#new-todo`/`#add-btn`/`#todo-list`/`.todo-item`/`.toggle`/`.delete`/`#remaining`、键 `pactflow-todos`）。
  - **节点 B**（`todo-readme`，`dependencies=['todo-page']` 且 `codeInputs=['todo-page']`）：在 A 的成功提交基线之上更新 `README.md`。
- 结果：**1/1 通过**（约 84s）。A 提交 `363a9866…`，B 提交 `ec564d8294…`。
- **四层真实证据**：
  1. **交付真实性**：A `k3sResult.exitCode=0`；A 工作树内 `todo.html` 含 `<!DOCTYPE html>`/`localStorage`，`test-todo-smoke.js` 含 PASS。
  2. **依赖链基线**：A 成功使 B 由 `pending` 转 `ready`；B 的**容器基线折入了 A 的精确提交**——B 工作树文件列表含 `todo.html` 与 `test-todo-smoke.js`（前序成果可见）。
  3. **宿主验证**：B 的登记验证 `node test-todo-smoke.js` 在**确定候选提交**上真实运行并产证据：`validations=[{command:node,args:[test-todo-smoke.js],exitCode:0,durationMs:25}]`。
  4. **功能可用性（真实浏览器）**：Playwright 打开**交付的页面**，增两条（计数=2）、localStorage 持久化为契约 JSON、勾选一条、删除一条（计数=1）、**刷新后存活项与完成态持久**，`pageerror` 为空。
- **本次 dogfood 发现并修复的真实缺陷（K3s 代码输入断链）**：`dependency-code-inputs` 的合同要求代码输入成为后序基线，但**只在本地 Git 路径实现**，K3s 远端容器从不取回/合并代码输入。真实表现：B 的 `node test-todo-smoke.js` 因 `todo.html` 缺失而 exit 1。修复：容器内按精确提交 `fetch`+`merge`（失败关闭）、`spec.json`/`specDigest` 绑定 `codeInputs`、宿主侧本地工作树对 K3s 路径**不折入**以保留精确 fast-forward。修复后同一真实两节点链通过。详见 change `harden-k3s-code-input-baseline`（已归档）。
- 归零：`pactflow` namespace 无本轮 Job/Pod/ConfigMap 残留；脚本 `finally` 删除 Job/ConfigMap 与远程临时分支。
- 产物：`PACTFLOW_KEEP_ROOT=1` 时保留页面到 `.arts/todo-dogfood/todo.html` 与 `test-todo-smoke.js` 供复核。
- 说明：该套件是**真实功能验收**，不属任何已归档 change 的 spec 范围（本次修复除外）；它同时是对「插件能否在真实小项目上产出可用交付物、且多节点链可用」的可用度体检。

### 8. 真实人工审批（`test:real-approval`，原生 DSH UI）—— 通过（连续 3 次；实测真实模型）

- 背景：该项曾是 `expect.fail('skeleton')` 骨架；本轮改为可运行半自动形态（`e2e/pactflow-real-approval.e2e.spec.ts` + 专用运行器 `scripts/run-real-approval-e2e.mjs`，命令 `pnpm run test:real-approval`）。
- 真实路径：真实 Web scaffold（`launchWebScaffold` + 本包 `cordis.patch.yml` 与 preset 根）→ 真实模型回合（`DSH_SNAPSHOT=record`，用 `~/.dsh/.credentials.yaml` 的 `DEEPSEEK_API_KEY`）→ `pactflow_record_review` 触发**原生审批接管** → 真实浏览器中的 `[data-approval-key]` 弹窗 → 点击 `Allow once` → 断言落账。
- 结果：**连续 3 次 1/1 通过**（测试体 11.3s / 12.8s / 11.3s；总时长 13–16s）。
- 真实模型与工具链（实测日志）：`provider=deepseek-official, model=deepseek-v4-flash`，真实 token 用量；模型按序调用 `pactflow_view → pactflow_initialize → pactflow_create_need → pactflow_transition_need → pactflow_record_review → pactflow_view → pactflow_transition_need`，终态回复「Final phase: confirmed (need approval-gate, revision 3)」。
- **不可绕过性被证明（关键断言）**：弹窗出现后、点击前，脚本断言延迟日志中 `approval/asked`（`toolName=pactflow_record_review`）恰好 1 条，而 `approval/decided` 与 `pactflow/review-recorded` 均为 0 条——**决定未作出前没有任何落账**，不存在自动批准路径。
- **一一对应被证明**：点击后 `approval/asked` → `approval/decided`(`allowed-once`) → `pactflow/review-recorded` 各恰好 1 条；`review.source='dsh-approval'`、`review.approvalRequestId` 等于 asked 的 id、`review.evidenceDigest` 等于 asked 原因里的 64 位摘要；`needId='approval-gate'`、`needRevision=2`、`kind='requirement'`、`decision='approved'`。
- **摘要防伪**：弹窗正文含 `approval-gate`、修订 2 与 64 位证据摘要（与调用计算值一致），故「批准 A 却记录 B」不可能通过。
- **门禁真实推进**：`pactflow/phase-transitioned`（→`confirmed`，`from='discussion'`）恰好 1 条，且其日志位置在 `review-recorded` 之后；结束后页面无残留审批弹窗。
- 反例路径（拒绝/取消/不可用、无 Approval 服务、凭证样证据、审批期间需求被改）由确定性单测 `tests/review-authorization.spec.ts` 覆盖，未在本真实套件重复。

## 归零自证

`pactflow` namespace 复核：仅剩 7 天前既有 `pf-clone-diag`、既有 ConfigMap（`pactflow-harness-check-*`、`pactflow-spec-*`）与既有 Secret（`pactflow-git-*`、`pactflow-legacy-*`、`pactflow-llm-*`、`pactflow-registry-home-harbor`、`pactflow-secrets` 等），**无本轮产生的 Job/Pod/ConfigMap/Secret 残留**。真实审批套件不接触集群/Gitea（在 `closing` 之前即停止），故无新增集群残留。

## 未覆盖（诚实）

- **真实人工审批中「由本人点击」这一步**：本轮由脚本代点以形成可复现证据；脚本已断言「作出决定前无任何落账」，但「人类亲自点击」的语义只能由真人在真实场景复现（判定要点见 `docs/installation-operations-安装运维.md` §9.1）。
- **多宿主并发**、**真实依赖链矩阵**：未在真实集群运行。
- 完整批量 `run-real-k3s-batch`（`suites` 阶段消耗模型额度与较长时间）未在本批运行。
- 本记录不构成官方 DSH 兼容证明。
