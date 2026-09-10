## 1. 代码输入过期追踪

- [x] 1.1 先写失败测试：未变不报、变化报告（含 recorded/latest）、确定性排序、未知最新不误报
- [x] 1.2 实现 `src/input-staleness.ts`；验证：1.1 转绿
- [x] 1.3 `codeInputs` 增加可选 `dependency`（类型 + schema）；`codeInputCommits` 带上编号
- [x] 1.4 只读 Remote `staleCodeInputs`；验证：可达性边界用例

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（58 文件 / 486 测试）
- [x] 2.2 运行 `openspec validate harden-input-staleness --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖（触发路径不可达）
