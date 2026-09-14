# spec-corpus-corrections

## Why

全仓评审的第四路（文档与合同一致性）逐条比对了 51 份 spec 与代码，发现**若干条 spec 正文与已交付并经评审的代码相反**。这类不一致比代码缺陷更隐蔽：spec 是行为合同的唯一正文，后续任何人读到的都是错的那一份，而代码是对的。

四条已定位到具体行号并复核：

1. **复查节奏合同的前提本就不成立**。`gitea-review-gate` 写「其间隔与最大次数 MUST 取既有运行时合同，MUST NOT 引入第二套硬编码上限」。但 `run-time-contracts` 管的是 K3s 所有权租约与 Job 墙钟的关系，与「多久问一次 Gitea」是两个问题——没有可继承的合同。代码因此建立了自有的有界合同（30 秒 × 40 次）并在注释中写明理由。归档 change 的 `tasks.md` 2.3 已记录「立项时的前提有误」，但 spec 正文与 design 从未回写。

2. **「Agent 面与 Worker MUST NOT 触发合并」比它自己的 Scenario 宽**。该 Requirement 的 Scenario 限定在「请求推进**处于等待态**的收口」，而 Requirement 正文写成了无条件禁止。实际设计是：`pactflow_close_git_need` 在无分支保护时执行正常收口，其前置是人给出的、与交付主体逐字节绑定的 verification 批准——那不是 Agent「代替人批准」，正文的无条件表述会把这条正当路径也写成违规。

3. **重跑的 attempt 上限要求写成「进入持久 paused」**，并明写「MUST NOT 以重复抛错表达」。但把 `paused` 写到一个 `succeeded` 节点上，是**为了拒绝一次操作而摧毁交付终态**，且没有任何路径能把 `succeeded` 放回去——该需求会永久无法收口。这一条正是上一轮评审抓出的高危缺陷，代码已改为「只拒绝、不改动任何状态」。spec 仍写着被否决的那种做法。

4. **`failure-scene-retention-policy` 内部两条 Requirement 互斥**。一条要求只读查询报告 `retainedBytes` / `measured` / `overBudget` 三项，另一条要求该查询「SHALL 只返回保留总数与超期清单」。后者的真实意图是「不得存在无契约、无调用方的助手」，但它把允许的字段写成了穷举清单，于是按字面读法，现网实现即违规。

## 需要用户裁决的一条（本 change 不擅自处置）

`node-rerun-authorization` 要求「该节点的提交已合并入受保护默认分支」的判定**以 Git 祖先链查询**进行，且「查询不可得时 SHALL 同样拒绝并指名『无法判定是否已合并』」。

代码实际只查本地投影 `delivery.releases[needId]` 是否存在，全函数无祖先链查询、无「无法判定」分支。投影缺失（冷恢复、跨需求分支、release 事件未落账）即**放行**。

两侧各有理据：
- **按 spec 实现**：更强、更符合失败关闭原则，但要在一个同步的只读 Remote 路径里引入远端 Git 查询，是实打实的设计变更（延迟、超时语义、离线可用性）。
- **按代码修 spec**：诚实，但把一条已经写下的失败关闭要求降级，且降级后的残余风险是真实的——一个已合并的节点可能被重跑。

**这属于「目标本身可能有缺陷」而非实现细节，因此不在本 change 内单方面处置，提请裁决。** 在裁决前，该条差异已如实记入实施状态的未处置清单。

## What Changes

- `gitea-review-gate`：复查节奏改为「自有的有界合同」，并要求该合同的取值与理由必须写在实现处；「不得触发合并」的禁止范围按其自身 Scenario 限定为等待态期间。
- `node-rerun-authorization`：attempt 预算耗尽改为「只拒绝、不改动任何状态」，并明写理由——在 `succeeded` 上写 `paused` 会摧毁交付终态且不可逆。
- `failure-scene-retention-policy`：把「查询面只含契约要求的内容」的判据由穷举字段清单改为「不得存在无契约、无调用方的助手」，与同文件要求报告三项的 Requirement 不再互斥。
- **非目标**：不改动任何代码；不新增能力；不处置上述需裁决的一条。

## Capabilities

### Modified Capabilities

- `gitea-review-gate`
- `node-rerun-authorization`
- `failure-scene-retention-policy`

## Impact

仅 `openspec/specs/` 正文。代码、测试、产物零改动——本 change 的全部内容是让合同正文与已交付且经评审的行为一致。
