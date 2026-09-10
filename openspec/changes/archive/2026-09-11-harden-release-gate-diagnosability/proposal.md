## Why

`assertReleaseWebReport`（网页零跳过门禁的判定核心）此前所有拒绝语都是**笼统**的：`numPendingTests must be zero`、`required suites or assertions are missing`、`unexpected or duplicate suite`——都不指明**是哪个**计数、**哪个**套件。

本会话在排查 `check:release` 的不可满足性时，正是被这种笼统信息拖慢：真实报告里 `numPendingTests` 是 13（8 个环境门控套件），但错误只说「must be zero」。这与本会话反复奏效的**「让失败自我报告」**相反：门禁必须能从消息本身定位问题。

## What Changes

- `scripts/release-web-report.mjs`：每个拒绝语都带上**具体责任方**（不改变通过/失败的判定语义）：
  - 计数非零 → 打印键名与实际值（`numPendingTests must be zero but is 13`）；
  - 计数不完整 → 列出每个不符的计数（`numPassedTests=… != numTotalTests=…` 等）；
  - 套件断言不合格 → 打印该套件名；
  - 意外/重复套件 → 打印套件名（拆为两条独立信息）；
  - 缺少套件 → 逐个列出缺失文件路径。
- `tests/release-gate.spec.ts`：既有 8 项（`toThrow()`）保留，另加 4 项断言**消息确实指名**（计数者/套件者/缺失者/意外者）。

## Capabilities

### New Capabilities
- `release-gate-diagnosability`: 发布门禁的拒绝必须指名具体责任方（哪个计数、哪个套件、哪个缺失），使失败可由消息本身定位，而不仅是笼统拒绝。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/release-web-report.mjs`（仅错误消息与分支细化；判定语义不变）。
- **测试**：`tests/release-gate.spec.ts`（8 → 12 项）。
- **兼容**：通过集合与失败集合**完全不变**（已用真实 `test:web` 报告验证：仍拒绝，且消息变为 `numPendingTests must be zero but is 13`）。
