## Why

`scripts/verify-profile.mjs` 从**第一次调用起就抛 `ReferenceError`**：

```js
try { ... runDsh(['--version']) ... }   // 顶层，最先执行
...
const COMMAND_TIMEOUT_MS = 120_000      // 声明在其后 → 暂时性死区
```

`run()` 读取 `COMMAND_TIMEOUT_MS`，而该 `const` 在顶层 `try` **之后**才声明，于是第一次 `runDsh` 就抛：

```
ReferenceError: Cannot access 'COMMAND_TIMEOUT_MS' before initialization
```

后果：**`pnpm run verify:profile` 与 `verify:profile:dev` 从未真正运行过**，`check:release`（其首个真实步骤即 `verify:profile`）也从未跨过该点。这是本会话反复出现的「门禁看似存在、实则不可运行」形态——而且比缺失更糟：它以**无关原因**报错。

## What Changes

- `scripts/verify-profile.mjs`：把 `COMMAND_TIMEOUT_MS` / `BOOT_TIMEOUT_MS` **上移到顶层 `try` 之前**（并注明原因），使该门禁可运行。
- `tests/script-hygiene.spec.ts` 新增一组「验证脚本卫生」：
  - 对 `scripts/*.mjs` 逐个 `node --check`（语法错误 = 门禁不可运行，必须失败）；
  - 断言 `verify-profile.mjs` 的 `COMMAND_TIMEOUT_MS` **声明位置早于**首个顶层 `try {`（守住该 TDZ 不回归）。

## Capabilities

### New Capabilities
- `verification-script-runnability`: 仓库内的验证/门禁脚本必须可被解析且可运行；不得因暂时性死区、语法错误等使门禁在首次调用即失败，且脚本引用的常量必须在被使用前声明。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/verify-profile.mjs`（常量上移）。
- **测试**：`tests/script-hygiene.spec.ts` 新增 2 项（`pnpm run check` 由 65 文件 / 526 → 65 文件 / 528）。
- **真实结果**：修正后 `verify:profile:dev` **真实执行并通过**（install → boot → upgrade → remove → clean boot）。
- **兼容**：release 通道行为不变（仍要求已安装的官方 CLI），但不再以 TDZ 崩溃，而是给出其设计好的明确错误。
