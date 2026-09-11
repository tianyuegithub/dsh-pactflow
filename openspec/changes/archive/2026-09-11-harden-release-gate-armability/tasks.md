## 1. 凭据读取单一化

- [x] 1.1 新增 `scripts/credential-refs.mjs`（`credentialFilePath`/`storedCredential`/`resolveCredential`），并以 `tests/real-web-gate-prerequisites.spec.ts` 的导入不报错验证模块可加载
- [x] 1.2 `scripts/run-real-worker-e2e.mjs`、`scripts/run-real-approval-e2e.mjs` 改用 `resolveCredential`，并以 `pnpm run test:real-approval` 仍通过验证行为不变

## 2. 门禁武装集与凭据注入

- [x] 2.1 `run-real-web-gate.mjs` 新增 `REQUIRED_CREDENTIALS` + `gateCredentialEnvironment()`，并把 `DSH_REAL_CRASH`/`DSH_REAL_APPROVAL` 纳入 `realWebGateEnvironment()`
- [x] 2.2 `checkWebGatePrerequisites()` 增加 `DEEPSEEK_API_KEY` 前置，并让凭据判定走 `resolveCredential`
- [x] 2.3 `check-release.mjs` 复用 `realWebGateEnvironment()` 与前置检查，先以可诊断缺失清单失败关闭

## 3. 守卫测试

- [x] 3.1 `tests/real-web-gate-prerequisites.spec.ts` 增加「从套件源码反推必需开关」用例，并故意移除一个开关确认测试会失败
- [x] 3.2 增加「凭据注入意图」用例（断言武装集构建包含凭据集合），并在移除 `gateCredentialEnvironment()` 调用时确认测试会失败
- [x] 3.3 `tests/real-suite-inventory.spec.ts` 把 `pactflow-real-approval.e2e.spec.ts` 从 `REQUIRED_NOT_RUN` 迁入 `IMPLEMENTED`，并确认 `pnpm run test` 通过

## 4. 真实验证

- [x] 4.1 以 `DSH_SNAPSHOT=record` 运行 `node scripts/run-real-web-gate.mjs`，确认真实报告为 20 套件 / 21 测试、0 跳过 0 失败，且退出码为 0
- [x] 4.2 运行 `pnpm run check`（build + 全量单测 + pack:check）确认全绿
- [x] 4.3 运行 `openspec validate harden-release-gate-armability --strict` 确认合同有效，随后 archive 归并
