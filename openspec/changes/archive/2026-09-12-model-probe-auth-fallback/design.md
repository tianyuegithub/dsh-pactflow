# 设计：探针认证回退

## 决策：仅 401 触发、替换头、恰一次重试

`probeModelConnection` 的发送段改为内部小循环（最多两次）：构造 `anthropic-messages` 请求头时首选 `x-api-key`；`response.status === 401` 且这是第一次尝试 → 以 `{ authorization: Bearer, anthropic-version, content-type }` 重建头（**替换**，不合并——两种头并存会让网关鉴权语义不明，也可能把凭证多暴露一个头位）再发一次；任何其它状态码直接按既有路径处理。

- **为什么只认 401**：401 语义就是「认证头不被接受」，正是头风格错配的信号；403（权限）、404（模型/路径）与认证头风格无关，重试只会翻倍副作用。
- **为什么恰一次**：两种头风格穷尽了主流实践（官方 Anthropic 与 Anthropic 兼容网关），第二次 401 即终局，继续换头没有第三种事实。
- **为什么替换而非并发双头**：见上；且失败错误只报状态码，凭证不进日志（既有约束维持）。

## 边界

- URL/请求体两次完全一致（含 `max_tokens: 8` 的最小探针体）。
- OpenAI 系协议路径不动（本就 Bearer，无双头问题）。
- 模型列表发现（`discoverModels`）不动：anthropic 协议无列表是 DSH 构建的设计，手填即正解。
- `egress-url-origin` 合同不受影响：重试命中的是同一草稿端点，未注册连接的零出网守卫测试保持全绿即可作证。

## 测试策略

`tests/model-probe-auth-fallback.spec.ts`（服务级，stub `globalThis.fetch`）：

1. **401→Bearer 成功**：stub 检查首请求含 `x-api-key` 无 `authorization`、返回 401；次请求含 `authorization` 无 `x-api-key`、返回 200 + `{content:[…]}` → `testModelConnection`（探针 Remote）resolve；断言恰好 2 次调用、两次 URL 相同。
2. **401→401 失败**：两次都 401 → reject 指名 HTTP 401，恰 2 次。
3. **403 不重试**：首请求 403 → reject 指名 403，恰 1 次。
4. **x-api-key 直接过**：首请求 200 → resolve，恰 1 次、无 Bearer 请求。

先红（现状：401 即抛、单次请求 → 用例 1 红）后绿。
