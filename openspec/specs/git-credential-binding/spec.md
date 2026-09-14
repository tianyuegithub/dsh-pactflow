# git-credential-binding Specification

## Purpose
约束 Agent 与 Host 对 Git/Gitea 凭据的使用：Agent 只能选择用户登记的 Provider 与仓库身份，Host 在发出任何携带凭据的请求之前，必须确认目标地址与凭据引用属于同一条已批准配置，从而保证原始凭据永不被发往非登记目标，也不进入任何可持久化的输出。

## Requirements

### Requirement: Agent 只能选择已登记的 Provider 与仓库身份

`pactflow_bind_git` 工具 SHALL 只接受用户登记的 Provider 标识（如 `providerId`）与非敏感仓库身份字段（owner、repo、默认分支、remote 名）。Agent MUST NOT 通过工具参数提交任意 API 端点地址与凭据引用的自由组合；端点、认证方式与凭据引用 MUST 由 Host 从已批准配置解析。当 Agent 提交已登记 Provider 之外的端点，或其组合无法与任何登记配置对应时，Host MUST 在产生任何外部携凭据请求之前失败关闭。

#### Scenario: 登记 Provider 的正常绑定

- **WHEN** Agent 提交一个已登记 Provider 的标识与其 remote/owner/repo
- **THEN** Host 解析出该 Provider 的 endpoint、认证方式与 credentialRef，绑定成功，并以 remote 指向的仓库身份完成校验

#### Scenario: 非登记端点被拒绝且零携凭据请求

- **WHEN** Agent 提交一个合法 remote（指向可信 origin）与一个未登记的回环 API 地址及其凭据引用
- **THEN** Host 拒绝该绑定，且对所有目标地址发出的携带凭据请求数为 0

#### Scenario: 登记 Provider 匹配路径不被绕过

- **WHEN** Agent 提交显式 Gitea 字段而非 Provider 标识
- **THEN** Host 仍要求该字段组合与登记 Provider 或显式用户批准一致，否则拒绝，不因参数形态差异跳过 Provider 匹配

### Requirement: remote、Provider 与仓库身份必须相互对应

Host SHALL 校验三者的对应关系：本地 Git remote 指向的 host/路径、登记 Provider 的 base URL 与所有权，以及请求声明的 owner/repo。若 remote 与 Provider 不匹配、或 request 声明的仓库与 Provider 下允许的仓库不一致，Host MUST 拒绝绑定。URL 比对 MUST 识别登记的 SSH/HTTPS 地址映射、API 子路径与端口，MUST NOT 仅以 hostname 或字符串相等作为判据。

#### Scenario: 不同仓库被拒绝

- **WHEN** remote 指向 Provider 下的仓库 A，而请求声明仓库 B
- **THEN** Host 拒绝绑定，且不发出任何携凭据请求

#### Scenario: 错配的凭据引用被拒绝

- **WHEN** 请求携带的 credentialRef 不属于该 Provider 的已批准配置
- **THEN** Host 拒绝绑定，且不解析或使用该凭据

### Requirement: 重定向与传输协议不得扩大凭据授权范围

携带授权的 API 请求 MUST NOT 自动跟随跨源重定向；若确需跟随，Host MUST 逐跳核验允许来源与路径，任一跳不匹配即中止且不转发授权头。HTTPS SHALL 为默认；HTTP MUST 仅在用户显式允许的、精确到环境与端点的本地例外下使用，MUST NOT 泛化为任意内网或明文地址。历史非合规端点 MUST 保留为待确认/阻断状态，不得静默改成合规协议。

#### Scenario: 跨源重定向不携带授权

- **WHEN** 已授权请求的响应要求跳转到未登记的其它源
- **THEN** Host 中止该请求或跳转后不转发授权头，未登记的源收到携带凭据的请求数为 0

#### Scenario: HTTP 降级默认被拒绝

- **WHEN** 端点使用明文 HTTP 且不属于用户显式允许的本地例外
- **THEN** Host 拒绝该绑定或请求

### Requirement: 凭据值不得进入任何可持久化输出

无论绑定成功或失败，原始凭据值 MUST NOT 进入 Session Log、Remote payload、Tool result、Git 对象、argv、截图或持久日志。所有对外证据（候选列表、连接结果、错误消息）MUST 只包含 credentialRef 与非敏感元数据。

#### Scenario: 错误路径不泄露凭据

- **WHEN** 绑定或校验因目标不匹配而失败并生成错误
- **THEN** 错误正文与任何 Remote 返回值不包含凭据值或其可直接还原的编码

### Requirement: 历史绑定必须经显式确认才具备新授权效力

历史已持久化的「人工 endpoint + credentialRef」组合 MUST NOT 被自动升级为本 capability 下的有效授权。Host MUST 将此类记录保持只读或阻断，直到用户经可信路径重新确认 Provider 与仓库身份。

#### Scenario: 旧绑定不被自动认领

- **WHEN** 存在一条历史人工 endpoint + credentialRef 绑定记录
- **THEN** Host 在未获用户重新确认前拒绝以其发起携凭据请求，并给出可操作的确认入口

### Requirement: 历史绑定的失败关闭不以登记表非空为前置

端点与 Credential Ref 的组合无法与任何已登记配置对应时，Host MUST 失败关闭。「登记表为空」与「设置缺失」MUST 与「对应不上」同等处理，MUST NOT 作为跳过该校验的条件。

这一条单独写出，是因为实现曾以「已登记 Provider 数量大于零」把门：升级后尚未登记任何 Provider 是常见初始态，该形态下每一条历史绑定都被完全放行并用于携凭据请求——失败关闭在最需要它的时刻恰好不生效。

#### Scenario: 登记表为空时历史绑定被拒绝

- **WHEN** 会话持有一条历史 Gitea 绑定，而当前已登记 Git Provider 列表为空
- **THEN** Host 拒绝使用该绑定并要求重新确认 Provider，不发出任何携凭据的请求

#### Scenario: 无基础设施设置时同样拒绝

- **WHEN** 同一条历史绑定所在的宿主没有任何基础设施设置
- **THEN** Host 拒绝，MUST NOT 因为「无从校验」而放行

### Requirement: 模型指名的 Git Secret 与凭证必须有归属

`k3sGitSecretName` 与 Git HTTPS 认证的 `credentialRef` 都由模型可调工具的自由字符串提供，Host SHALL 在接受绑定时校验其归属，MUST NOT 仅校验名称形状或「凭证已配置」。

- Git Secret 名 MUST 落在 PactFlow Git Secret 名称前缀内。该前缀此前只用于列举端点的过滤，属界面约定；本条将其提升为宿主边界，两处 MUST 取自同一个常量。
- Git HTTPS 凭证 ref MUST NOT 是任何其它已登记资源（模型连接、镜像仓库、对象存储）的凭证 ref。

威胁是具体的：被指名的 Secret 会被挂载进一个 prompt 由同一模型撰写的 Worker Pod；被指名的凭证会经 `GIT_ASKPASS` 交给 Git 服务端并落进对方的认证日志。

#### Scenario: 前缀之外的 Secret 名被拒绝

- **WHEN** 绑定请求指名一个不带 PactFlow Git Secret 前缀的命名空间内 Secret（例如某次运行的模型 Secret 或对象存储 Secret）
- **THEN** Host 拒绝该绑定并指名原因，不写入任何绑定

#### Scenario: 属于其它已登记资源的凭证不得作为 Git 口令

- **WHEN** 绑定请求把已登记模型连接的 API Key ref、镜像仓库口令 ref 或对象存储密钥 ref 作为 Git HTTPS `credentialRef`
- **THEN** Host 拒绝并指名「该凭证属于另一个已登记资源」，不解析该凭证、不发出任何请求
