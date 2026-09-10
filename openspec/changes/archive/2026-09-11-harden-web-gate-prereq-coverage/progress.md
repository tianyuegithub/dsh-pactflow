# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 覆盖缺口确认 | ✅ | `grep -rn checkWebGatePrerequisites packages/dsh-pactflow/tests/` 为空；该函数此前只有实现无测试 |
| 门禁实际行为核实 | ✅ | 实跑 `node scripts/run-real-web-gate.mjs` → 失败关闭并给出**设计好的**前置清单（缺 `DSH_SNAPSHOT=record` 等），非脚本缺陷 |
| 测试 | ✅ | `real-web-gate-prerequisites.spec.ts` 2 项：未武装（空/`replay`）须报告；已武装（`record`）不得报告，且返回值恒为非空字符串数组 |
| 对抗性验证 | ✅ | 将 `DSH_SNAPSHOT` 分支短路为 `&& false` → 首项测试失败（`expected [] to include …`）；已还原 |
| 验证 | ✅ | `pnpm run check` 66 文件 / **530** 测试（原 528） |

## 为什么这条守卫值得加

「门禁自身逻辑无人验证」在本会话已两次致害：`verify-profile` 因暂时性死区**从未运行**；`check:release` 因「零跳过 vs 8 个环境门控」**结构上不可满足**。二者都是**只在运行时暴露**、读代码看不出的缺陷。`checkWebGatePrerequisites` 决定同一门禁族（网页零跳过）是否武装，属同一暴露面——故补其确定性分支的测试。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 未武装时报告缺失前置 | `always requires record mode for the real worker suites`（空 / `replay` 两态） |
| 已武装时不再报告该前置 | `never reports the record-mode prerequisite once armed …`（并断言恒为非空字符串数组） |
| 前置检查被破坏时测试失败 | 对抗性验证（短路该分支 → 测试失败） |

## 已知边界（诚实）

- 仅覆盖 `DSH_SNAPSHOT` 这一**确定性**条目；`kubectlReachable()` 与 `giteaTokenRefPresent()` 依赖真实集群/凭据，**未做断言**（其行为在实跑中已验证，但未纳入离线测试）。
- 未验证「门禁通过路径」端到端（需全武装真实环境 + 你的 P1-4 批准），故本 change 只保证**前置判定**正确，不保证整条发布链路可满足——后者已知被 `check:release` 的零跳过断言阻断（见待办清单第 15 项）。

## 验证

`pnpm run check` 通过：66 个测试文件、530 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
