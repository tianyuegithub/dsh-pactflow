# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/harness-capabilities.spec.ts` 先因模块不存在失败 |
| 纯模块 `harness-capabilities.ts` | ✅ | 级别常量、`harnessCapabilityProfile`（协议/结构化输出/最高级别）、`harnessAchievedLevel`（仅按 stages 推导） |
| 探针结果分级 | ✅ | `PactFlowHarnessProbeResult` 新增可选 `achievedLevel`/`maxLevel`；`k3s-worker.probe` 附值（本地镜像函数避免循环导入） |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 声明覆盖全部受支持 Harness | `declares a protocol and a structured-output contract per harness` |
| 仅连通时只报告 protocol | `reports only connection when the probe merely reached the model` |
| CLI 响应成功才报告 artifact | `reports verification reached only when a CLI response and cleanup both succeeded`（前半） |
| 清理成功才报告 cancellation | 同上（后半） |
| 清理失败不得声称 cancellation | `does not claim cancellation when cleanup failed` |

## 已知边界（诚实）

- 级别顺序含 `tool-invocation` 与 `verification`，但当前探针阶段无对应证据，推导函数**不会虚报**这两级；为它们增设探针阶段属后续。
- 本 change 只做分级**报告**，未改变探针行为、未实现能力协商/自动降级。
- 两处级别推导（纯模块 / worker 本地镜像）语义一致靠测试锁定，但仍存在潜在漂移；彻底消除需抽出共享 API-mode 表（R12 结构重构范畴）。
- 真实集群的六级能力实证（A10 完整形态）未运行。

## 验证

`pnpm run check` 通过：55 个测试文件、478 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
