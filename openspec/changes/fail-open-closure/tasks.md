# tasks — fail-open-closure

每一条都遵循「先失败后通过」：先写出复现该缺陷的用例并确认它红，再改实现。

## 1. 凭证脱敏

- [x] 1.1 `src/redaction.ts` 逐行脱敏并保留原分隔符；补多行、scp 整行、CRLF 三条反例。验证：`display-redaction.spec.ts`（9 例）

## 2. 向人工审批的陈述

- [x] 2.1 敏感改动扫描范围改为 `baseCommit..commit`；用例走真实 git 三提交复现「改动藏在前面的提交里」。验证：`validation-sensitive-scan.spec.ts`
- [x] 2.2 新增 `validationSensitiveScanFailed` 并在 zod 负载结构中显式声明（未声明的字段在 fold 时被静默剥离）；扫描失败不再降级为空清单。验证：同上 + `review-surface.spec.ts`
- [x] 2.3 审批文案区分「无」与「核查失败，无法确定」。验证：`review-surface.spec.ts` 新增「never reports a failed scan as "none"」
- [x] 2.4 敏感文件判定改为按文件名匹配，覆盖 monorepo 子包；补「名称仅以此结尾的无关文件不误判」反向用例。验证：`validation-integrity.spec.ts`

## 3. 对账与账本

- [x] 3.1 新增 `runIsActive()`；启动对账在按 UID 删除前先确认 Job 非活动，活性读不到按「仍在执行」处理。验证：`probe-recovery.spec.ts` 三条新用例（在途不删 / 终态照删 / 未知则保留并判本轮未完成）
- [x] 3.2 `cleanupRun` 成功后落 `phase: 'cleaned'`，账本随正常收口收敛；`CleanupHost` 窄端口新增 `runCleanupRecorder`
- [x] 3.3 run / probe 两个账本：无法读取的单条记录一律抛错而非跳过。验证：`ledger-durability.spec.ts` + `probe-ledger.spec.ts`（原「跳过不合法行」用例改写为断言拒绝加载，并在注释中记录它此前断言的正是缺陷本身）
- [x] 3.4 两个账本改为每次读盘，读-改-写整体进 `withWorkspaceFileLock`。验证：`ledger-durability.spec.ts`「sees records another process wrote」
- [x] 3.5 修写链毒化（`.then(cb)` 在已拒绝的 promise 上永不回调）；临时文件名加 pid + 随机后缀并用 `flag:'wx'`。验证：同上「keeps recording after one write fails」
- [x] 3.6 创建意图记录 `plannedChildNames`，字段注释与用例明确「名字不是身份，此清单不得用于删除」。验证：同上
- [x] 3.7 `infrastructure-health` 对「合法 JSON 但非数组」一并失败关闭

## 4. 模型指名的 Secret 与凭证

- [x] 4.1 `PACTFLOW_GIT_SECRET_PREFIX` + `assertPactFlowGitSecretName`，`bindGit` 与 `saveWorkspaceWorkerPolicy` 两个入口共用；`k3s-worker` 的列举端点改用同一常量。验证：`git-secret-ownership.spec.ts`（4 例，含四类命名空间内 Secret 的对抗清单）
- [x] 4.2 `PactFlowInfrastructure.nonGitCredentialRefs()`；Git HTTPS `credentialRef` 属于其它已登记资源时拒绝。验证：`git-credential-binding.spec.ts` 三条对抗用例
- [x] 4.3 `effectiveGiteaBinding` 与 `bindGit` 两处去掉 `gitProviders.length > 0` 前置。验证：`git-credential-binding.spec.ts` 补「registry 被清空」与「完全无 infrastructure」；`domain.spec.ts` 中那条在无 infrastructure 下绑定显式端点的用例改为登记其所指名的 Provider

## 5. 宿主预算

- [x] 5.1 `boundOutputToBudget` 回退到 UTF-8 字符边界。验证：`run-budgets.spec.ts` 三条新用例（1500–1699 字逐值断言、无替代字符、极小预算仍保留标记）
- [x] 5.2 Git 与验证命令的子进程输出上限提到 64 MiB，溢出与「命令失败」分开表达；判据用 Node 实际的 `ERR_CHILD_PROCESS_STDIO_MAXBUFFER`。验证：`git-output-budget.spec.ts`
- [x] 5.3 `harnessTimeoutSeconds()` 按比例预留（上限仍 30 秒，长预算逐字不变）。验证：`k3s-budget-arithmetic.spec.ts`
- [x] 5.4 `workerLogTail` 的 deadline 时基由 `Date.now()` 改为 `performance.now()`
- [x] 5.5 `run()` 最早两条 throw 补 `pendingRuntimeSecrets` 释放。验证：`k3s-budget-arithmetic.spec.ts` 两条对抗用例 + 一条「两道门都过」的对照

## 6. 身份与拒绝

- [x] 6.1 `cancel()` 无确认 UID 时失败关闭；删除只服务于它的三个按名删除私有方法。验证：既有 `k3s-cleanup.spec.ts` 全绿 + 类型检查证明无其它调用者
- [x] 6.2 CA 材料读取失败时失败关闭，不再退化为路径
- [x] 6.3 `specDigest` 校验去掉无关的 `expectedBranch` 前置。验证：`k3s-artifact-secret.spec.ts` 中该门真实生效（假 digest 被挡住）
- [x] 6.4 对象存储 Secret 补 ownerReference 并加入 `cleanupRun` 删除清单。验证：`k3s-artifact-secret.spec.ts`
- [x] 6.5 挂机驱动回传 `recheckReviewGate` 的拒绝并据此阻塞、指名原因。验证：`autopilot-review-gate.spec.ts` 四条新用例
- [x] 6.6 `validateCommit` 的「Worker 没产生提交」改为计数「HEAD 可达而基线与各输入都不可达」的提交。验证：`validation-sensitive-scan.spec.ts` 真实 git 双分支复现

## 7. 套件自身

- [x] 7.1 `build-freshness.spec.ts`：产物比其源码旧即红。缺陷本身由探针实证（`initialize()` 首行注入 throw 后 `domain.spec.ts` 19 例仍全绿）

## 8. 终验

- [x] 8.1 `pnpm run check` 全绿（构建 + 单测 + 打包清单）：121 文件 / 953 通过 / 7 跳过 / 25 产物
- [x] 8.2 `openspec validate --all --strict` 全绿：56/56
- [x] 8.3 `docs/implementation-status-实施状态.md` 追加本批次证据；`docs/CURRENT_STATUS-当前状态.md` 相应条目同步
