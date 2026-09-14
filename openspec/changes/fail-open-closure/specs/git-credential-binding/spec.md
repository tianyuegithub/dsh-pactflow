# git-credential-binding (delta)

## ADDED Requirements

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
