## 1. 修复不可运行的门禁脚本

- [x] 1.1 发现：`verify:profile` / `verify:profile:dev` 首次调用即 `ReferenceError`（`COMMAND_TIMEOUT_MS` 声明在顶层 `try` 之后，暂时性死区）
- [x] 1.2 修复：把 `COMMAND_TIMEOUT_MS` / `BOOT_TIMEOUT_MS` 上移到顶层 `try` 之前
- [x] 1.3 真实运行：`verify:profile:dev` 完成 install → boot → upgrade → remove → clean boot 并**通过**
- [x] 1.4 release 通道核对：不再 TDZ 崩溃，改为其设计好的明确错误（`Set DSH_CLI_ENTRY …`）
- [x] 1.5 守卫：`script-hygiene.spec.ts` 新增「逐个 `node --check` 全部 `scripts/*.mjs`」与「超时常量先于首个顶层 try」两项
- [x] 1.6 验证：`pnpm run check` 全绿（65 文件 / 528 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-verify-profile-tdz --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
