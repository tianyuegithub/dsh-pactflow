## 1. 为 capability spec 加卫生守卫

- [x] 1.1 复现问题：本会话归档 4 个新建 capability 的 change，每次都产生占位 Purpose 并令 `validate --all` 失败
- [x] 1.2 现状核查：当前 27 个 spec **全部**为真实 Purpose（无占位残留）
- [x] 1.3 新增 `tests/openspec-spec-hygiene.spec.ts`：Purpose 存在/非空/非占位 + 至少一个 Requirement
- [x] 1.4 对抗性验证：把某 spec 的 Purpose 改为占位 → 守卫失败并指明 capability；已还原
- [x] 1.5 验证：`pnpm run check` 全绿（64 文件 / 522 测试）；`openspec validate --all --strict` 27/27

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-spec-purpose-guard --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
