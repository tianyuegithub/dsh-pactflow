## 1. 守护开发计划 §1 的客户端构成硬条件

- [x] 1.1 缺口：§1 的「无 iframe/第二层壳/私有源码导入」此前**只人工 grep 核实、无测试**
- [x] 1.2 判据修正：初版把 `@deepseek-ai/.../src/...` 一律判违规 → 实测该包 `exports` 声明了 `"./src/*"`，故改为**核对是否落在已声明子路径**
- [x] 1.3 新增 `tests/client-composition.spec.ts`（3 项）：自检 / 无壳 / 深路径导入须为已声明导出
- [x] 1.4 对抗性验证：把一处导入改为未声明的 `…/lib/secret-internal.js` → 守护用例失败并指出文件与说明符；已还原（`git diff --quiet` 确认源码无改动）
- [x] 1.5 验证：`pnpm run check` 全绿（69 文件 / 539 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-client-composition-guard --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
