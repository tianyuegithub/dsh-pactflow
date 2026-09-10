## 1. 请求序号闸门（纯模块）

- [x] 1.1 先写失败测试：`createRequestGate` 的单请求应用、乱序丢弃（旧晚于新）、被取代请求即使成功也被忽略、`invalidate()` 后旧令牌失效
- [x] 1.2 实现 `src/client/request-gate.ts`；验证：1.1 转绿

## 2. overlay 运行时刷新接入

- [x] 2.1 overlay 运行时刷新改经闸门判定，签发新刷新前中止上一次在途刷新；验证：`pnpm run build` 与类型通过；既有 overlay e2e 未回归
- [x] 2.2 会话/代际切换使全部在途令牌失效（沿用既有清理副作用）

## 3. project-panel 接入

- [x] 3.1 `refresh()` 经闸门判定后再 `setRows/setCatalog`；工作区切换使旧令牌失效
- [x] 3.2 `gitSecrets` 副作用经闸门判定后再 `setGitSecretOptions`；集群切换使旧令牌失效

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [x] 4.2 运行 `openspec validate harden-client-request-ordering --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射与已知未覆盖
