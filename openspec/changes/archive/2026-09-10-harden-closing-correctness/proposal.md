## Why

GPT 全面评审（2026-09-10）复现了两个 P1 交付正确性缺陷，均位于 closing 合并路径：

- **F05**：交付记录绑定的是默认分支当时的 tip，而不是被验证的精确合并提交。`verifyClosingMerged` 只检查 integration 是默认分支 tip 的祖先，随后把最新 tip 写入 `release.commit`。若合并后默认分支前进，本次交付就会错误绑定一个从未被验证的提交。
- **F06**：`release-recorded` 与阶段推进是两个事件；若前者成功落账、后者未完成时中断，正常重试会重新生成 `recordedAt` 不同的 release，被投影的「已记录 release 不得变化」规则拒绝，Need 永久卡在 closing。

两者都违背目标架构 §4 不变量「交付终态只由宿主完成 Git 收口后产生」与计划已冻结的「release 指向精确且验证过的 commit」。修复成本明确，应先于 F03/F04/F07 关闭。

## What Changes

- **精确交付提交（F05）**：合并后对 Gitea 报告的精确 merge SHA 做独立复验——把它取回、在隔离目录检出、运行同一套登记验证命令、要求它是默认分支可达提交且包含 integration 提交；`release.commit` 记录该被复验的 SHA，而不是默认分支 tip。祖先检查退为附加证明。
- **收口幂等恢复（F06)**：收口重试时若已存在该 Need 的 release，则**原样复用**其 `commit`/`branch`/`serviceUrl`/`recordedAt`，不再重建、不再重复合并，仅补齐缺失的阶段推进；已合并的 PR 不重复合并，任务集合与集成身份继续按既有输入摘要核对。

## Capabilities

### New Capabilities
- `git-closing-integrity`: 交付记录必须绑定宿主独立复验过的精确合并提交；收口在 release 与阶段推进之间中断后必须幂等恢复，不重建记录、不重复合并。

### Modified Capabilities
（无；`openspec/specs/` 现有两个 capability 的行为不变。）

## Impact

- **Host**：`src/index.ts` 的 `closeGitNeed`（合并后复验、release 构造与 append、阶段推进）；`src/git-workspace.ts` 的 `verifyClosingMerged`（改为复验精确提交）。
- **领域层**：`src/domain.ts` 的 release 折叠规则不变（仍拒绝已记录 release 变化）；`src/types.ts` 若需承载复验提交则最小扩展。
- **测试**：`tests/closing.spec.ts`（真实临时 Git + 本地 Gitea HTTP 替身）扩展 F05/F06 负例与正常对照。
- **兼容**：不修改 DSH 核心、Hermes 或旧 `data-governance`；不改调度、凭据、K3s 资源身份合同；旧日志只读兼容不变。
