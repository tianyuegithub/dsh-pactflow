# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 覆盖缺口 | ✅ | `grep -rln "iframe\|createRoot\|ReactDOM" tests/` 为空——§1 的该条硬条件只有人工核实 |
| 判据修正（诚实） | ✅ | 初版规则把 `@deepseek-ai/…/src/…` 一律判违规，第一次运行即失败；查该包 `package.json` 发现其 `exports` **显式声明** `"./src/*": "./src/*"`，故该导入合法。规则改为「深路径须落在已声明子路径」 |
| 测试 | ✅ | `client-composition.spec.ts` 3 项全绿（无 iframe/壳；全部深路径导入均为已声明导出） |
| 对抗性验证 | ✅ | 将 `project-panel.tsx` 的一处导入改为 `@deepseek-ai/dsh-client-ui-primitives/lib/secret-internal.js`（未声明）→ 守护用例失败并打印该文件与说明符；已还原，`git diff --quiet` 确认**源码零改动** |
| 验证 | ✅ | `pnpm run check` 69 文件 / **539** 测试（原 536） |

## 这次「失败」的价值

初版测试**误报**了 `project-panel.tsx`。若我当时直接放宽正则把它压绿，就会把一条真实约束削弱成空转断言。改为查 `exports` 后，规则既保住约束又消除误报——并**顺带核实**了那处导入确为包声明过的公开子路径（不是私有源码导入）。这与本会话主题一致：**遇到失败先查清原因，而不是把断言调宽**。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 无第二层 Web 壳 | `uses no iframe or second web shell` |
| 深路径导入必须是该包声明的导出 | `reaches only declared export subpaths of published DSH packages` |
| 声明了 `./src/*` 的包不算私有导入 | 同上（当前 `src/icons/index.tsx` 即此情形，通过） |
| 违规被测试捕获 | 对抗性验证（改为未声明子路径 → 失败） |

## 已知边界（诚实）

- 仅覆盖 `src/`；`presets/**` 与构建配置未纳入同一守卫。
- 深路径核对依赖能解析到包的 `package.json`；解析不到时**跳过**（不猜测），故对无法解析的包该断言不生效。
- 未校验「仅从 DSH 公开原语导入」的正向清单（如是否只用了 Client Module 而非私有 API）；本测试只覆盖可静态判定的违规形态。

## 验证

`pnpm run check` 通过：69 个测试文件、539 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
