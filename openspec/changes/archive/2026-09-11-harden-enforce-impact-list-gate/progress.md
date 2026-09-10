# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现未强制执行 | ✅ | 穷尽扫描 `scripts/**` 的运行时导出与模块导入：`impact-list.schema.mjs` 既无导入方、也不在 `package.json` scripts；而 `development-plan` §380 明确要求该清单 |
| 处置判定 | ✅ | 有契约要求 → **接线**（对照：无契约的 `retentionRemainingMs` 已删除、有契约的 `harnessCapabilityProfile` 已接线） |
| 门禁函数 | ✅ | `requireGrantedImpactList`（结构校验 + 必须 `granted`）、`loadAndRequireGrantedImpactList`（从文件） |
| 运行接线 | ✅ | `run-real-k3s-batch.mjs` 的 `enforceImpactListGate()`：提供清单→必须已授权；未提供→显式告警门禁未施加 |
| 测试 | ✅ | `tests/impact-list-gate.spec.ts` 5 项全绿（含「well-formed 但 pending 被拒」这一核心断言） |
| 验证 | ✅ | `pnpm run check` 63 文件 / **519** 测试（原 514） |

## 关键判断（诚实）

- **结构有效 ≠ 已授权**是本 change 的核心断言：`pending` 清单完全合法，但**不得执行**。测试专门覆盖「well-formed 但 pending 被拒绝」。
- 未提供清单时**选择告警而非 fail-closed**：理由是当前 CI/本地调用尚未普遍提供清单，直接 fail-closed 会让既有批量运行全部失败；显式告警消除了「静默假装已校验」的问题，同时不制造破坏性变更。若后续要求强制，可改为 fail-closed（一行改动）。
- 门禁只加在 **`run-real-k3s-batch`**（它同时变更集群与远程分支）。其余真实套件（todo/gitea/k3s）未加，因为它们各自已有独立的资源清理与断言；是否统一施加属范围问题，未擅自扩大。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 已授权清单通过 | `accepts a granted list and still rejects a malformed one` |
| 未授权清单被拒绝 | `refuses a well-formed but ungranted list`（`authorization=pending`） |
| 结构非法的清单被拒绝 | `rejects unknown fields, empty arrays, and bad enums` |
| 未提供清单时显式告警 | `enforceImpactListGate()` 的告警分支（脚本级；未写断言——见下） |

## 已知边界（诚实）

- 「未提供清单时显式告警」目前只有脚本实现，**无断言守护**（`run-real-k3s-batch.mjs` 的 `main()` 需真实集群可达才会走到该分支，不在单测范围）。
- 门禁是否由**唯一写入方**真实取得授权，取决于提供的清单内容；本 change 只校验「清单存在且标记为 granted」，**不校验授权的真实性**（后者需外部授权链，属上游）。
- 仅 `run-real-k3s-batch` 接线；其它真实套件未统一施加。

## 验证

`pnpm run check` 通过：63 个测试文件、519 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
