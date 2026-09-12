# Anthropic 协议模型探针 401 时自动以 Bearer 重试

> 用户裁决（2026-09-12）：官方 Anthropic API 认 `x-api-key`，而 Ark/部分网关（如火山方舟 Coding 端点）只认 `Authorization: Bearer`——探针两者都要兼容。

## Why

插件模型连接卡的「测试」（`probeModelConnection`，宿主侧探测）对 `anthropic-messages` 协议固定发送 `x-api-key`。真实部署（2026-09-12，火山方舟 Coding 套餐）实测：该端点对 `x-api-key` 一律 401、对 Bearer 正常应答，且 **Worker 实跑链路本就走 Bearer**（K3s 注入 `ANTHROPIC_AUTH_TOKEN`）——出现「测试按钮必红、实际可跑」的矛盾信号，运营者无法用探针判断连接好坏。

## What Changes

- `probeModelConnection` 在 `anthropic-messages` 协议下首发 `x-api-key`（官方语义不变）；**当且仅当**收到 HTTP 401 时，以同一 URL/请求体、`Authorization: Bearer` 重新发送一次；重试结果即为最终结果。
- 401 以外的失败状态码（403/404/5xx…）**不触发**重试；两种头**不同时发送**；凭证不进入错误消息或日志（维持现状）。
- OpenAI 系协议（`openai-chat-completions`/`openai-responses`）探针行为不变（本就 Bearer）。
- 新 capability `model-probe-auth-fallback` 固化上述语义。

## Capabilities

### New Capabilities
- `model-probe-auth-fallback`：Anthropic 协议模型探针 SHALL 在 401 时以 Bearer 无条件重试恰一次；非 401 不重试；不得同时发送两种认证头。

### Modified Capabilities
（无。`egress-url-origin` 的「未注册模型连接零出网」不受影响——重试发向同一已配置端点。）

## Impact

- **Host**：`index.ts` `probeModelConnection` 的请求发送段重构为「首试 + 条件重试」两步；错误消息保持既有形态（HTTP 状态码指名）。
- **测试**：新增服务级测试（stub 全局 fetch）：401→Bearer 重试成功；401→401 失败；非 401 不重试；两请求头互斥且同 URL。
- **不做**：不改模型列表发现（anthropic 协议本无列表，手填即设计）；不改 Worker 运行时注入（已 Bearer）；不改 DSH 宿主的 llm 服务（pi-ai 属上游）。
