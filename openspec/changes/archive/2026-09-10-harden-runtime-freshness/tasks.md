## 1. 新鲜度跟踪（纯模块）

- [x] 1.1 先写失败测试：`createFreshnessTracker` 的到期判定、成功清 stale 并记录时间、失败置 stale、从未成功时的表示
- [x] 1.2 实现 `src/client/runtime-freshness.ts`；验证：1.1 转绿

## 2. 浮层接入

- [x] 2.1 就绪期间按有界间隔重查运行时数据，复用 `request-gate` 与既有重查路径
- [x] 2.2 关闭/卸载/会话或代际变化时清除计时器；验证：无计时器泄漏
- [x] 2.3 刷新成功清除 stale、失败置 stale；验证：状态语义与测试一致

## 3. stale 呈现

- [x] 3.1 浮层呈现 stale 与最近成功时间；从未成功时呈现「尚未确认」
- [x] 3.2 仅在 stale 时出现，不影响正常布局；验证：`pnpm run build` 与类型通过

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [x] 4.2 运行 `openspec validate harden-runtime-freshness --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射与已知未覆盖
