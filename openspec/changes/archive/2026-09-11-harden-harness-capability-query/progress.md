# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 未接线助手排查 | ✅ | 逐模块统计「导出符号在自身文件外的引用数」：`validationExecutedCount`=0、`harnessCapabilityProfile`=0、`retentionRemainingMs`=0；全仓（含 client/scripts/e2e，排除 openspec 与 lib）复核确认 |
| 缺口判定 | ✅ | 三者均**导出且被单测引用**——测试在未被生产使用的代码上通过 |
| 真正缺口接线 | ✅ | `harnessCapabilityProfile` 此前无任何生产引用，而 `harness-capability-levels` 的场景要求「查询任一受支持 Harness 的能力声明」→ 新增 `@Remote('harnessCapabilities')` |
| 非缺口判定（诚实） | ✅ | `validationExecutedCount`：`PactFlowHarnessProbeResult` 不含 `validations`，契约要求的「运行结果」是 `PactFlowGitResult.validations`（已由 `snapshot()` 暴露），计数可据数据得出；`retentionRemainingMs`：`retentionStatus()` 已暴露每条 `retainUntil`，剩余时间可据数据得出。二者属**薄包装**，新增字段会冗余，故**不改**，仅记录判断 |
| 回归测试 | ✅ | `harness-capabilities.spec.ts` 新增：声明查询返回两个已配置模板、`claude.structuredOutput='native'`、`codex='text'`、`maxLevel===harnessProbeMaxLevel()`、`apiMode` 正确 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 查询覆盖全部已配置模板 | `exposes the declared capability profile of each configured Harness`（断言 templateId 集合） |
| 上限取自可证级别 | 同测试（`maxLevel === harnessProbeMaxLevel()`） |
| 同 id 模板去重 | 实现内 `seen` 去重；未单独构造重复 id 用例（见下） |

## 已知边界（诚实）

- 「同 id 去重」只有实现保障，**未单独写用例**（未构造重复 id 模板场景）。
- 本次只接线了 `harnessCapabilityProfile` 这一处**真实缺口**。另两处未接线助手（`validationExecutedCount`、`retentionRemainingMs`）经判定为「数据已暴露下的薄包装」，**刻意不加线也不删**——加线会引入冗余字段，删线会破坏既有单测；已在上文记录理由。若后续需要「零验证」的一等信号，应新增一个明确字段而不是复用该助手。
- 未对全部 `export` 做穷尽式静态检查（仅按模块抽样 + 关键符号全仓复核）。

## 验证

`pnpm run check` 通过：62 个测试文件、515 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
