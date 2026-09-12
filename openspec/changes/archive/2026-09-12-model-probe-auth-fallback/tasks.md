# Tasks: model-probe-auth-fallback

## 1. 宿主侧

- [ ] 1.1 `index.ts` `probeModelConnection`：anthropic 协议发送段改「首试 x-api-key → 仅 401 → 替换为 Bearer 重发恰一次」；错误消息形态不变。验证：build + 单测

## 2. 测试

- [ ] 2.1 新增 `model-probe-auth-fallback.spec.ts`（4 场景，先红后绿）：401→Bearer 成功 / 401→401 失败 / 非 401 不重试 / x-api-key 直接过；断言请求次数、头互斥、同 URL。验证：单测
- [ ] 2.2 `pnpm run check` 全绿（含 egress-url-origin 零出网守卫不回归）。验证：check

## 3. 收口

- [ ] 3.1 `openspec validate --all --strict` + archive + Purpose 补真。验证：validate
- [ ] 3.2 打包重装重启，实机登记（火山方舟 Coding 端点实测：探针转绿）。
