# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现 | ✅ | 运行 `node scripts/verify-profile.mjs --development` → `ReferenceError: Cannot access 'COMMAND_TIMEOUT_MS' before initialization`（`verify-profile.mjs:64`，第一次 `runDsh`） |
| 根因 | ✅ | 顶层 `try { … runDsh(['--version']) … }` 位于 `const COMMAND_TIMEOUT_MS = 120_000` **之前**；`run()` 读取该常量 → 暂时性死区 |
| 影响面 | ✅ | `pnpm run verify:profile`、`verify:profile:dev` **从未真正运行过**；`check:release` 的首个真实步骤即 `verify:profile`，故该发布门禁也从未跨过此点 |
| 修复 | ✅ | 两常量上移至顶层 `try` 之前（附注释说明原因） |
| 真实运行 | ✅ | `DSH_SKIP_BUILD=1 node scripts/verify-profile.mjs --development` → `verify-profile (development): install, boot, remove, and clean boot passed` |
| release 通道 | ✅ | 未设 `DSH_CLI_ENTRY` 时给出设计好的明确错误（`Set DSH_CLI_ENTRY to the installed DSH JavaScript CLI; source fallback is disabled`），不再是 TDZ 崩溃 |
| 守卫 | ✅ | `script-hygiene.spec.ts` +2：逐个 `node --check` 全部 `scripts/*.mjs`；断言 `COMMAND_TIMEOUT_MS` 声明早于首个顶层 `try {` |
| 验证 | ✅ | `pnpm run check` 65 文件 / **528** 测试 |

## 这是本会话最典型的「假门禁」

比「缺失门禁」更隐蔽：脚本存在、在 package.json 里被引用、名字看起来正确，但**从第一次调用就抛与验证对象无关的错误**。任何只看「有没有这个脚本」的检查都会漏过它。发现它只能靠**真正运行**——与本会话 worker 缺陷（先让失败自我报告）同一条经验。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 全部验证脚本可解析 | `parses every verification script (a syntactically broken gate never runs)`（对 `scripts/*.mjs` 逐个 `node --check`） |
| 超时常量先于使用处声明 | `does not reference timeout constants before their declaration`（断言声明位置 < 首个顶层 `try {`） |
| 门禁可真实运行 | 手动真实运行 `verify:profile:dev` 通过（**未做自动化**，见下） |

## 已知边界（诚实）

- 「门禁可真实运行」只有**手动运行证据**，未纳入 `check`：`verify:profile:dev` 需 tsx 源码通道与真实 boot（约数十秒、依赖相邻仓），不适合放进默认门禁。因此守卫覆盖的是「可解析」与「TDZ 不回归」，而非「端到端可运行」。
- `node --check` 只捕获**语法**错误，不捕获运行期初始化错误；TDZ 一类靠第二条断言（常量先于 try）守护，属**针对性**守卫而非通用静态分析。
- 本次未审计 `scripts/` 下其它尚未被本会话运行过的脚本是否同样「不可运行」——除本例外未发现；`check:release` 的其余步骤（`test:web`、`check`）本轮已实际运行。

## 验证

`pnpm run check` 通过：65 个测试文件、528 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过；`verify:profile:dev` 真实通过。
