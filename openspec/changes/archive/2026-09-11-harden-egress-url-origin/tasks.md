## 1. Agent 面守卫

- [x] 1.1 新增 `tests/egress-url-origin.spec.ts`：加载真实 preset 产物并枚举 `pactflow_*` 工具 schema，断言（a）非空且含已知工具；（b）无任何参数名匹配端点模式；（c）`pactflow_bind_git` 暴露 `gitea_provider_id` 且不暴露任何端点参数。验证：该测试通过
- [x] 1.2 同文件：断言 `pactflow_*` 工具名集合不含 discover/probe 类工具。验证：该测试通过，并临时注入一个假想 `pactflow_discover_models` 工具确认守卫会失败（验后移除）

## 2. 失败关闭守卫（零出网）

- [x] 2.1 同文件：`probeInfrastructure`（kind=model-connection，未注册 id）在任何 fetch 之前抛 "not configured"，fetch 计数为 0（stub fetch）。验证：该测试通过
- [x] 2.2 同文件：`discoverModels` 的 credential ref 未配置时在调用 `llm.discoverModels` 之前抛错（llm 替身计数为 0）。验证：该测试通过

## 3. 收口

- [x] 3.1 新增 `docs/security-scan-20260911.md` 登记扫描收据与三族处置结论。验证：文件存在且含 scanId/seal
- [x] 3.2 `pnpm run check` 全绿 + `openspec validate harden-egress-url-origin --strict` 通过 + archive 归并（补写新 capability 的真实 Purpose）
