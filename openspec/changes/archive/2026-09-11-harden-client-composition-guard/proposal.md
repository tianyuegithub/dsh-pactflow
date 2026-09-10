## Why

`docs/development-plan-开发计划.md` §1 把「Web 控制台使用 DSH Client Module/Slot/Store/Locale/Theme 与 Typert Remote，**不存在 iframe、第二层 Web 壳或私有 DSH 源码导入**」列为**硬完成条件**。本会话此前**只用 grep 手工核实**它成立，**没有任何测试守护**——任何后续改动都可以静默违反它。

（同时暴露一个判据问题：初版测试把「导入 `@deepseek-ai/.../src/...`」一律视为违规，但该包**在 `exports` 中显式声明了 `"./src/*"`**，故那并非私有导入。判据应改为：**每次深路径导入都必须落在该包 `exports` 声明的子路径上**。）

## What Changes

- 新增 `tests/client-composition.spec.ts`（3 项）守护 §1 的该条：
  - 能找到 client 源码（自检）；
  - 无 `iframe`/`webview`/`ReactDOM.render`/`createRoot(`（即无第二层 Web 壳）；
  - 对 `src/` 内所有 `@deepseek-ai/*` 导入，逐一核对**目标子路径是否被该包 `exports` 声明**（`exports` 中的 `"./src/*"` 之类的通配也算声明）；仅当落在**未声明**路径时才判违规。
- 未改动任何源码或运行时行为。

## Capabilities

### New Capabilities
- `client-composition-guard`: Web 控制台必须由 DSH 公开原语构成，不得有 iframe/第二层壳；对已发布 DSH 包的深路径导入必须落在该包 `exports` 声明的子路径上；该约束必须由测试守护。

### Modified Capabilities
（无。）

## Impact

- **测试**：新增 `tests/client-composition.spec.ts`（`pnpm run check` 68 文件 / 536 → 69 文件 / 539）。
- **兼容**：纯新增测试；源码未改（`project-panel.tsx` 的 `…/src/icons/index.tsx` 导入经核实为**已声明**的公开子路径，保留不动）。
