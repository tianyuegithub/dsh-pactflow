## Why

面向用户的安装运维手册 `docs/installation-operations-安装运维.md` 在升级/卸载一节声称：

> 0.2.1 当前写入 **13** 类外部事件，同时以 read-only registration 读取 0.1.0 的 12 类词汇和 0.2.0 的 13 类词汇

但代码实际写入 **17** 类（`PACTFLOW_EVENT_TYPES_V0_3` 有 17 项；0.1.0=12、0.2.0=13 两项陈述正确）。这条数字是**兼容性合同**——读旧日志、判断重装是否匹配词汇的人会据此决策，错的数字会误导运维判断。

属本批同一类问题：**声称与事实不符，且没有任何机制会发现**（文档不经门禁校验）。

## What Changes

- `docs/installation-operations-安装运维.md`：把 0.2.1 的写入事件数由 **13** 更正为 **17**，并标注其来源元组 `PACTFLOW_EVENT_TYPES_V0_3`。
- 新增 `packages/dsh-pactflow/tests/ops-doc-event-count.spec.ts`（3 项）：把手册中的三处计数与代码元组**实际长度**绑定——
  - 0.2.1 写入数 == `PACTFLOW_EVENT_TYPES_V0_3.length`；
  - 0.1.0 == `PACTFLOW_EVENT_TYPES_V0_1.length`（12）、0.2.0 == `PACTFLOW_EVENT_TYPES_V0_2.length`（13）；
  - 历史元组长度不变，且旧词汇是当前词汇的子集（可读性契约）。

## Capabilities

### New Capabilities
- `operator-doc-accuracy`: 面向用户的运维文档中与代码绑定的关键数字（如外部事件词汇量）必须与代码实际一致，并随默认门禁校验。

### Modified Capabilities
（无。）

## Impact

- **文档**：`docs/installation-operations-安装运维.md`（一处数字更正）。
- **测试**：新增 `tests/ops-doc-event-count.spec.ts`（`pnpm run check` 由 64 文件 / 522 → 65 文件 / 525）。
- **兼容**：代码未改；仅更正文档并使该数字受门禁守护。
