# model-probe-auth-fallback Specification

## Purpose
让模型连接的可用性探针对 Anthropic 协议同时兼容两种认证头风格：官方 Anthropic API（`x-api-key`）与 Bearer 网关（如火山方舟 Ark Coding 端点，实测 2026-09-12）。约束回退的安全边界：仅 401 触发、恰一次重试、两种头互斥、凭证不进日志；OpenAI 系协议与 Worker 运行时注入不受影响。消除「测试按钮必红、Worker 实跑可通」的矛盾信号。

## Requirements

### Requirement: Anthropic 协议模型探针在 401 时以 Bearer 重试恰一次

当模型连接探针对 `anthropic-messages` 协议端点执行且首次响应为 HTTP 401 时，宿主 SHALL 以**同一 URL、同一请求体、`Authorization: Bearer` 认证头**（替换而非叠加 `x-api-key`）重试恰一次，并以重试结果作为探针最终结果。首次响应为 401 之外的任何状态码（成功或失败）SHALL NOT 触发重试；单次探针调用 MUST NOT 同时携带两种认证头；凭证值 MUST NOT 出现在错误消息或日志中。

#### Scenario: x-api-key 被 401 拒绝后 Bearer 重试成功

- **WHEN** Anthropic 协议端点对 `x-api-key` 返回 401、对 Bearer 返回 2xx
- **THEN** 探针以同一 URL 重发一次（Bearer 头），探针结果为成功；两次请求都不同时携带两种认证头

#### Scenario: 两种头都被拒绝时如实失败

- **WHEN** 端点对 `x-api-key` 与 Bearer 均返回 401
- **THEN** 探针失败，错误指名 HTTP 401；总共恰好两次请求

#### Scenario: 非 401 失败不触发重试

- **WHEN** 端点对 `x-api-key` 首次响应为 403/404/5xx 等非 401 状态码
- **THEN** 不发起重试，探针按该状态码失败；总共恰好一次请求

#### Scenario: 官方 Anthropic 语义不受影响

- **WHEN** 端点接受 `x-api-key` 并返回 2xx
- **THEN** 探针首次请求即成功，不发送任何 Bearer 请求
