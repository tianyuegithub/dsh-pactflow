# egress-url-origin (delta)

## ADDED Requirements

### Requirement: Agent 面出网目标只能以注册 id 引用

Agent 可见的 PactFlow 工具 SHALL 只以标识（Gitea Provider id、K3s 模板 id、Agent Profile id、模型连接 id、Worker Pool id）引用出网目标，由 Host 从**注册设置**解析出实际端点；工具 schema MUST NOT 暴露任何 URL/端点/地址类参数。未注册 id MUST 在发出任何网络请求之前失败关闭。

#### Scenario: Agent 工具 schema 无端点参数

- **WHEN** 枚举 Agent 面全部 PactFlow 工具的参数 schema
- **THEN** 没有任何参数名属于 URL/端点/地址类（如 `url`、`endpoint`、`base_url`、`address`、`host`）；出网目标一律以 `*_id` 引用

#### Scenario: Agent 面不含设置表单探测工具

- **WHEN** 枚举 Agent 面全部 PactFlow 工具名
- **THEN** 不含模型发现/连接探测类工具——这类草稿探测只属于操作员设置表单（客户端 Remote），MUST NOT 暴露给模型

#### Scenario: 未注册模型连接在零出网下失败关闭

- **WHEN** 以未注册的模型连接 id 请求连接探测
- **THEN** 在发出任何 HTTP 请求之前抛出未配置错误（网络请求数为 0）

### Requirement: 操作员表单探测的凭据仅经注册引用

操作员设置表单的探测辅助（模型发现、未保存草稿的连接探测）MAY 携带操作员填写的草稿端点，但其凭据 MUST 经已注册 credential ref 解析；解析失败 MUST 在发出任何请求之前失败关闭，MUST NOT 接受凭据字面量。

#### Scenario: 草稿探测的凭据未配置时零出网

- **WHEN** 模型发现请求携带的 credential ref 在凭据服务中未配置
- **THEN** 在调用任何模型发现/网络请求之前抛错（发现调用数为 0）
