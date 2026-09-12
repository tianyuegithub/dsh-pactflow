# 设计：探针路径补全

suffix 计算：`const suffix = base.pathname.replace(/\/+$/,'').endsWith('/v1') ? 'messages' : 'v1/messages'`，仅 anthropic 分支；openai 系维持 `chat/completions`/`responses` 原样。运行时侧（`ANTHROPIC_BASE_URL` 原样注入 + SDK 自拼 `/v1/messages`）不动——补全后两侧对同一 baseUrl 得到同一 URL。

## 测试

新增 `model-probe-path.spec.ts`（stub fetch，先红后绿）：
1. baseUrl `…/api/coding`（无 /v1）→ 请求 URL 以 `/api/coding/v1/messages` 结尾。
2. baseUrl `…/v1` → 以 `/v1/messages` 结尾且不含 `/v1/v1/`。
3. 叠加认证回退：无 /v1 + 首试 401 → 两次请求同指 `/v1/messages`，第二次 Bearer。
