## 1. 验证完整性信号

- [x] 1.1 先写失败测试：识别验证敏感改动、非敏感不识别、去重排序、零验证计数
- [x] 1.2 实现 `src/validation-integrity.ts` 纯模块；验证：1.1 转绿
- [x] 1.3 `validateResult` 记录该提交的验证敏感改动（仅上报不阻断）并传播到结果类型

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（51 文件 / 464 测试）
- [x] 2.2 运行 `openspec validate harden-validation-integrity --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
