## 1. 只读项目移交摘要

- [x] 1.1 先写失败测试：含阶段与精确产物、未完成责任、已完成清理排除、无项目干净返回
- [x] 1.2 实现 `src/project-handover.ts`；验证：1.1 转绿
- [x] 1.3 只读 Remote `projectHandover`（在线与冷会话一致）；公开类型导出

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（56 文件 / 481 测试）
- [x] 2.2 运行 `openspec validate harden-project-handover --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
