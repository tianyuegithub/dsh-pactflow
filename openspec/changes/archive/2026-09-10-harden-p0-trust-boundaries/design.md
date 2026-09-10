## Context

见 proposal.md（Why）：两处 P0 缺口都在当前工作树可指认。现有实现的关键事实：

- `src/git-workspace.ts` 的 `gitea()` 只校验 URL 形式（协议、内嵌凭据、owner/repo 字符集），不校验目标与登记 Provider 的对应关系；`src/index.ts` 的 `bindGit` 仅在 `inspected.gitea === undefined` 时才调用 `infrastructure.matchGitea`，因此显式提交 gitea 字段即可跳过匹配。
- `src/k3s-worker.ts` 的创建路径在内存中保存本轮已创建对象（`createdModelSecret`/`createdInputSecret`/`createdConfigMap`），但补偿函数 `compensateCreatedChildren` 按可重用名称删除，未使用 UID 前置条件；`deleteConfigMap`/`deleteInputSecret`/`deleteModelSecret` 把超时并入幂等成功。三处创建失败分支与 ownerReference 绑定失败分支均走名称补偿。
- 探针路径已有持久清理账本（`src/probe-ledger.ts`，意图先行、UID 确认、指纹匹配、损坏失败关闭），运行路径尚无等价的创建前意图记录；`pendingRuntimeSecrets` 仅在整体成功后才删除。

约束：单插件模块化单体；不引入中心服务端、第二份项目注册表或微服务；`Agent → Host` 权限分离不变（Worker 不写事实）；严格全局 FIFO 与「就绪即可认领」决策不变。

## Goals / Non-Goals

**Goals:**
- 让「凭据 → 目标地址」成为被显式授权的能力，Agent 无法自行组合出越权目标。
- 让每一次持久资源删除都基于精确身份（UID 或 expectedCommit），创建结果不明时保留责任而非猜测。
- 复用既有账本/清理机制，不新建第二套资源数据库。

**Non-Goals:**
- 不为「不可信代码执行」新增强沙箱/出网策略（属目标架构待裁决项，本 change 不含）。
- 不改变 Need 领域枚举、阶段门禁或调度公平性合同。
- 不实现完整 evidence gate / TestSuiteSpec（G 系列后续单独 change），本 change 只含证明自身所需的最小护栏。
- 不追求与 Gitea/K3s 的跨系统原子事务。

## Decisions

### D1：Agent 参数收敛为 Provider 选择（H1）

`pactflow_bind_git` 的 Gitea 相关参数由「自由 `gitea_base_url` + `gitea_owner` + `gitea_repo` + `gitea_token_credential_ref`」改为「`providerId` + 非敏感仓库身份」；Host 从已批准配置解析 endpoint、认证方式、credentialRef 与允许仓库。

- 备选 A：保留现有字段但追加「必须与某个 Provider 匹配」的校验。否决——模型仍可枚举组合，校验点分散在每个使用处，容易遗漏新的携凭据出口。
- 备选 B：让 Agent 提交 endpoint，Host 反查 Provider。否决——endpoint 由请求方决定，本质仍是「请求方选择目标」。

### D2：remote ↔ Provider ↔ repo 用规范化映射校验（H1）

匹配不得用字符串相等或仅 hostname。实现上按 Provider 登记的可达形式（SSH 与 HTTPS 变体、端口、API 子路径）归一化后比对，并要求请求声明的 owner/repo 落在该 Provider 允许范围内。Gitea API 与 Git fetch/push 两条认证链都要经过同一校验，避免只堵绑定工具。

### D3：重定向与协议默认失败关闭（H1）

受权 API 请求默认不自动跟随跨源重定向；确需跟随时逐跳核验允许来源与路径，任一跳不匹配即中止且不转发授权头。HTTP 默认拒绝，仅用户显式允许的、精确到环境与端点的本地例外放行。历史非合规端点保留待确认/阻断，不静默改协议。

### D4：历史绑定按只读/阻断处理（H1）

既有的「人工 endpoint + credentialRef」持久记录不自动升级为有效授权：保留可展示的审计信息，但在用户经可信路径重新确认 Provider 与仓库身份前，不允许据此发起携凭据请求，并给出可操作确认入口。这与既定 Gitea 创建结果不明对账的「人工确认精确编号」思路一致。

### D5：创建改为「意图先行 → UID 回执」两阶段（H2）

创建任何 K8s 资源前先持久化授权意图（操作编号、集群/namespace 身份、资源种类、选定名称/分配规则、数量上限、允许动作、用途、清理范围），**不含虚构 UID**；创建成功后立即持久化服务端 UID。意图写入失败即拒绝创建。运行路径复用/对齐探针账本（`probe-ledger.ts`）的原子写与失败关闭语义，不新建平行库。

### D6：以 owned 集合替代按名补偿（H2）

以本轮「创建请求成功且持有 UID」的对象组成 owned 集合；删除只针对集合内对象并携带 UID 前置条件，不要求先有 Job ownerReference。`compensateCreatedChildren` 的名称删除路径被替换：409 冲突对象不删除，check-then-delete 之间被同名替换则不删除替代对象。

### D7：unknown 是一等状态（H2）

创建超时/响应丢失记为 `create-outcome-unknown`，保留责任与对账入口，不做名称兜底删除；结果未定时的一次 404 不清除创建意图。删除侧区分 `delete-requested`（含 202/finalizer/terminating）与「指定 UID 已消失」；删除超时、403、连接错误保留责任并登记下次对账条件，不当作 404。

### D8：内存秘密引用用一次性释放（H2，F08 最小部分）

引入一次性、可 dispose 的准备对象语义：`pendingRuntimeSecrets` 在成功、失败、取消、超时与丢弃的每条终态路径释放。释放内存引用不等价于撤销远端令牌，两者分别验收；不通过删除身份不明资源来实现「释放」。

### D9：最小护栏随本 change 落地（G0/G1/G4/G6 的最小部分）

本 change 只建证明自身所需的最小门禁：固定输入基线（`HEAD` + dirty 状态 + 相关文件摘要）、负例先失败后通过、报告不在 finally 删除唯一证据；四个骨架 e2e（TTL/probe-ledger/crash-restart/real-approval）继续如实未运行，不计入覆盖。完整 AcceptanceProfile/TestSuiteSpec 留待 G 系列 change。

## Risks / Trade-offs

- [移除 `gitea_*` 参数破坏现有 Agent 调用与旧绑定] → 保留字段只读兼容并阻断，提供显式重新确认路径；同步更新 Client 绑定向导与对账卡片文案。
- [Provider 匹配的规范化可能误判合法的等价地址] → 以「登记的可达形式清单」为准，未登记形式失败关闭并暴露诊断，不静默放行。
- [意图先行增加一次持久化写入，可能影响创建延迟] → 写入有界；相对「孤儿资源/误删他人资源」的代价，延迟可接受。
- [UID-only 删除在对象确实无 UID 时无法自动清理] → 保留责任并失败关闭，展示人工核验步骤，不扩大删除范围。
- [202/finalizer/真实集群行为无法用替身完全证明] → 替身覆盖分支逻辑，真实 K3s 行为列入 B 类真实验收（本 change 不宣称真实集群通过）。
- [跨源重定向与协议例外的正确性依赖 HTTP 客户端行为] → 在隔离测试中以本地 HTTP 服务注入重定向与明文场景，断言零携凭据请求。

## Migration Plan

1. 先加 `providerId` 解析路径与 remote↔Provider↔repo 校验，旧自由字段标记 legacy-blocked（保留解析以便展示，功能上拒绝携凭据请求）。
2. 创建路径切换为两阶段身份：意图先行、UID 回执、owned 集合删除；替换名称补偿。按模块分步实施，每步与现有测试基准对照。
3. 每条负例先失败后通过，并补正常对照（合法绑定、合法 UID 删除）防止「全部拒绝即通过」。
4. 回滚策略：失败关闭，不做协议双写；回滚即 revert 对应提交，因旧路径不识别新意图字段，迁移期禁止新旧写入器混用。

## Open Questions

- Provider 解析失败时 UI 的降级展示是「禁用并提示」还是「引导登记」，可延后决定，不影响 spec 与任务分解。
- 跨源重定向逐跳允许列表的存储位置（Settings 还是 Workspace 配置），可在实现阶段按既有配置分层确定。
