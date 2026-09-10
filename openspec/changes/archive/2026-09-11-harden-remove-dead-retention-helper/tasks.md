## 1. 删除被声明却不存在的助手

- [x] 1.1 穷尽式排查：对 `src` 全部 `.ts/.tsx` 的**运行时导出**统计「定义文件之外是否被引用」——修正首版扫描遗漏 `.tsx` 的假阳性
- [x] 1.2 逐项归类：多数为模块内使用（如 `isValidationSensitivePath`）或类型；仅 `retentionRemainingMs` **连模块内也无调用**
- [x] 1.3 契约核对：`failure-scene-retention-policy` 只要求「保留总数 + 超期清单」，**不要求**剩余时间 → 无契约
- [x] 1.4 处置：删除该导出与其单测（而非新增无契约字段）
- [x] 1.5 验证：`pnpm run check` 全绿（515 → 514）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-remove-dead-retention-helper --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
