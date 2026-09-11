## Why

2026-09-11 的 Mimosa 深度扫描（`scan-2026-09-11T06-24-14.686Z-93cb38201725`，seal `sha256:732c2a60…`）把 19 条 high 级 SSRF finding 锚定在本仓的出网点上（`giteaFetch`/`request`/`verify`/`findPullRequest`/`mergePullRequest`/`createRepository`/`getRepositoryById`/`probeModelConnection`）。经人工核实，这些是**真实的出网面**而非证明可利用——但扫描器**无法静态证明**「谁控制 URL」。逐点核查后确认本仓已有分层事实：

- **Agent 面**（模型可达工具）：`pactflow_bind_git` 只收 `gitea_provider_id`（工具描述明言 "Never pass a raw endpoint"）；派发工具只收 template/profile/connection **id**，解析失败即抛（`modelConnection(id)` 等 "not configured" fail-closed）。
- **操作员面**（客户端 Remote）：`discoverModels` 与 `probeInfrastructure(draft)` **设计上**接受设置表单的未保存草稿端点（操作员亲自填写的辅助探测）；凭据一律经已注册 credential ref 解析。
- **Gitea 携凭据出网**已由 `git-credential-binding`（F01）合同与真实 HTTP 服务器计数测试覆盖。

缺的是把「出网 URL 来源分层」本身写成**可证伪的合同**：目前没有任何测试守卫「Agent 工具 schema 永不暴露端点参数」「未注册 id 在零出网下失败关闭」——未来新增一个带 `base_url` 参数的工具不会有任何检查失败。本 change 把该不变量落为合同与守卫，使扫描器无法证明的性质变成仓库内可验证的事实。

## What Changes

- 新增守卫测试 `tests/egress-url-origin.spec.ts`：
  - **Agent 工具 schema 无端点参数**：加载真实 preset 插件，枚举全部 `pactflow_*` 工具 schema，断言无任何参数名匹配 URL/端点/地址类模式（新增违规工具即失败）；
  - **Agent 面不含表单探测工具**：`pactflow_*` 工具名集合不含 discover/probe 类工具（它们只属于客户端设置表单）；
  - **未注册模型连接零出网失败关闭**：`probeInfrastructure` 以未注册 id 探测 → 在任何 fetch 之前抛 "not configured"（fetch 计数为 0）；
  - **草稿探测的凭据未配置零出网失败关闭**：`discoverModels` 的 credential ref 未配置 → 在调用 LLM 发现之前抛错（`llm.discoverModels` 计数为 0）。
- 新增 capability spec `egress-url-origin`（合同见 specs/）。

不改任何运行时行为——本 change 是**把已成立的不变量钉进合同与测试**；若守卫发现未来回归，回归本身才是缺陷。

## Capabilities

### New Capabilities
- `egress-url-origin`: 出网目标的来源分层合同——Agent 面只能以注册 id 引用出网目标且不得暴露端点参数；操作员设置表单的探测辅助可携带草稿端点但凭据仅经注册引用、且不得出现在 Agent 面；两者都必须在未解析到注册配置时于零出网下失败关闭。

### Modified Capabilities
（无。Gitea 携凭据出网已由 `git-credential-binding` 覆盖，本 change 不重复其要求。）

## Impact

- **测试**：新增 `tests/egress-url-origin.spec.ts`（4 项，全部离线、零真实出网）。
- **运行时**：零改动；Host/Agent/Client/Remote/Session Event/Worker Provider 各面行为不变。
- **兼容**：纯新增测试与 spec，无 API/行为变化。
- **对应扫描**：处置 Mimosa 19 条 high SSRF finding 的「URL 控制链不可证」缺口；处置结论记录于 `docs/security-scan-20260911.md`（新）。
