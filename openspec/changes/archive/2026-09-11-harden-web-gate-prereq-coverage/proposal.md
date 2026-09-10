## Why

`scripts/run-real-web-gate.mjs` 是**网页零跳过**的发布门禁：它以「网页报告零跳过」为通过条件（`assertReleaseWebReport`）。其前置检查 `checkWebGatePrerequisites()` 决定「这次运行是否武装」——若该检查**静默错误**，后果是二选一：拦住合法运行，或让**未武装**的运行继续。

本会话已发现两处门禁级缺陷（`verify-profile` 因暂时性死区从未运行；`check:release` 因「零跳过 vs 8 个环境门控套件」结构上不可满足），二者共同点是**门禁自身的逻辑无人验证**。`checkWebGatePrerequisites` 此前**零测试**，属同一暴露面。

## What Changes

- 新增 `tests/real-web-gate-prerequisites.spec.ts`（2 项），守护其**确定性**分支：
  - `DSH_SNAPSHOT` 非 `record`（空或 `replay`）时，缺失清单**必须**包含「DSH_SNAPSHOT=record …」；
  - 已武装为 `record` 时，该条目**不得**出现，且返回值恒为「非空字符串数组」（其余条目依赖真实集群/凭据，故只断言类型与不含该条）。
- 未改动 `run-real-web-gate.mjs` 的任何行为。

## Capabilities

### New Capabilities
- `release-gate-prerequisite-coverage`: 发布门禁的**前置检查逻辑**必须被测试覆盖（至少其确定性分支），以免门禁因自身逻辑错误而拦住合法运行或放行未武装的运行。

### Modified Capabilities
（无。）

## Impact

- **测试**：新增 `tests/real-web-gate-prerequisites.spec.ts`（`pnpm run check` 65 文件 / 528 → 66 文件 / 530）。
- **兼容**：纯新增测试；门禁行为与输出不变。
