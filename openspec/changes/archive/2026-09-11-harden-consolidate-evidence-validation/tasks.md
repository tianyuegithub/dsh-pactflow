## 1. 收敛证据读取/校验为唯一路径

- [x] 1.1 穷尽扫描发现：`validateAcceptanceEvidenceFile` 零消费者，而两个调用点各自内联复制其实现（同动作三份实现）
- [x] 1.2 排除误报：`ACCEPTANCE_EVIDENCE_VERDICTS`/`ACCEPTANCE_EVIDENCE_CONCLUSIONS` 在 `validateAcceptanceEvidence` 内部使用，非死代码
- [x] 1.3 `evidence-collect.mjs` 的 `readEvidenceFile` 改为调用 `validateAcceptanceEvidenceFile`
- [x] 1.4 `acceptance-gate.mjs` 的 `evidence.json` 分支改为经同一函数，导入同步
- [x] 1.5 语法与悬空引用核查（`node --check`；确认无残留 `validateAcceptanceEvidence(` 调用点）
- [x] 1.6 验证：`pnpm run check` 全绿（63 文件 / 519 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-consolidate-evidence-validation --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
