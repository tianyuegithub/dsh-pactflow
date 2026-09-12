## Context

见 `proposal.md`。已核实的接线事实：

- 策略检查插入点：`closeGitNeed` 在任务 run 证据齐备与 legacy 拒绝之后、任何外部（Gitea）调用之前。
- 证据形态：每个任务 run 的 `gitResult.validations`（command/args/exitCode…）；绑定持有 `validationProfileIds`（宿主解析的选择集）且 `assertValidationProfilesCurrent` 已保证 profile 注册内容 == 绑定解析内容（按 command+args 匹配稳定）。
- 配置存储：`workspace-projects.json`（`pactFlowWorkspaceProjectSchema`，CAS + 文件锁 + 同进程 promise 锁）；写配置 Remote 模式见 `saveValidationProfiles`。
- 客户端：项目面板已有「宿主验证配置」区与 CAS 保存流。

## Goals / Non-Goals

**Goals**：策略数据模型（组）；`closeGitNeed` 强制检查（缺失逐项指名，失败关闭）；`saveValidationPolicy` Remote（仅客户端路径）；项目面板「收口必跑」勾选；删除被策略引用的 profile 时拒绝；无策略时行为逐字不变。

**Non-Goals**：不加节点"类型"字段；不改派发路径；不做策略的模型可读接口；不做多租户继承。

## Decisions

### 决策 1：数据模型 = 配置上的组数组，v1 客户端只管理单组（id=`closing`）

- **理由**：schema 支持"一个或多个组"（合同原文），v1 UI 以每 profile 一个「收口必跑」勾选写单组，覆盖绝大多数需求且交互最简；多组留给未来 UI。
- **匹配语义**：profile 在候选提交上的成功证据 = 任务 run 的 `validations` 中存在 `exitCode===0` 且 `command`/`args` 与该 profile 注册值精确一致的条目。args 按序比较（参数顺序是语义）。修订漂移由既有 `assertValidationProfilesCurrent` 排除。

### 决策 2：检查点在 Gitea 调用之前（快速失败，零外部副作用）

### 决策 3：删除被策略引用的 profile 时拒绝保存

- **理由**：悬空引用虽也失败关闭，但保存期拒绝给出更早、更可定位的错误；两者同向（安全），取更早者。

## Risks / Trade-offs

- [每任务 run 都须有每个必跑 profile 的证据（严格读）] → 与合同"全部交付构件"一致；任务 run 本就执行绑定全集，正常路径天然满足。
- [策略与 profiles 分离存储可能失同步] → 保存期互相校验（policy 引用必须存在于 catalog；删除被引用者拒绝）。
- [客户端新增配置面] → 复用既有 CAS 保存模式与修订号；无新锁语义。

## Migration Plan

1. types/schema 增 `validationPolicy`（可选，向后兼容）。
2. `saveValidationPolicy` Remote + 删除引用拒绝。
3. `closeGitNeed` 强制检查。
4. 客户端勾选 + 保存。
5. 单测（强制/缺失/无策略/不可触及/删除拒绝）→ check → validate → archive。
