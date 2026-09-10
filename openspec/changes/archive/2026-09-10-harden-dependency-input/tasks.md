## 1. 代码输入声明

- [x] 1.1 先写失败测试：`dependency-input.spec.ts` 断言依赖 A 的 B 能看到 A 的文件；先因无 code-input 注入而失败
- [x] 1.2 `PactFlowNode.codeInputs?` / 请求字段 / schema（可选）
- [x] 1.3 `createNode` 校验 codeInputs 是 dependencies 子集；验证：非依赖 code-input 被拒

## 2. 注入精确前序提交

- [x] 2.1 `codeInputCommits` 取各 code-input 依赖最新成功 Run 的精确提交
- [x] 2.2 `plan()` 记录 codeInputs；`materialize()` 按精确提交 fetch + merge，冲突/缺失失败关闭
- [x] 2.3 `dispatch.ts` 两处 plan 调用传入 codeInputCommits；验证：1.1 先红后绿

## 3. 收口任务集合按依赖闭包核验

- [x] 3.1 先写失败测试：`closing.spec.ts` 新增 `code-input-chain` 模式，当前不变量下失败（`task-set digest changed`）
- [x] 3.2 改写 `verifyTaskSet` 为依赖闭包不变量
- [x] 3.3 对抗性验证：`task-set-authorization.spec.ts` —— 拒绝未授权提交、接受依赖链；验证：3.1 转绿且未授权仍被拒

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（48 文件 / 453 测试）
- [x] 4.2 运行 `openspec validate harden-dependency-input --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射与已知未覆盖
