## 1. 输出预算接线（A11 有界增量）

- [x] 1.1 先写失败测试：收紧实例预算到 128 字节后，存储结果必须 ≤128（硬编码 4096 时必失败）
- [x] 1.2 `boundedOutcome` 改用 `boundOutputToBudget(..., runBudget.maxOutputBytes)`，保留先脱敏后截断与默认回退
- [x] 1.3 默认 `maxOutputBytes` 调为 4096，与长期实际截断量一致（不放大存量）
- [x] 1.4 验证：1.1 转绿且 `display-redaction` 不回归

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（61 文件 / 505 测试 / 13 包产物）
- [ ] 2.2 运行 `openspec validate harden-output-budget-authority --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射、已知未覆盖（token/用量统计与 paused 属新能力，未做）
