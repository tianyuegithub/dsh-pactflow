# gitea-review-gate-closure

## Why

当受保护默认分支配置了 required approvals 或 status checks 时，收口在 `src/index.ts` 的这一行直接放弃：

```
PactFlow closing cannot auto-merge while Gitea approvals or status checks are required
```

用户必须离开零脉，去 Gitea 网页手工建 PR 或手工合并。这不是一个体验问题，而是**直接抵触架构 §4 不变量**：

> 只有宿主在受保护默认分支上完成合并、复验与祖先链核验后才产生交付终态。

手工合并产生的交付终态不经宿主，于是：祖先链核验没做、任务集合是否精确对应本次基线没核、清理责任没有先于交付记录持久化、`pactflow/release-recorded` 里的 merge commit 是人事后补录的而非宿主核验所得。换句话说——**一旦仓库按业界常规开了分支保护，零脉最强的那道保证就自动失效了**。

这条限制同时把零脉挡在真实团队场景之外：required approvals 与 CI status checks 正是受保护分支的标准配置，不是边缘情况。

现有设施其实已经接近可用：`gitea.ts` 已有 `verify()` 返回 `requiredApprovals` 与 `statusChecks`、已有 `createPullRequest` / `findPullRequest` / `mergePullRequest`，收口侧已有 `closingInputDigest` 与清理账本承载「上次收口到哪了」。缺的是**一个持久的等待态**，以及围绕它的复查与失败关闭语义。

## What Changes

- **closing 阶段新增持久子状态「等待外部评审」**：宿主创建（或复用）PR 后，把 PR 编号、head 提交、base 分支、`closingInputDigest` 一并落为持久事实，需求停在 closing 而非失败退出。该状态跨进程重启可恢复。
- **宿主按需复查而非阻塞轮询**：复查由用户显式触发，或由有界的低频后台复查推进（间隔与最大次数取既有运行时合同，不引入第二套硬编码）。复查结果（还缺几个批准、哪些检查未过/失败）回填为可见状态，呈现在工作台与项目面板。
- **前置齐备后由宿主完成合并**：批准数达标且全部 status checks 成功后，宿主执行合并，并继续执行既有的复验、祖先链核验与任务集合核验——**合并路径与现有无保护分支路径共用同一段核验代码**，不分叉出第二套收口。
- **失败关闭**：PR head 与登记的提交不一致、base 分支变更、任务集合与本次基线不符、`closingInputDigest` 漂移、检查由成功转为失败、复查次数耗尽——一律拒绝合并并保留等待态供人处置，MUST NOT 自动合并、MUST NOT 静默重建 PR。
- **权限边界不变**：宿主 MUST NOT 调用 Gitea 的 approve/review 提交接口，MUST NOT 以任何方式代替人批准，MUST NOT 修改分支保护规则，MUST NOT 使用管理员强制合并。检查失败时 MUST NOT 重试 CI。
- **Agent 与 Worker 边界不变**：Agent 可读等待态，MUST NOT 触发合并；`pactflow_close_git_need` 的语义保持「请求宿主收口」，宿主自行判定进入等待还是直接合并。
- **取消贯通**：用户取消收口时撤销等待态与在途复查；已创建的 PR 不自动关闭（它是人可见的外部对象），但等待态解除并如实记录。
- **非目标**：不做 CI 的触发与重跑；不做审批人指派与提醒；不做 GitHub/GitLab 适配（Git Provider 抽象保持，本 change 只落 Gitea）；不做「超时后降级为无保护合并」这类绕过分支保护的路径。

## Capabilities

### New Capabilities

- `gitea-review-gate`: 受保护分支要求外部评审与检查时的收口等待态合同——持久等待态与冷恢复、复查的触发与有界性、状态回填与可见性、前置齐备后的宿主合并、身份漂移与检查回退的失败关闭、宿主永不代替人批准的权限边界。

### Modified Capabilities

- `git-closing-integrity`：新增「受保护分支要求外部评审时收口必须进入持久等待态而非放弃」Requirement，并明确等待路径与直接合并路径共用同一段复验与祖先链核验；精确界定「外部手工合并」的处置——**后台复查 MUST NOT 自动追认**，而人或模型再次显式请求收口时走既有 `merged === true` 核验路径即为处置动作。
- `need-autopilot`：新增「挂机遇等待外部评审态必须持久暂停推进而非失败或空转」Requirement——等待态是十阶段里一个全新的「停着但没失败」的位置，挂机合同此前没有它。

## Impact

- **Host**：`src/index.ts`（`closeGitNeed` 的 required approvals / status checks 分支由抛错改为进入等待态；复查入口 `@Remote()`）、`src/gitea.ts`（复查所需的 PR 审批数与检查状态读取）、`src/domain.ts`（等待态的事件 payload 可选字段与 Delivery 投影 `stateVersion` 升级）、`src/host/recovery.ts`（重启后恢复等待态）。
- **Session Event**：**不新增事件类型、不升生产者版本**——等待态经既有 `pactflow/release-recorded` 与清理账本相关事件的 payload 可选结构化字段表达（payload schema 非 strict，旧读端剥离未知键即可读）。这与 `artifact-ref-handoff` 的同类处理一致。
- **Client**：工作台「验收交付」页签与项目面板呈现等待态与缺口明细（缺几个批准、哪些检查未过），提供显式「复查」按钮。
- **Agent**：只读可见，不新增写工具。
- **挂机（need-autopilot）**：`src/host/autopilot-driver.ts` 识别等待态：不计为「无有效进展」、不消耗编排模型调用循环、触发有界复查、持久可见；复查齐备后宿主合并并按既有「真正完成」条件标记挂机完成。挂机 MUST NOT 因等待态调用 `pactflow_block_autopilot`（那是异常阻塞的语义），也 MUST NOT 反复唤醒模型询问「是不是好了」。
- **与 `node-rerun-authorization` 的耦合**：该 change 的失败关闭第 2 条「节点提交已合并入默认分支 → 拒绝重跑」正是为本 change 的「外部手工合并」场景而设——两个 change 互为前提，实施顺序任一在先均可，但后实施者 MUST 复核前者的对应场景仍成立。
- **Worker Provider**：不涉及。
- **架构对应**：直接服务架构 §3 终局能力 7（代码收口）与 §4 不变量「交付终态只由宿主完成 Git 收口后产生」。本 change 是把该不变量从「无保护分支」扩展到「受保护分支」，不放宽任何一条。
- **验证路径**：真实受保护 Gitea 仓库 + 真实 required approvals + 真实 status checks，按仓库既有纪律**不走 mock**。需要真实 CI 与人在网页上真实点批准。
