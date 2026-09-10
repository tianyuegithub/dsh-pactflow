## Why

两份 2026-09-10 评审在真实源码上复现了两个 P0 信任/破坏边界缺口（FULL:F01、FULL:F02）：凭据引用可与任意 Gitea API 地址组合后把已登记令牌发往非登记目标；K3s 创建冲突（409）或返回超时后仍按可重用名称补偿删除，可能删掉不属于本轮的资源。这两处都违背目标架构 §4 不变量「原始凭据不得外发到未授权目标」「持久资源删除必须携带精确身份，未确认身份不得按名删除」，且都在当前 `codex/pactflow-hardening` 工作树中可指认。修复成本低、风险窗口明确，应在继续堆叠其它加固前先关闭。

## What Changes

- **凭据绑定到登记 Provider（FULL:F01）**：Agent 工具不再提交任意 `gitea_base_url` + `gitea_token_credential_ref` 组合。Agent 只选择用户登记的 `providerId`、仓库身份与非敏感选项；Host 由已批准配置解析 endpoint、credentialRef、认证方式和允许仓库。绑定前校验 remote ↔ Provider ↔ repo 一致；跨源重定向不携授权；HTTP 仅限用户显式允许的本地例外。合规旧绑定提供迁移/只读路径，不静默改协议。
- **创建资源身份链（FULL:F02）**：K3s 创建路径改为「意图先行 + UID 回执」两阶段。只有服务端返回并持有 UID 的对象进入本轮 owned 集合，对这些对象使用 UID 前置条件删除，不要求其先具备 Job ownerReference。创建返回 409 的对象从不属于本轮，不删除。创建超时/响应丢失记录为 `create-outcome-unknown` 并保留责任，不臆造身份、不按名称兜底删除。删除请求被接受（202/finalizer）不等于对象已消失，必须继续核实。
- **失败路径内存秘密释放（FULL:F08 的最小相邻部分）**：创建失败、取消、准备对象丢弃时统一释放 `pendingRuntimeSecrets` 中的本运行秘密；释放引用不等于远端令牌撤销，两者分别记录。
- **最小验证护栏**：为上述负例建立最小验收门禁与证据保全（先失败后通过），使后续修复不会「无证据过关」。

## Capabilities

### New Capabilities
- `git-credential-binding`: Agent 只能选择用户登记的 Git/Gitea Provider 与仓库身份；Host 解析 endpoint/认证/凭据引用并校验 remote↔Provider↔repo 对应，保证原始凭据不进入 Session Log、Remote payload、Tool result、Git、argv、截图或持久日志，也不被发往非登记目标。
- `k3s-resource-identity`: K3s 运行与探针创建的持久资源具备可核验身份链（创建前授权意图 → 创建后 UID 回执）；只有已确认归属的对象可被删除；未知身份/超时保留责任并失败关闭；删除受理与删除完成分离。

### Modified Capabilities
（无；`openspec/specs/` 为空，本 change 全部为新增 capability。）

## Impact

- **Host**：`src/index.ts`（`bindGit`、`verifyGitea` 的 Provider 解析与校验）、`src/git-workspace.ts`（`gitea()` 构造与 remote 匹配）、`src/infrastructure.ts`（Provider 解析/`matchGitea`）。
- **Agent**：`src/agent/index.ts`（`pactflow_bind_git` 工具参数与调用转发）。
- **Worker Provider**：`src/k3s-worker.ts`（创建/补偿/删除路径、`pendingRuntimeSecrets` 生命周期）。
- **Client**：项目面板 Git 绑定向导与结果不明对账卡片（若参数合同变化）。
- **脚本/测试**：`scripts/evidence-collect.mjs`、`scripts/evidence-schema.mjs`（最小护栏）；`tests/*`、`e2e/*` 新增负例与正常对照。
- **文档**：`docs/architecture-目标架构.md` §4 不变量对照；`docs/implementation-status-实施状态.md` 记录证据。
- **兼容**：不修改 DSH 核心、Hermes 或旧 `data-governance`；不引入中心服务端、第二份项目注册表或微服务；严格全局 FIFO 与「就绪即可认领」决策不变。
