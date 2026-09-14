# tasks — manifest-producer-version-guard

## 1. 守卫（先红）

- [ ] 1.1 `EVENT_PRODUCER_VERSION` 迁到单测可导入的无装饰器模块（`src/domain.ts` 或同类），`src/index.ts` 改为从该处导入；`pnpm run typecheck` 与 `build` 通过。验证：build
- [ ] 1.2 新增守卫测试：读 `worker/dsh/release-manifest.json` 的 `hostEventProducerVersion`，与 `EVENT_PRODUCER_VERSION` 断言相等，失败消息指名两侧取值。**当前状态下该测试必须先红**。验证：单测红

## 2. 修正

- [ ] 2.1 清单 `hostEventProducerVersion` 改为与代码一致；Git 历史依据（`1594fa5` / `3146903`）记入实施状态。验证：1.2 转绿
- [ ] 2.2 `pack:check` 对 `release-manifest` / `runtime-manifest` 的一致性检查保持全绿。验证：`release-artifact.spec.ts`

## 3. 收口

- [ ] 3.1 `pnpm run check` 全绿、`openspec validate --all --strict` 全绿
- [ ] 3.2 `docs/CURRENT_STATUS-当前状态.md` §4「2026-09-15 新增」中该条关闭；`docs/remaining-work-priorities-待办优先级.md` 第 21 条关闭；实施状态记录
