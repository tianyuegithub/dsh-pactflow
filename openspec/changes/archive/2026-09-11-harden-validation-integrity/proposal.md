## Why

GPT 评审附录 A03 指出深层问题：**命令被批准，不等于测试实现不可被改弱**。登记 `pnpm test` 只能保证执行了该命令，不能阻止任务自身改写 `package.json` 的 test 脚本、删除断言或篡改测试基础设施。同时「空验证配置仍合法」，交付可能**完全没有自动验证**却被当成已验证。

本 change 取其中**边界清晰、不改变现有授权合同**的部分：让任务对**验证基础设施的改动可见**，并让「零自动验证」可被识别。评审同时建议的「宿主侧独立验收基线」与「按任务类型设定最小验证策略」属更大的设计，未纳入。

## What Changes

- 新增纯模块 `src/validation-integrity.ts`：
  - `validationSensitiveChanges(diffOutput)`：从 `git diff --name-only` 输出识别任务提交是否改动了验证敏感文件（lockfile、`vitest.config.*`、`tsconfig*.json`、`Makefile`、`pom.xml`、`.github/workflows/`、`.gitlab-ci*`、`ci/` 等），确定性、去重、排序。
  - `validationExecutedCount(evidence)`：交付实际执行的验证命令数；为 0 即「无自动验证」，不得当作已验证。
- `validateResult`（`src/git-workspace.ts`）在提交通过验证后记录该提交的验证敏感改动（**仅上报、不阻断**），并经 `PactFlowGitResult.validationSensitiveChanges?` 传播到运行结果。

## Capabilities

### New Capabilities
- `validation-integrity-signals`: 交付必须能识别「任务改动了项目验证基础设施」与「本次交付没有任何自动验证」两类情况，供人工审查；前者不得静默通过，后者不得被呈现为已验证。

### Modified Capabilities
（无。）

## Impact

- **Host**：新增 `src/validation-integrity.ts`；`src/git-workspace.ts`（`validateResult` 记录、证据/结果类型扩展）；`tsconfig.host.json`。
- **测试**：新增 `tests/validation-integrity.spec.ts`（纯函数：识别、非识别、去重排序、零验证计数）。
- **兼容**：字段可选，不改变既有验证授权、不阻断任何任务；旧结果读取不受影响。
