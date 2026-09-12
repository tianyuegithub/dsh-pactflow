# worker-admission-uniformity Specification

## Purpose
约束所有 Worker 入口经过同一准入点：本地 Git 与 K3s 都必须先排队、取得槽位、重核取消与版本，之后才 claim/执行；在恢复盘点等屏障生效期间，任何入口都不得 claim 或执行；准入后失败必须释放槽位。

## Requirements

### Requirement: 所有 Worker 入口必须经过统一准入

本地 Git 与 K3s 派发 SHALL 在 claim 之前调用同一准入点（`acquireExecutionOrCancel`），并在准入被拒绝或取消时登记队列取消事件且不产生 claim。本地路径 MUST NOT 在未取得槽位的情况下直接 claim 或执行。

#### Scenario: 本地派发经过共享准入器

- **WHEN** 一次本地 Git 派发被接受
- **THEN** 它以一次共享准入调用取得槽位后才 claim 与执行

#### Scenario: 屏障生效期间本地不 claim 不执行

- **WHEN** 恢复准入屏障处于生效状态（如盘点暂停准入）
- **THEN** 本地 Git 派发既不 claim 也不执行子代理，直到屏障解除

#### Scenario: 准入后失败释放槽位

- **WHEN** 准入后的重核（取消、修订、工作区配置）失败
- **THEN** 登记队列取消事件、释放槽位，且不产生 claim

### Requirement: 准入后必须重核取消与版本

在取得槽位、开始执行之前，客户端 SHALL 重核：调用方取消信号、节点与项目修订、以及工作区配置快照；任一漂移或取消 MUST 使派发失败关闭并释放槽位。

#### Scenario: 等待期间取消不 claim

- **WHEN** 派发在等待准入期间被取消
- **THEN** 不产生 claim，释放槽位

#### Scenario: 等待期间配置漂移不 claim

- **WHEN** 等待准入期间工作区配置或项目/节点修订发生变化
- **THEN** 拒绝该派发并登记队列取消，不产生 claim

### Requirement: 统一准入对暂停节点的拒绝语义与其它非就绪状态一致

统一派发准入 SHALL 把「节点处于暂停状态」与其余非就绪状态（pending/claimed/running 等）同样对待：拒绝时**指名节点与原因**（暂停等待人工恢复），MUST NOT 静默跳过、重排或绕过队列公平性。

#### Scenario: 暂停节点的派发请求被指名拒绝

- **WHEN** 派发请求的目标节点处于暂停状态
- **THEN** 请求失败关闭，错误指名该节点与「等待人工恢复」原因，且不影响队列中其它节点的公平调度
