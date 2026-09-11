## Why

发布网页门禁（`test:real-web-gate`）与发布门禁（`check:release`）的通过条件是「网页零跳过」，但两处自身缺陷使该条件**结构上不可满足**：

1. **武装集不全**：门禁只注入 `DSH_K3S_E2E`/`DSH_GITEA_E2E`/`DSH_SNAPSHOT`，漏掉 `DSH_REAL_CRASH`、`DSH_REAL_APPROVAL` 两个套件开关 → 对应套件永远 `skipIf` 跳过 → `numPendingTests` 永不为 0。
2. **凭据只查不注入**：门禁检查凭据 ref 是否**存在于凭据库**，却从不把解析后的值注入子进程 env；record 模式套件因此在 `beforeAll` 读到 `undefined` 而失败，vitest 将其计为**跳过**。

这与本项目反复出现的「门禁自身逻辑无人验证」同类（`verify-profile` TDZ、`check:release` 不可满足），比缺失门禁更糟：它给出的是**与验证对象无关的失败**。

## What Changes

- `scripts/run-real-web-gate.mjs`：
  - 抽出单一武装集 `realWebGateEnvironment()`（补齐 `DSH_REAL_CRASH=1`、`DSH_REAL_APPROVAL=1`），并内置**凭据注入**（`gateCredentialEnvironment()` 把 `DEEPSEEK_API_KEY`、`PACTFLOW_GITEA_API_TOKEN` 解析值放入子进程 env；env 优先于凭据库，与产品解析顺序一致）。
  - `checkWebGatePrerequisites()` 新增 `DEEPSEEK_API_KEY` 前置，并把凭据判定改为「env 或凭据库存在」。
- `scripts/credential-refs.mjs`（新）：凭据库单一读取器（`credentialFilePath` / `storedCredential` / `resolveCredential`），供两个门禁与真实套件运行器共用。
- `scripts/check-release.mjs`：复用同一武装集与前置检查，**先以可诊断的缺失清单失败关闭**，不再落到 `numPendingTests must be zero`。
- `scripts/run-real-worker-e2e.mjs`、`scripts/run-real-approval-e2e.mjs`：改用同一凭据读取器（消除重复实现）。
- `tests/real-web-gate-prerequisites.spec.ts`：新增两条守卫——**从 e2e 套件源码反推必需开关**（任何新门控套件未纳入武装集即失败）与**凭据注入意图**（防退回「只查不注入」）。
- `tests/real-suite-inventory.spec.ts`：`pactflow-real-approval.e2e.spec.ts` 由 `REQUIRED_NOT_RUN`（骨架）迁入 `IMPLEMENTED`（真实断言）。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `release-gate-prerequisite-coverage`: 前置检查的覆盖要求从「确定性分支被测试」扩展为「**武装集必须覆盖每个门控套件的开关，且必须把所检查的凭据注入被测子进程**」——否则门禁结构上不可满足，且该不可满足性必须由离线测试暴露。

## Impact

- **脚本**：`scripts/run-real-web-gate.mjs`、`scripts/check-release.mjs`、`scripts/run-real-worker-e2e.mjs`、`scripts/run-real-approval-e2e.mjs`、新增 `scripts/credential-refs.mjs`。
- **测试**：`tests/real-web-gate-prerequisites.spec.ts`（2 → 5）、`tests/real-suite-inventory.spec.ts`（桶迁移）。
- **兼容**：门禁的通过/失败判定语义不变；修复后 `test:real-web-gate` **真实全绿**（20 套件 / 21 测试，0 跳过 0 失败，含真实 K3s/Gitea/模型/浏览器/人工审批）。
- **上游**：`check:release` 的首个真实步骤 `verify:profile` 仍受阻于官方 DSH 发行版缺 `externalEventProducers`（见 `docs/CURRENT_STATUS-当前状态.md` §3），属本 change 之外的上游条件。
- **架构对应**：`docs/architecture-目标架构.md` 的发布不变量——「发布门禁必须可满足且失败可诊断」。
