## 1. 更正并守护运维文档数字

- [x] 1.1 发现：手册称 0.2.1 写入 13 类外部事件，实际代码写入 17 类（0.1.0=12、0.2.0=13 两项陈述正确）
- [x] 1.2 以代码核算三处计数：`PACTFLOW_EVENT_TYPES_V0_1=12`、`_V0_2=13`、`_V0_3=17`（`PACTFLOW_EVENT_TYPES` 即 V0_3）
- [x] 1.3 更正手册：13 → **17**，并标注来源元组
- [x] 1.4 新增 `tests/ops-doc-event-count.spec.ts`：把三处文档数字与元组长度绑定，并校验历史词汇为当前词汇子集
- [x] 1.5 对抗性验证：把手册改回 13 → 守卫失败并给出实际文本；已还原为 17
- [x] 1.6 验证：`pnpm run check` 全绿（65 文件 / 525 测试）；`openspec validate --all --strict` 28/28

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-ops-doc-accuracy --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
