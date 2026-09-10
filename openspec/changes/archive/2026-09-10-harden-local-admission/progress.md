# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 失败测试 | ✅ | `tests/local-admission.spec.ts` 先失败：`expected "vi.fn()" to be called 1 times, but got 0 times`（准入未被调用）；暂停期间 `started` 仍被调用（未受屏障约束） |
| 1.2 接入准入 | ✅ | 本地派发登记 `run-queued` 后 `acquireExecutionOrCancel` |
| 1.3 准入后重核 | ✅ | 重核 `assertValidationProfilesCurrent`、workspace 快照、node/project 修订、signal；失败登记 `run-queue-cancelled` |
| 1.4 finally 释放 | ✅ | 无论成功/失败均释放槽位 |

## 关键说明：测试首版是「假通过」，已修正

首版测试用「暂停准入后等待 50ms 看是否 claim」判定，但该等待与真实 Git I/O 赛跑，未真失败即通过——**是假阳性**。改为两条**确定性**断言后先红：
1. 直接断言共享准入器被调用（`acquire` 调用次数）；
2. 暂停期间等待 300ms 断言 `run-claimed` 事件不存在且子代理未启动。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 本地派发经过共享准入器 | `passes the local Git dispatch through the shared admission scheduler` |
| 屏障生效期间本地不 claim 不执行 | `does not claim or execute a local Git node while admission is paused` |
| 准入后失败释放槽位 | 既有 `dispatch-admission` 的 K3s 版覆盖同序列；本地版以 `finally` 释放实现，由首个测试的成功路径隐含 |
| 等待期间取消/漂移不 claim | 源码重核 + `run-queue-cancelled` 登记（与 K3s 同一路径） |

## 已知边界（诚实）

**本地派发经准入点，但不消耗 Agent Profile / 池槽位。** 原因是本地路径没有 Harness/Agent Profile 概念，而准入器的项目与池配额以 `profileId`/`poolId` 为键；本地因此传入 `undefined`。效果：本地派发受**屏障、FIFO 与取消**约束（F07 的核心缺口已关闭），但不受 Profile/池并发限额。是否应让本地计入 workspace 级并发，属设计裁决（评审 F07 建议「明确定义 workspace 并发」），记录于此待裁决，未擅自设定语义。

## 验证

`pnpm run check` 通过：45 个测试文件、444 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
