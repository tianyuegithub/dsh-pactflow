## 1. 让发布门禁的失败自我报告

- [x] 1.1 缺口：`assertReleaseWebReport` 所有拒绝语均笼统（不指名计数/套件）
- [x] 1.2 改进消息（语义不变）：计数非零打印键+值；计数不完整列出各项；套件不合格打印套件名；意外/重复拆为两条并打印名；缺失套件逐个列出路径
- [x] 1.3 测试：既有 8 项保留，新增 4 项断言消息**确实指名**（计数者 3 / 套件者 / 缺失者 / 意外者）
- [x] 1.4 真实场景复核：以真实 `test:web` 报告（13 项跳过）驱动 → 仍拒绝，消息变为 `numPendingTests must be zero but is 13`（可直接定位到环境门控跳过）
- [x] 1.5 验证：`pnpm run check` 全绿（69 文件 / 543 测试）

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-release-gate-diagnosability --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
