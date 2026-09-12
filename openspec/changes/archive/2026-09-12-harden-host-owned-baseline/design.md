## Context

见 `proposal.md`。已核实的机制事实：

- 收口集成验证在 `prepareClosing`（git-workspace.ts）的新建路径执行：merge 任务分支 → `validateResult`（宿主解析命令，非零退出即拒绝，收口阻断）→ 推送集成分支。既有早退路径（prior closing 已推送）复用身份，不重跑验证。
- 验证证据 `PactFlowValidationEvidence` 恒为 `exitCode: 0`（失败走拒绝路径）；`PactFlowClosingGit` 持久化于收口清理责任（`cleanupSchema.closing`），经折叠存活。
- 基线权威来自**宿主配置**（workspace config）而非任务绑定——故基线**不经过** `assertPactFlowValidationAuthorization`（那是"仅绑定命令可执行"的断言，基线的授权来源不同且同等人所有）。

## Goals / Non-Goals

**Goals**：基线资产（人写、宿主存）；收口在候选提交上先于任务验证执行基线；证据独立标识并持久化于收口记录；失败阻断并指名命令；未登记时行为不变。

**Non-Goals**：不在合并提交（merge commit）上二次复跑基线（候选提交已覆盖合同要求；F05 的合并复验沿用任务验证语义）；不做基线自动生成；不给模型任何基线读写路径；不为基线引入任务仓内存储。

## Decisions

### 决策 1：执行点 = `prepareClosing` 新建路径，先于 `validateResult`

- **理由**：这是候选提交构造完成、任务验证运行前的唯一点；先跑基线保证"基线拦截不依赖任务验证先通过"。
- **实现**：直接复用 `runValidation`（execFile、无 shell、超时、最小环境）——失败即拒绝，外包一层指名「host baseline」的错误；成功证据加 `source: 'host-baseline'`。

### 决策 2：证据持久化于收口记录（`PactFlowClosingGit.baselineValidations?`）

- **理由**：收口不是 Run，`gitResult` 不适用；收口清理责任已持久化且折叠存活（schema 增可选字段即可）。交接摘要的未完成责任条目附带基线执行数。
- **取舍**：收口成功且清理完成后该记录移除——基线证据的长期留痕以收口当时的交付为准（与收口验证同寿），不在 release 记录重复。

### 决策 3：配置为扁平命令数组 `hostBaselineCommands?`，Remote 内做与既有验证命令一致的边界校验

- **理由**：与 legacy `validationCommands` 同形，最小认知负担；边界（1s–1h、args ≤64×4096、无 \0\r\n）在写入时强制。

## Risks / Trade-offs

- [基线命令在宿主机执行，写坏人可写任意命令] → 基线仅经客户端配置路径写入（与验证配置同一信任级、同一锁与 CAS），模型不可达；这正是"宿主自有"的定义。
- [基线使收口变慢] → 与任务验证同量级；未登记基线时零开销。
- [早退复用路径不重跑基线] → 首次收口已跑且提交身份已验证；与任务验证的复用语义一致。

## Migration Plan

1. types/domain schema 增字段（向后兼容）。
2. `prepareClosing` 增基线参数与执行；`closeGitNeed` 传入并传递 workspace 配置。
3. `saveHostBaseline` Remote + 项目面板 JSON 编辑区（owner-only 高级配置）。
4. 交接摘要附带基线执行数。
5. 单测（执行/标识/失败阻断/未登记不变/保存边界/交接计数）→ check → validate → archive。
