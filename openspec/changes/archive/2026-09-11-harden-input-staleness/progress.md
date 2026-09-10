# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/input-staleness.spec.ts` 先因模块不存在失败 |
| 纯模块 `input-staleness.ts` | ✅ | `staleCodeInputs`：按依赖比对 recorded vs latest，确定性排序，未知最新不误报 |
| 记录依赖编号 | ✅ | `PactFlowGitRunSpec.codeInputs[].dependency?`（含 schema）；`codeInputCommits` 带上编号 |
| 只读 Remote | ✅ | `staleCodeInputs(sessionId, nodeId)` 报告过期输入，不修改状态 |

## Review 的关键发现（诚实记录）

写端到端用例时发现**当前生命周期下该触发器不可达**：`retryNode` 只允许从 `failed/cancelled` 重试，而 `settleRun` 拒绝给已有终态的 Run 再结算。也就是说，一个**已成功**的前序节点无法再产生「新的成功提交」，「前序重跑 → 后序输入过期」在本版本不可能发生。

我没有伪造一个不可达的绿灯测试，而是：
1. 保留纯函数级测试（4 项）证明**检测器本身正确**；
2. 写**可达性边界**用例，断言「前序保持成功时无过期报告」且「成功的节点不可重试」——把该缺口显式化；
3. 在下方 known-gaps 明确记录：该增强当前无触发路径，需先有「已成功节点重跑」能力（属更大设计）。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 输入未变时无过期报告 | `reports no staleness when each recorded input still matches…`、e2e 用例 |
| 依赖新提交后报告过期 | `reports the dependency whose commit moved on after the successor ran`（检测器层） |
| 确定性排序 | `is deterministic and sorted by dependency then branch` |
| 无已知最新提交不误报 | `does not mark staleness for a dependency with no known latest commit` |

## 已知边界（诚实）

- **触发路径不可达**：如 Review 所述，「前序成功后再成功重跑」在本版本不存在，故 `staleCodeInputs` 在真实生命周期里会持续返回空；检测器与记录已就位，待「已成功节点重跑」能力落地后即可生效。**这不构成一个已交付的端到端能力，仅是可复用的检测原语 + 显式缺口。**
- 未实现「自动重跑」或「自动失效批准」——只报告。
- 冲突/半自动处理未涉及。

## 验证

`pnpm run check` 通过：58 个测试文件、486 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
