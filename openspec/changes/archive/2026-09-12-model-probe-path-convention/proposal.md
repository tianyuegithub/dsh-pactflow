# Anthropic 探针路径推导与运行时对齐（baseUrl 自动补 /v1）

## Why

真实部署（火山方舟，2026-09-12）暴露的插件内在不一致：探针把 `/messages` 直接拼在 baseUrl 后，而 Worker 运行时把 baseUrl 原样注入 `ANTHROPIC_BASE_URL`、由 Claude Code（Anthropic SDK 约定）自己补 `/v1/messages`。因此 baseUrl 不带 `/v1` 时探针 404（实测 `/api/coding/messages` 不存在、`/api/coding/v1/messages` 为真实端点），带 `/v1` 时探针能过但运行时路径翻倍——**同一个值永远无法同时满足两侧**。官方 Anthropic（`https://api.anthropic.com` → `/v1/messages`）与 GLM Anthropic 兼容端点（`/api/anthropic` → `/api/anthropic/v1/messages`）同为 SDK 约定，一并受益。

## What Changes

- `probeModelConnection` 对 `anthropic-messages` 协议的路径推导改为与运行时同一约定：baseUrl 路径**不以 `/v1` 结尾**时拼 `v1/messages`，已以 `/v1` 结尾时拼 `messages`（不重复）。
- OpenAI 系协议路径不变；认证回退（`model-probe-auth-fallback`）不变。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `model-probe-auth-fallback`：新增 requirement——Anthropic 探针的 messages 路径推导 SHALL 与运行时 `ANTHROPIC_BASE_URL` 消费方一致（自动补 `/v1`、不重复补）。

## Impact

- **Host**：`probeModelConnection` anthropic 分支 suffix 计算两行改动。
- **测试**：新增路径场景（不带 /v1 → `v1/messages`；带 /v1 → `messages` 不翻倍；与认证回退叠加仍工作），先红后绿。
- **不做**：不改 baseUrl 字段语义（用户按 SDK 约定填，不带 `/v1`）；不改 Worker 注入。
