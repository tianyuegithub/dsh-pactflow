## 1. Host 合同与只读查询

- [x] 1.1 `src/types.ts` 新增 `PactFlowDrainStatus`（含 `safeToUninstall`、`activeRuns[]`、`pendingCleanups[]`），并为移交摘要新增 `packageVersion`/`eventProducerVersion` 字段，以 `pnpm run typecheck` 通过验证类型自公开子路径导出
- [x] 1.2 `src/index.ts` 新增 `@Remote('drainStatus')`：跨会话汇总非终态 Run 与未成功清理责任，只读且不触发清理；以新增 `tests/drain-status.spec.ts` 的 4 个场景（无责任 / 有活跃 Run / 有未完成清理 / 重复调用一致且无副作用）通过验证
- [x] 1.3 `src/index.ts` + `src/project-handover.ts` 把 `packageVersion`/`eventProducerVersion` 注入移交摘要；扩展 `tests/project-handover.spec.ts` 验证两字段来自构建常量与注册事实

## 2. 客户端零验证标注

- [x] 2.1 新增 `src/client/verification-label.ts` 纯函数，零计数返回「无自动验证」语义；以新增 `tests/verification-label.spec.ts` 覆盖零/正/取自证据三个分支
- [x] 2.2 `src/client/locale.ts` 新增中英键；`src/client/overlay.tsx` 运行行改用该标注，以 `pnpm run test` + `pnpm run test:web`（客户端场景不回归）验证

## 3. 文档绑定

- [x] 3.1 `docs/installation-operations-安装运维.md` §7 卸载步骤加入 drain 前置与处置说明；以测试断言手册含 `drainStatus` 且该名与 Host 实际 Remote 名一致

## 4. 收口验证

- [x] 4.1 `pnpm run check`（build + 全量单测 + pack:check）全绿
- [x] 4.2 `openspec validate --all --strict` 通过，随后 archive 归并并确认主 spec Purpose 非占位
