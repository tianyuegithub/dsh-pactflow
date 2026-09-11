## Context

见 `proposal.md · Why`。已核实的现状（作为设计输入）：

- Agent 工具由 `presets/pactflow/plugin`（构建产物，测试直接 import 产物）注册；`dsh-tools` 的 `schemas(scope)` 返回 `{name, description, parameters}`，参数名为扁平键。
- `PactFlowInfrastructure` 的 id 解析器（`modelConnection`/`giteaProvider`/`cluster`/`workerPool`）全部 fail-closed（未注册即抛）。
- `discoverModels` 依序：校验 URL 形状 → `resolveCredential`（ctx.get('credentials')，未配置即抛）→ `ctx.get('llm').discoverModels`。
- `probeInfrastructure`（kind=model-connection、无草稿）依序：`requireInfrastructure()` → `infrastructure.modelConnection(id)`（未注册即抛）→ 解析凭据 → 探测。
- Gitea 携凭据出网的端点绑定已由 `git-credential-binding`（F01）合同 + 真实 HTTP 计数测试覆盖——本 change 不重复。

## Goals / Non-Goals

**Goals**

- 把「Agent 面出网目标仅以注册 id 引用、schema 无端点参数」与「操作员表单探测凭据仅经注册引用」落为**离线可证伪**的守卫测试；未来回归（新增带端点参数的 Agent 工具、把探测工具暴露给模型、未注册 id 产生出网）在 `pnpm run check` 即失败。

**Non-Goals**

- 不改任何运行时行为；不收紧操作员面（草稿探测按设计接受操作员填写的端点）；不重复 `git-credential-binding` 已覆盖的 Gitea 面；不处理扫描器的 mongo-sort / 硬编码凭据两族（已核实为规则错配/误报，处置结论只入文档）。

## Decisions

### 决策 1：守卫测试加载**真实 preset 产物**而非 src

- **理由**：Agent 真正加载的是 `presets/pactflow/plugin/index.js`（构建产物）；守卫产物等于守卫发布面，且与 `review-authorization.spec.ts` 的既有模式一致。
- **做法**：与该测试同一 harness（SessionStore + ProjectionRegistry + PactFlowService + SystemPrompt + ToolRuntime + createScope + plugin），`ctx.tools.schemas(agent)` 后过滤 `pactflow_*`。

### 决策 2：端点参数判定用封闭的名字模式，而非语义猜测

- **理由**：schema 是 JSON 对象，参数名是唯一稳定判据；封闭模式表（`url(s)/endpoint(s)/base_url/address(es)/host(s)/hostname(s)`，含 snake_case 变体）可读、可审、误报可控；反向白名单（只允许已知 id 参数）会在合理新参数上误报。
- **取舍**：模式表可能漏掉拼写变体（如 `remote_addr`）——由 review 把关；本守卫的价值在捕获「明显把 URL 交给模型」的回归。

### 决策 3：零出网断言用 fetch/llm 计数替身，不起真实服务器

- **理由**：要证明的是「失败发生在出网**之前**」；计数替身比本地 HTTP 服务器更直接（任何调用即计数），且这两项测试无需真实协议交互（区别于 F01 测试需要真实 HTTP）。

## Risks / Trade-offs

- [名字模式表漏检新变体] → 模式表集中于测试一处，随 review 扩展；守卫覆盖最常见回归形态。
- [`schemas()` 形状随上游演化] → 断言前先校验拿到非空 `pactflow_*` 集合，形状漂移会以明确失败暴露而非静默通过。
- [守卫与实现同仓同改可能被一起改弱] → 与既有守卫族（real-suite-inventory 等）同等风险，由 spec 场景与 review 兜底。

## Migration Plan

1. 写 `tests/egress-url-origin.spec.ts` 四项守卫（先红后绿不需要——它们针对的是现状已成立的不变量，应直接绿；若红则说明发现真实回归）。
2. `pnpm run check` 全绿 → `openspec validate` → archive。
3. 回退即删测试文件与 spec，无运行时影响。

## Open Questions

（无。）
