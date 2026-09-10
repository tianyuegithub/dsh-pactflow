# 实施进度

## 2026-09-10

### 第 1 组：基线固定与最小验收护栏

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 基线固定 | ✅ | `baseline.md`；`git-workspace.ts` 摘要 `83ab0680…` 与 GPT 评审包内记录逐位一致 |
| 1.2 最小验收门禁 | ✅ | `scripts/acceptance-gate.mjs`（`evidence:verify`）；6 项测试 |
| 1.3 报告保全 | ✅ | `scripts/evidence-store.mjs`；接入 `check-release`/`run-real-web-gate`；1 项测试 |
| 1.4 骨架登记 | ✅ | `tests/real-suite-inventory.spec.ts`（5 项） |
| 1.5 基线全绿 | ✅ | 修复前 `pnpm run check`：34 文件 / 366 测试 |

顺带修复 SCRIPT:R03：`evidence-schema.mjs` 的 `blocking` 注释称可选、`hasExactlyKeys` 实为必填。

### 第 2 组：F01 凭据与目标绑定

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 2.1 失败测试 | ✅ | `tests/git-credential-binding.spec.ts` 先红 |
| 2.2 参数收敛 | ✅ | Agent 工具暴露 `gitea_provider_id`，移除自由 endpoint/凭据字段 |
| 2.3 Provider 解析 | ✅ | `PactFlowInfrastructure.giteaProvider`；`bindGit` 解析 endpoint/credentialRef/仓库 |
| 2.4 remote↔Provider↔repo | ✅ | 复用 `matchGitea` + providerId 一致性校验（host 级） |
| 2.5 重定向/协议 | ✅ | `giteaFetch` 用 `redirect: 'manual'` 拒绝 3xx；新增重定向测试断言另一源零携凭据请求 |
| 2.6 旧绑定阻断 | ✅ | `effectiveGiteaBinding` 对不匹配登记 Provider 的历史绑定抛错 |
| 2.7 正常对照 | ✅ | 合法 `providerId` 绑定成功；错误路径不泄露凭据 |
| 2.8 全量 | ✅ | `pnpm run check` 通过 |

### 第 3 组：F02/F08 创建资源身份链

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 3.1/3.2/3.3 失败测试 | ✅ | `tests/k3s-resource-identity.spec.ts` 5 项先红 |
| 3.4 创建前意图持久化 | ✅ | `src/run-ledger.ts` + worker `run()` 先写 intent、后写 confirmed；`tests/run-ledger.spec.ts` 3 项 |
| 3.5 owned 集合 UID 删除 | ✅ | `compensateOwned` 替换按名补偿；409/同名替换不删 |
| 3.6 unknown 状态 | ✅ | 创建超时/无 UID 记 unknown 不按名删除；删除超时保留 unknown |
| 3.7 秘密释放 | ✅ | `pendingRuntimeSecrets` 各失败/取消终态释放 |
| 3.8 正常对照 | ✅ | 合法创建后按 UID 删除成功 |
| 3.9 全量 | ✅ | 既有 `k3s-worker.spec.ts` 的 7 项按名补偿断言改写为 UID 语义后通过 |

### 第 4 组：跨模块与文档

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 4.1 客户端同步 | ✅ | 客户端一直使用 `giteaProviderId`，无自由端点字段 |
| 4.2 实施状态 | ✅ | `docs/implementation-status-实施状态.md` 新增 2026-09-10 段 |
| 4.3 已知未覆盖 | ✅ | `known-gaps.md` |

## 当前验证

`pnpm run check` 通过：39 个测试文件、402 项测试、13 项包产物；`git diff --check` 通过。

## spec 场景覆盖审计

两份 spec 共 22 个 `#### Scenario`，已逐一映射到显式测试：

| 场景组 | 覆盖测试 |
| --- | --- |
| 登记 Provider 正常绑定 / 非登记端点拒绝 / 匹配不被绕过 | `git-credential-binding.spec.ts`（7 项） |
| 不同仓库拒绝 / 错配凭据引用拒绝 / 错误路径不泄露凭据 | `git-credential-binding.spec.ts` |
| 跨源重定向不携授权 | `gitea.spec.ts`（redirect refused） |
| HTTP 降级默认拒绝（回环例外） | `infrastructure.spec.ts` |
| 旧绑定不被自动认领 | `git-credential-binding.spec.ts` |
| 意图落盘失败零创建 / 意图不含虚构 UID / UID 回执 | `k3s-resource-identity.spec.ts` + `run-ledger.spec.ts` |
| 409 不删既有 / 同名替换不删 / 孤儿精确回收 / 无 UID 不按名删 | `k3s-resource-identity.spec.ts` + `k3s-worker.spec.ts` |
| 创建超时 unknown / 迟到创建不被 404 抹除 | `k3s-resource-identity.spec.ts` |
| finalizer 不冒充已清理 / 删除失败保留责任 | `k3s-resource-identity.spec.ts` |
| 创建失败不残留秘密 / 取消与丢弃路径释放 | `k3s-resource-identity.spec.ts` |

## 设计裁决（本轮补完）

- **remote↔Provider↔repo 归一化**：主机名 + 登记 API 子路径精确前缀匹配；**端口不参与匹配**（SSH 22 与 HTTPS 443/3000 本就不同）；`matchProviderRepository` 去掉登记前缀后取 owner/repo；子路径之外不解析。`tests/infrastructure.spec.ts` 覆盖。
- **服务端请求 SSRF 姿态**：`safeHttpUrl` 已限定 http/https；「拒绝环回/私有地址」未施加于用户登记的基础设施端点，因其与自托管 Gitea（192.168.x.x）、本地测试（127.0.0.1）、本地模型冲突；真正的 SSRF 前置已由 F01 消除（模型只能选 `providerId`，不能提交任意 URL）。详见 `known-gaps.md` §4。

## 归档前置条件（已满足）

真实环境 B 类验收（用户 2026-09-10 授权「全部真实套件」）结果，详见 `b-class-acceptance.md`：

| 套件 | 结果 | 与本 change 关系 |
| --- | --- | --- |
| `test:real-k3s` | ✅ 6/6 | 直接验证 F02（真实 Pod 施工/验证/结算、探针清理） |
| `test:real-gitea` | ✅ 1/1 | 直接验证 F01（受保护分支 + 真实 PR 合并 + 清理） |
| `test:real-worker` | ❌ no commit | 不在本 change 范围（F03/F07/worker 角色）；与既有记录一致 |
| `test:real-probe-ledger` | ❌ 骨架未实现 | 真实集群账本对账未实现；本 change 账本逻辑由隔离测试覆盖 |
| `test:real-crash-restart` | ❌ 骨架未实现 | 真实跨进程崩溃未实现；本 change 启动对账逻辑由隔离测试覆盖 |

清理归零（只读）：K3s `pactflow` ns 任务/容器组归零（仅剩 7 天前既有 Job）；Gitea 验收仓库无遗留任务/集成分支。


