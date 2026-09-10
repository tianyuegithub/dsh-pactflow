## 1. 为证据采集器入口补测试

- [x] 1.1 发现：`collectEvidence` 在 `tests/` 中**零引用**；早前「由既有测试覆盖」的记录不准确（那些测试覆盖的是 `acceptance-gate.mjs`）
- [x] 1.2 确认可用真实入口离线驱动：`PACTFLOW_ACCEPTANCE_EVIDENCE_DIR` 指向临时证据根
- [x] 1.3 新增 `tests/evidence-collect.spec.ts`（4 项）：完整收齐 / 缺项入 missing / 结构非法失败关闭 / 目录缺失失败关闭
- [x] 1.4 对抗性验证：把 `readEvidenceFile` 改为纯 `JSON.parse`（去掉校验）→「结构非法」用例失败；已还原
- [x] 1.5 验证：`pnpm run check` 全绿（67 文件 / 534 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-evidence-collect-coverage --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
