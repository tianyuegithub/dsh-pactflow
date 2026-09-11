## Why

A03 / A12 的完整形态里有两处「用户可见的诚实与安全」缺口，且都属**没有合同依据的新能力**（已逐条对照 `openspec/specs/*` 核实）：

1. **零验证在交付视图里不像「没有验证」**：数据已就位（`validationsExecuted` 只读字段、`run.gitResult.validations`），但项目面板对零验证仍只显示 `验证命令: 0`，读者无法一眼判定「本次交付**根本没有自动验证**」，容易被读成「验证通过但数量为零」。
2. **卸载缺少可判定的前置**：`docs/installation-operations-安装运维.md` §7 只验卸载后 Bundle/Preset/Remote 消失（`pactflow/health` 404），**从不检查是否仍有活跃 Run 或未完成清理责任**。带着运行中任务或未清理资源卸载，会把责任静默留在集群/磁盘上。文档缺该前置，也无任何可查询信号。

与此同时，**移交摘要缺版本可追溯**：`project-handover` 导出了项目与精确 Git 产物，但没有「兼容 reader 版本 / 包版本」，因此「旧日志的 reader 版本可追溯」无法满足。

## What Changes

- **A03-a（零验证一等只读信号）**：
  - 新增客户端纯函数 `pactFlowVerificationLabel(count)`，对 `count === 0` 返回明确的「无自动验证」语义键，而不是 `0`。
  - 项目面板运行行与交付视图改用该标注；新增本地化键（中/英）。
- **A12-a（卸载前只读 drain 检查）**：
  - 新增只读 Remote `drainStatus()`：跨 PactFlow 会话汇总**非终态 Run** 与**未成功清理责任**，返回 `safeToUninstall` 与逐项清单。**只读、绝不自动清理**。
  - `docs/installation-operations-安装运维.md` §7 加入「卸载前必须运行 drain 检查；非空则先 drain 或显式确认」的步骤，并由测试绑定文档与 Remote 名。
- **A12-b（版本可追溯）**：
  - 移交摘要新增只读字段 `packageVersion` 与 `eventProducerVersion`，使「旧日志的兼容 reader 版本」可从摘要直接读出。

## Capabilities

### New Capabilities
- `uninstall-drain-safety`: 卸载前必须能查询是否存在活跃 Run 与未完成清理责任；非空时该查询必须明确返回「不宜卸载」并列出责任，且该查询本身只读、不自动清理。

### Modified Capabilities
- `validation-integrity-signals`: 「零验证必须可识别」扩展到**客户端呈现层**——零验证必须以「无自动验证」的显式标注呈现，而不是以计数 `0` 呈现。
- `project-handover`: 只读移交摘要除项目/产物/责任外，还必须携带**包版本与兼容事件生产者（reader）版本**，使旧日志的读取版本可追溯。

## Impact

- **Host/Remote**：`src/index.ts` 新增 `@Remote('drainStatus')`；`src/types.ts` 新增 `PactFlowDrainStatus` 与移交版本字段（Typert 边界要求返回类型自公开类型子路径导出）。
- **客户端**：`src/client/verification-label.ts`（新纯函数）、`overlay.tsx`（零验证标注）、`locale.ts`（新键）。
- **文档**：`docs/installation-operations-安装运维.md` §7。
- **测试**：新增 `drain-status.spec.ts`、`verification-label.spec.ts`；扩展 `project-handover.spec.ts`；新增/扩展文档绑定守卫。
- **兼容**：纯新增只读字段与只读 Remote，无行为破坏；`drainStatus` 不触及任何状态。
- **架构对应**：`docs/architecture-目标架构.md` 的「可移交、可退出」不变量与「诚实呈现」原则；不引入自动清理或强制卸载。
