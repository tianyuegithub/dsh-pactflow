## 1. 修复 K3s 代码输入断链

- [x] 1.1 真实复现：两节点依赖链在真实集群下，B 的 worktree 缺 `todo.html`（`node test-todo-smoke.js` exit 1）
- [x] 1.2 单元测试：断言 K3s `spec.json` 携带精确提交、worker 脚本含折叠与基线测量、digest 随 codeInputs 变化
- [x] 1.3 `WORKER_SCRIPT` 容器内取回并合并精确提交，失败关闭；以 `BASELINE_COMMIT` 衡量 Worker 自身改动
- [x] 1.4 `inputSecret` 增 `codeInputs`；`pactFlowK3sSpecDigest` 纳入 `codeInputs`
- [x] 1.5 `materialize` 增 `foldCodeInputs` 选项；K3s 派发传 `false`
- [x] 1.6 真实复跑：两节点链通过（B 继承 A 的 `todo.html`，宿主验证 `node test-todo-smoke.js` exit 0）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 507 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-k3s-code-input-baseline --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
