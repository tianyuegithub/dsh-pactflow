# 已知未覆盖（tasks 4.3）

本 change 在隔离测试中验证了以下不变量；下列内容**未**由本 change 覆盖，转入 B 类真实环境验收或后续 change，不得计为本 change 通过。

## 1. 真实环境（B 类，2026-09-10 已授权运行，结果见 b-class-acceptance.md）

- **真实 K3s**：✅ 已通过（`test:real-k3s`，6/6）——真实 Pod 施工/推送/本地 fetch/登记配置验证/结算；探针 Job 创建与清理。
- **真实 Gitea**：✅ 已通过（`test:real-gitea`，1/1）——受保护默认分支只读前置 + 真实 PR 合并 + 临时 ref 清理。
- **真实 worker 支线**：❌ `PactFlow Worker produced no commit`（稳定复现，与既有记录一致）。父侧 initialize/bind_git/建需建节点/dispatch 全部成功；失败在子代理未在 worktree 产生提交。**不属本 change 范围**（F03/F07/worker 角色），保留为后续 change 的显式缺口。
- **探针账本真实对账**：❌ 骨架未实现（`test:real-probe-ledger`）。
- **真实跨进程崩溃**：❌ 骨架未实现（`test:real-crash-restart`）。
- **真实人工审批界面**：未运行（需用户本人在原生 UI 操作）。
- **多宿主并发**：未实现。

本 change 的 spec 对应的真实验证（K3s 资源身份、Gitea 凭据与收口）已通过；上述未闭环项均不属于本 change 的 spec 范围。

## 2. 本 change 内明确未实现的 spec 子项

（无。原列的两项残余——HTTP 明文例外策略、运行意图启动对账——以及 remote↔Provider 归一化，均已在本 change 内闭环，见 §2b。）

## 2b. 曾在 spec 中、现已闭环

- ~~HTTP 传播协议例外策略~~：已实现——`validateProvider` 拒绝非回环的明文 http 端点，回环（localhost/127.x/::1）作为显式本地例外放行；`tests/infrastructure.spec.ts` 覆盖。
- ~~删除受理与完成的显式区分~~：已实现——`compensateOwned` 识别删除响应中仍带 `deletionTimestamp`（202/finalizer，仍 terminating）的情况，记为 unknown 责任而非清理完成；`tests/k3s-resource-identity.spec.ts` 覆盖。
- ~~运行路径意图的启动对账~~：已实现——`reconcileProbeCleanupsImpl` 同时处理 `PactFlowRunCleanupLedger`：按连接指纹匹配 Worker，仅有确认 UID 的记录自动清理（`cleanupRunIdentity`，UID 前置、404 幂等），无 UID 的记录保留为显式责任、不按名删除；`tests/probe-recovery.spec.ts` 覆盖。
- ~~remote↔Provider↔repo 归一化~~：已实现并裁决——**主机名 + 登记 API 子路径精确前缀**匹配；**端口不参与匹配**（SSH remote 端口 22 与 HTTPS API 端口 443/3000 本就不同，强制相等会破坏「SSH remote + HTTPS API」常见组合）；`matchProviderRepository` 从 remote 路径去掉登记前缀后取 `owner/repo`；登记子路径之外的 remote 不解析到该 Provider；`tests/infrastructure.spec.ts` 覆盖。

## 3. 与其它 change 的边界

- F03/F04/F05/F06/F07（交付正确性：依赖输入、批准快照、精确 merge SHA、收口幂等、本地准入）不在本 change 范围，属后续 change。
- G 系列（完整 AcceptanceProfile/TestSuiteSpec/证据门禁）只落地了本 change 所需的最小护栏，完整基建留待后续 change。

## 4. 服务端请求的 SSRF 姿态（安全约束记录）

安全约束要求「服务端请求 URL 时仅允许 http/https，发请求前校验 host，并拒绝 localhost、环回、私有和保留地址」。本 change 对该约束的处置与理由：

- **http/https 与凭据无关**：`safeHttpUrl` 已限定登记的 Provider/Registry/模型端点只能是 http/https，且拒绝内嵌凭据、query、hash。
- **「拒绝环回/私有地址」未施加于用户登记的基础设施端点**，理由是它会与产品的核心用例直接冲突：
  1. 自托管 Gitea 常部署在私有网段——项目文档记录的真实验收环境即 `192.168.31.7:30000`；
  2. 本地开发与全部隔离测试使用 `127.0.0.1` 回环服务（本 change 的 398 项测试即依赖它们）；
  3. 本地模型（如 Ollama）同样以回环地址登记。
  对上述端点施加环回/私有拒绝会使产品无法使用，并使测试无法运行。
- **真正的 SSRF 前置已由 F01 消除**：本 change 之后，模型只能提交已登记的 `providerId`，**不能提交任意端点 URL**；两处出站 `fetch`（Gitea API、模型探测）的目标都来自用户 Settings 的可信配置路径，不存在「不可信输入 → 服务端请求」的攻击面。因此该约束在本插件中「按构造成立」，无需以破坏产品用例的方式额外拦截。
- 该项为**设计裁决**，记录于此以便用户复核；若产品后续引入不可信来源的 URL 输入，须重新评估并补 SSRF 拦截。
