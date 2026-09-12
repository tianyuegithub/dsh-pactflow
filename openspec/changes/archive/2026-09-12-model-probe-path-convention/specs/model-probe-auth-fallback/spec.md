# model-probe-auth-fallback (delta)

## ADDED Requirements

### Requirement: Anthropic 探针路径推导与运行时一致

Anthropic 协议模型探针的 messages 请求路径 SHALL 与运行时 `ANTHROPIC_BASE_URL` 消费方（Anthropic SDK 约定）一致：baseUrl 路径不以 `/v1` 结尾时请求 `{base}/v1/messages`；已以 `/v1` 结尾时请求 `{base}/messages`（MUST NOT 出现重复的 `/v1` 段）。同一 baseUrl 值在探针与 Worker 运行时 MUST 解析到同一 messages 端点。

#### Scenario: baseUrl 不带 /v1 时探针自动补全

- **WHEN** Anthropic 协议连接的 baseUrl 为 `https://ark.example/api/coding`（不以 /v1 结尾）
- **THEN** 探针请求发送至 `https://ark.example/api/coding/v1/messages`，与运行时 Claude Code 实际请求路径一致

#### Scenario: baseUrl 已含 /v1 时不重复拼接

- **WHEN** baseUrl 为 `https://api.anthropic.example/v1`
- **THEN** 探针请求发送至 `https://api.anthropic.example/v1/messages`，不出现 `/v1/v1/`

#### Scenario: 路径补全与认证回退叠加

- **WHEN** baseUrl 不带 /v1 且端点对 `x-api-key` 返回 401、对 Bearer 返回 2xx
- **THEN** 两次请求（重试含认证回退）都指向补全后的 `/v1/messages` 路径
