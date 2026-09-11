# DSH 零脉 待办优先级清单

**日期**：2026-09-11
**性质**：派生视图（非计划 owner）。计划与顺序的正文 owner 是 OpenSpec（`openspec/changes/`、`openspec/specs/`）；本清单只做跨 change 的三方汇总与优先级排序，供决策使用。
**当前事实基线**：44 个 change 已归档、36 个 spec 有效、`pnpm run check` 71 文件 / 554 测试全绿；分支**已推送**到 `origin`（`local==remote`）。

排序原则：先消除**错误或冗余信息**（成本极低）→ 再补**行为已改但未经真实环境验证**的项（正确性风险最高）→ 再做**结构性/新能力**（工作量大）→ 最后是与目标/上游绑定的项。

---

## P0 · 立即处理（低成本，消除错误信息与冗余）

| # | 事项 | 为什么现在做 | 类型 |
| --- | --- | --- | --- |
| 1 ✅ | 更新 `CURRENT_STATUS`：两项 D（`deployed` 语义、强隔离承诺）**已由用户裁决为「保持现状」**，不应再列为「待裁决」；并删除重复的 A04 行 | 文档当前自相矛盾，会误导后续判断 | 文档卫生（分钟级） |
| 2 ✅ | 处置冗余骨架 `e2e/pactflow-k3s-ttl.e2e.spec.ts`：TTL 已由 `run-real-k3s-batch ttlStage` **真实验证**，该 `expect.fail` 骨架已冗余 → 实现为 e2e 或删除并同步 `real-suite-inventory` 守卫 | 死骨架会持续污染「required-but-not-run」清单 | 代码/测试（小） |

## P1 · 真实环境补验（需你逐项授权；正确性风险最高）

| # | 事项 | 为什么优先 | 影响范围（需授权） |
| --- | --- | --- | --- |
| 3 ✅ | **真实 Gitea 收口复跑（F05 之后）** | **已完成 2026-09-11**：真实受保护 PR 合并，断言 `merge_commit_sha === release.commit`（精确 merge SHA）且隔离复验路径成立，临时 ref 清零；见 `docs/b-class-k3s-acceptance-20260911.md` §6 | 已验；受保护仓库 `tianyue/pactflow-acceptance` |
| 4 ✅ | 真实人工审批界面（`test:real-approval`） | **已完成 2026-09-11**：骨架扩成可运行半自动形态（专用运行器 `scripts/run-real-approval-e2e.mjs`）；真实模型 + 原生弹窗点击 + 落账断言，连续 3 次通过；关键断言证明「决定前无任何落账」（无自动批准路径）；见 `docs/b-class-k3s-acceptance-20260911.md` §8 与 `docs/installation-operations-安装运维.md` §9.1 | 本地 web 界面；本轮脚本代点，真实场景由本人点击 |

## P2 · 结构性重构与新能力（A 类，可做；测试兜底）

| # | 事项 | 说明 | 风险/工作量 |
| --- | --- | --- | --- |
| 5 ✅ | R12 剩余：`DispatchHost` / `RecoveryHost` 收窄为窄端口 | **已完成**（change `harden-host-narrow-ports-dispatch-recovery`，已归档）：四端口全部剥离 `ctx`；`host-narrow-ports` spec 新增「派发与恢复宿主亦不得依赖整个上下文」+2 场景 | 已完成，554 测试兜底 |
| 6 ◑ | A03 完整：宿主侧独立验收基线 | **零验证可识别已贯通到界面**（change `harden-drain-and-verification-visibility`，已归档：`verification-label` 把零计数显式标为「无自动验证」，不再是计数 0）；**剩**宿主侧独立验收基线（Host 另存独立于任务仓的断言资产并运行）、按任务类型最小验证策略、测试配置变更单独审查——均引入新的基线资产所有权/策略语义，属新目标 | 剩项需定目标 |
| 7 ◑ | A11 完整：预算余项 | **输出/日志容量上限已交付**（change `harden-output-budget-authority`，已归档：预算成为输出上限的唯一权威且实际生效）；**剩两项判断当前不宜做**——token 用量（Harness 无 token 字段，需扩展上游能力）、paused 状态（属领域状态机变更，需先确认目标） | 剩项为上游/新目标 |
| 8 ◑ | A10 完整：`tool-invocation` / `verification` 探针阶段 | **已交付有界增量**（change `harden-harness-capability-honesty`，已归档）：可证级别显式化、不可证级别显式不虚报、推导合并为一份、镜像/API 探针补报级别；真实集群探针 2/2 通过。**剩**：为这两级增设真实证据来源（需 Harness runner 上报工具调用 / 新增验证阶段，属新能力） | 剩项需上游/新能力 |
| 9 ◑ | A12 完整：卸载前 drain 检查 + 前端移交入口 | **drain 检查已交付**（change `harden-drain-and-verification-visibility`，已归档：只读 `@Remote('drainStatus')` 跨会话汇总非终态 Run 与未完成清理、给出 `safeToUninstall`，手册 §7 卸载前置并由测试绑定 Remote 名；**只读不自动清理**）。**版本可追溯已交付**（移交摘要 `packageVersion`/`eventProducerVersion`）。**剩前端移交入口**（UI 按钮导出摘要）未做 | 剩 UI |
| 10 ◑ | A05 完整：保留现场 UI 入口 + 磁盘体积上限 | **磁盘体积上限已交付**（change `harden-retention-capacity`，已归档：`sizeBytes` 有界测量 + `retainedBytes`/`measured`/`overBudget` 只读呈现）；**剩 UI 入口**未做 | 剩 UI（需浏览器套件） |

## P3 · 真实环境扩展与体验（按需）

| # | 事项 | 说明 |
| --- | --- | --- |
| 11 ◑ | 多宿主并发、真实依赖链矩阵 | **真实依赖链矩阵已完成**（`test:real-k3s-batch` suites 6/6 + 两节点 dogfood）；**跨进程锁互斥**已用真实 4 进程验证；剩**跨主机**（NFS/共享盘）语义未验证 |
| 12 ✅ | 完整 `run-real-k3s-batch` 的 `suites` 阶段 | 2026-09-11 已运行：3 套件 6/6 + TTL 回收 + 零残留归零，全通过 |
| 13 ✅ | 真实 worker 支线 | **已修复并通过**：根因是本仓缺陷——编排器只读守卫错误地施加到被委派的 Worker 子会话，拦截其全部修改类工具。修复（守卫按 `origin='subagent'` 排除子会话）+ 可诊断性（失败折入 Worker 报告）；change `harden-worker-tool-scope` 已归档；真实 `test:real-worker` 通过 |
| 14 | A8 剩余：跨卡片未保存草稿并存 + 移动端 | 需资源卡夹具，构造与维护成本高 |
| 15 ✅ | `check:release` 完整真实运行 | **本仓侧的不可满足性已修复并真实验证**：① 武装集缺陷（漏掉 `DSH_REAL_CRASH`/`DSH_REAL_APPROVAL` 两开关）已补齐为单一 `realWebGateEnvironment()`，并被 `check:release` 复用；② **凭据只查不注入**缺陷已修（门禁现把凭据解析结果注入子进程 env，否则 record 套件在 `beforeAll` 因缺 key 失败并被计为跳过）；③ 新增「从套件源码反推必需开关」守卫防复发。修复后 `test:real-web-gate` **真实全绿**（20 套件 / 21 测试，0 跳过 0 失败）。**剩余阻断仅上游**：`check:release` 首个真实步骤 `verify:profile` 需已安装官方 CLI，而官方 `0.1.5-rc.1/rc.2` 均缺 `externalEventProducers` 能力（见第 18 行） |

## D · 需你裁决 / 属新目标

| # | 事项 | 状态 |
| --- | --- | --- |
| 16 | F03 触发前置「**已成功节点重跑**」能力 | `code-input-staleness` 检测器已交付，但当前生命周期下「前序成功后再重跑」不可达，功能永不触发。需先确认是否新增此能力（当时选 B：功能保持现状） |
| 17 | `deployed` 枚举语义、不可信代码强隔离 | **已裁决：保持现状**（无需动作；文档措辞已按 P0-1 修正） |

## C · 阻断于上游

| # | 事项 | 说明 |
| --- | --- | --- |
| 18 ◑ | 官方 DSH 发行版安装/启动/升级/卸载验收 | **已按新版实测复核（2026-09-11）**：装入官方 `@deepseek-ai/dsh` 的 `0.1.5-rc.1`（`latest`）与 `0.1.5-rc.2`（`next`），二者均可安装、`--version` 正常，但 `verify:profile` 真实失败于 `PactFlow requires DSH external Session event producers; this DSH runtime is unsupported`。已确认该能力（`sessions.externalEventProducers`）仅存在于开发源码、两个官方发行版都没有 → **确为上游能力缺口**。待上游发行版纳入该能力后复验 |

## E · 收尾

| # | 事项 | 说明 |
| --- | --- | --- |
| 19 ✅ | 提交 / 推送 / 主目录同步 | **提交**已范围化到本地分支（`.arts`/`.mimosa`/`.zcode` 已入 .gitignore）。**推送已完成**（2026-09-11，用户授权）：`git push -u origin codex/pactflow-hardening`，`local==remote`、0/0。**主目录同步**（`/Users/ty/Codes/dsh-pactflow`，`main=818a1d9`，纯 fast-forward）仍属 Git 变更操作，待单独授权 |

---

## 当前状态：无待裁决项

E-19 主目录同步**已执行**（`/Users/ty/Codes/dsh-pactflow` 的 `main` 已 fast-forward 到本分支）。P2-6 的 A03-a 与 A12-a/b **已按授权实现并归档**（change `harden-drain-and-verification-visibility`）。

**仍属新目标、需另行定目标（未做，不影响当前正确性）**：

- A03 的**宿主侧独立验收基线**（Host 另存独立于任务仓的断言资产并运行）、**按任务类型最小验证策略**、**测试配置变更单独审查**——引入新的基线资产所有权与策略语义。
- A12 的**前端移交入口**（UI 按钮触发导出移交摘要）。
- A05 的**保留现场 UI 入口**、A11 的 paused 状态等（见上表）。

**已裁决无需动作**：`deployed` 语义、强隔离承诺、F03 触发前置——均「保持现状」。
**上游阻断（不需你现在动作）**：官方 DSH 发行版兼容复核（`externalEventProducers` 缺口，见第 18 行）——`check:release` 的最后一个真实步骤（`verify:profile`）依赖它，故 `check:release` 目前仅剩此上游阻断；本仓侧的门禁不可满足性已修复。
