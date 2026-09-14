# DSH 零脉 待办优先级清单

**日期**：2026-09-11（**2026-09-15 复核并更新基线与结论**，见文末）
**性质**：派生视图（非计划 owner）。计划与顺序的正文 owner 是 OpenSpec（`openspec/changes/`、`openspec/specs/`）；本清单只做跨 change 的三方汇总与优先级排序，供决策使用。
**当前事实基线（2026-09-15 实测）**：**61 个 change 已归档、48 个 spec 有效、1 个活跃 change（`artifact-ref-handoff`）**；`pnpm run check` **104 文件 / 745 用例（738 通过 / 7 环境门控跳过 / 0 失败）/ 19 必需产物**，全绿；`openspec validate --all --strict` **49/49**；分支 `main`，HEAD `f8fddaf`。

> 下表 P0–P3 各行的「为什么现在做」与证据均为 **2026-09-11/12 当时**的记录，保留作历史；各项的**当前结论**以文末「2026-09-15 复核」为准。

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
| 6 ◑ | A03 完整：宿主侧独立验收基线 | **零验证可识别与「改了测试配置」可见均已贯通到人眼前**（`verification-label` 显式标注 + `review-surface` 审批理由携带验证敏感清单，并修复字段被 zod 剥除的真实缺陷；change `surface-review-and-readonly-entries` 已归档）；**剩**宿主侧独立验收基线（Host 另存独立于任务仓的断言资产并运行）、按任务类型最小验证策略——均引入新的基线资产所有权/策略语义，属新目标 | 剩项需定目标 |
| 7 ◑ | A11 完整：预算余项 | **输出/日志容量上限已交付**（change `harden-output-budget-authority`，已归档：预算成为输出上限的唯一权威且实际生效）；**剩两项判断当前不宜做**——token 用量（Harness 无 token 字段，需扩展上游能力）、paused 状态（属领域状态机变更，需先确认目标） | 剩项为上游/新目标 |
| 8 ◑ | A10 完整：`tool-invocation` / `verification` 探针阶段 | **已交付有界增量**（change `harden-harness-capability-honesty`，已归档）：可证级别显式化、不可证级别显式不虚报、推导合并为一份、镜像/API 探针补报级别；真实集群探针 2/2 通过。**剩**：为这两级增设真实证据来源（需 Harness runner 上报工具调用 / 新增验证阶段，属新能力） | 剩项需上游/新能力 |
| 9 ✅ | A12 完整：卸载前 drain 检查 + 前端移交入口 | **已全部交付**：drain 检查（`drainStatus` + 手册 §7 前置，只读不自动清理）、版本可追溯（`packageVersion`/`eventProducerVersion`）、**前端移交入口**（change `surface-review-and-readonly-entries` 已归档：浮层「导出移交摘要」只读 JSON + 复制，e2e 覆盖） | 已完成 |
| 10 ✅ | A05 完整：保留现场 UI 入口 + 磁盘体积上限 | **已全部交付**：磁盘体积上限（`harden-retention-capacity`：`sizeBytes` 有界测量 + `retainedBytes`/`measured`/`overBudget` 只读呈现）+ **客户端只读呈现**（change `surface-review-and-readonly-entries` 已归档：浮层保留现场区呈现总数/体积/度量/超预算/逾期，e2e 覆盖） | 已完成 |

## P3 · 真实环境扩展与体验（按需）

| # | 事项 | 说明 |
| --- | --- | --- |
| 11 ✅ | 多宿主并发、真实依赖链矩阵 | **已关闭**（2026-09-12 用户裁决）：真实依赖链矩阵 ✅（suites 6/6 + 两节点 dogfood）；同机跨进程锁互斥 ✅（真实 4 进程）；跨主机锁语义 ✅ 防御性合同化（change `harden-cross-host-lock-semantics`，已归档：异宿主遗留锁失败关闭且绝不夺取、超时指名持有 host/pid——正常单实例部署下该分支永不触发，属零成本保险）。**跨主机双客户端部署 = 非目标形态，真实 NFS 验证不再排期**（与 2026-09-06「远程企业平台=永久非目标」裁决同族；runbook 留存于运维手册 §6.1，如未来主动选择该部署形态再启用） |
| 12 ✅ | 完整 `run-real-k3s-batch` 的 `suites` 阶段 | 2026-09-11 已运行：3 套件 6/6 + TTL 回收 + 零残留归零，全通过 |
| 13 ✅ | 真实 worker 支线 | **已修复并通过**：根因是本仓缺陷——编排器只读守卫错误地施加到被委派的 Worker 子会话，拦截其全部修改类工具。修复（守卫按 `origin='subagent'` 排除子会话）+ 可诊断性（失败折入 Worker 报告）；change `harden-worker-tool-scope` 已归档；真实 `test:real-worker` 通过 |
| 14 | A8 剩余：跨卡片未保存草稿并存 + 移动端 | 需资源卡夹具，构造与维护成本高 |
| 15 ✅ | `check:release` 完整真实运行 | **本仓侧的不可满足性已修复并真实验证**：① 武装集缺陷（漏掉 `DSH_REAL_CRASH`/`DSH_REAL_APPROVAL` 两开关）已补齐为单一 `realWebGateEnvironment()`，并被 `check:release` 复用；② **凭据只查不注入**缺陷已修（门禁现把凭据解析结果注入子进程 env，否则 record 套件在 `beforeAll` 因缺 key 失败并被计为跳过）；③ 新增「从套件源码反推必需开关」守卫防复发。修复后 `test:real-web-gate` **真实全绿**（20 套件 / 21 测试，0 跳过 0 失败）。**剩余阻断仅上游**：`check:release` 首个真实步骤 `verify:profile` 需已安装官方 CLI，而官方 `0.1.5-rc.1/rc.2` 均缺 `externalEventProducers` 能力（见第 18 行） |

## D · 需你裁决 / 属新目标

| # | 事项 | 状态 |
| --- | --- | --- |
| 16 ✅ | F03 触发前置「**已成功节点重跑**」能力 | **已实现（2026-09-15，用户推翻原裁决）**：change `node-rerun-authorization` 新增所有者授权的重跑，架构 §3.4 措辞相应修订为「未经所有者显式授权的终态复活」。过期检测由此获得首个生产消费者 |
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

## 当前状态（2026-09-11 当时）：无待裁决项

> **已过时**：2026-09-15 复核新增三项待裁决（21 / 22 / 23），见文末。

E-19 主目录同步**已执行**（`/Users/ty/Codes/dsh-pactflow` 的 `main` 已 fast-forward 到本分支）。P2-6 的 A03-a 与 A12-a/b **已按授权实现并归档**（change `harden-drain-and-verification-visibility`）。

**已立项并全部交付（2026-09-12，用户裁决「1-4 都做」；四项各自归档）**：

| 序 | change | 交付 | 关键测试 |
| --- | --- | --- | --- |
| 1 ✅ | `harden-minimum-validation-policy`（A03-b） | 最小验证策略（人写、宿主收口强制、模型零接口）；被引用 profile 删除被拒；客户端「收口必跑」勾选 | `validation-policy.spec.ts`（6） |
| 2 ✅ | `harden-host-owned-baseline`（A03-c） | 宿主自有基线在候选提交先于任务验证执行，失败阻断收口；证据带 host-baseline 来源持久于收口记录；交接附执行数；客户端 JSON 编辑区 | `host-baseline.spec.ts`（5） |
| 3 ✅ | `harden-budget-pause-state`（A11） | 预算耗尽 → 节点持久 paused（落账/可见/派发指名拒绝）；显式 resumeNode 恢复留痕；DAG 与浮层呈现 | `node-pause.spec.ts`（4） |
| 4 ✅ | `harden-card-draft-isolation`（A8） | 按键草稿 store；验证编辑器草稿跨卡片并存；面板关闭两步确认不静默丢弃；**真实缺陷修复**（编辑器挂载曾无条件标记 dirty 致关闭级联） | `card-drafts.spec.ts`（4）+ overlay e2e |


**已裁决无需动作**：`deployed` 语义、强隔离承诺、F03 触发前置——均「保持现状」。
**上游阻断（不需你现在动作）**：官方 DSH 发行版兼容复核（`externalEventProducers` 缺口，见第 18 行）——`check:release` 的最后一个真实步骤（`verify:profile`）依赖它，故 `check:release` 目前仅剩此上游阻断；本仓侧的门禁不可满足性已修复。

---

## 2026-09-15 复核

三方核对（目标架构 §3/§4/§7 ↔ OpenSpec ↔ 代码与实测）后，待办面收敛为四类：

### 唯一卡住「完成」的项 —— C 类上游，本仓不可控

| # | 事项 | 当前结论 |
| --- | --- | --- |
| 18 | 官方 DSH 发行版缺 `sessions.externalEventProducers` | **仍阻断**。2026-09-15 复查 npm：`latest=0.1.5-rc.1`、`next=0.1.5-rc.2`，与 2026-09-11 实证缺口的两个版本**完全相同，无新发行版**。连锁后果：`verify:profile` 在官方发行版上必失败 → `check:release` 第一个真实步骤过不去 → **架构 §7 的终止条件在上游发版前结构上不可达**。上游实现已在 fork 完成并经验收（`06d3202146`），PR 已按上游惯例提交；插件侧已就绪，发版后**无需改动** |

### 需真实环境才能推进的项

| # | 事项 | 当前结论 |
| --- | --- | --- |
| 20 | `artifact-ref-handoff` 任务 5.1 / 7.1 | **not-run**，如实未勾选。实现链完整且 fail-closed，缺的是真实 K3s + 真实 RustFS + UI 绑定后派发 + 真实模型额度。承载已铺好（`tests/artifact-handoff.real.spec.ts` + `pnpm run test:real-artifact`，未武装即显式失败）。**该 change 因此不得归档** |
| 6 | A03 剩项 | **已交付**：最小验证策略（`validation-policy`）与宿主自有基线（`host-owned-baseline`）均已落地并归档。本行关闭 |
| 14 | A8 剩余：跨卡片未保存草稿并存 | **已交付**（`card-draft-isolation`，`card-drafts.spec.ts` 4 项 + overlay e2e）。剩**移动端形态**未做，需资源卡夹具 |

### 本轮新发现（低成本，尚未处置）

| # | 事项 | 说明 |
| --- | --- | --- |
| 21 ✅ | `release-manifest.json` 的 `hostEventProducerVersion` 漂移 | **已修复（2026-09-15，change `manifest-producer-version-guard`，已实施待归档）**：修正为 `0.6.0` 并补守卫 `release-manifest-accuracy.spec.ts`（先红后绿），同族字段 `hostPluginVersion` 一并绑定；常量迁至 `src/domain.ts` 使单测可导入。`check` 105 文件 / 747 用例全绿 |
| 22 | 两处门禁设计张力 | ① `REQUIRED_NOT_RUN` 桶与 `check:release` 零跳过要求互斥（该桶当前为空，暂未触发）；② `real-web-gate-prerequisites` 靠正则反推必需开关，**改门控变量名即可绕过**。**待裁决是否加固** |
| 23 | 架构文档 §6 决策 1 表述过时 | 写着 `confirm-execution-granularity`「当前尚未归档」，实际已于 2026-09-13 归档。**架构文档变更权仅用户**，已出提案待裁决 |

### 已裁决为终态、不再是待办

`deployed` 语义 / 不可信代码强隔离 / F03 触发前置 / 跨主机双客户端部署 / A10 的 `tool-invocation` 与 `verification` 两级不可证 / A11 的 token 用量统计 —— 六项均已裁决「保持现状」或「非目标」，按规则**不应再计入待办面**。

A04（Gitea `waiting-review/waiting-checks` 协作闭环）仍是真实环境前置，非实现缺口。
