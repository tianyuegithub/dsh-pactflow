# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 覆盖缺口确认 | ✅ | `grep -rln "workspace-lock" tests/` 无结果；`withWorkspaceFileLock` 为跨进程互斥的**唯一**实现，此前零测试 |
| 真实多进程加锁用例 | ✅ | `serializes read-modify-write across processes so no update is lost`：4 进程 × 15 迭代 = **60**（精确） |
| 无锁对照 | ✅ | `demonstrates the same workload loses updates without the lock (control)`：同负载无锁 → < 60 |
| 测试自身缺陷被发现并修正 | ✅ | 首版用 `execFileSync`（**顺序**执行子进程），对照用例失败（`expected 60 to be less than 60`），暴露「测试根本不并发」；改为 `spawn` + `Promise.all` 后两用例均通过 |
| 稳定性 | ✅ | 连续 3 次运行均 2/2 通过（约 0.6s/次） |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 加锁时无更新丢失 | `serializes read-modify-write across processes so no update is lost` |
| 无锁对照必须显示丢失 | `demonstrates the same workload loses updates without the lock (control)` |
| 对照防止空转断言 | 两个用例在同一次运行中并存：加锁=60、无锁<60，互为对照 |

## 已知边界（诚实）

- 该测试验证的是**跨进程**互斥（同一主机、真实 OS 进程）。**跨主机**（NFS/共享盘）语义未验证——锁基于目录 rename 与 `hostname()`/PID 存活检查，跨主机行为取决于文件系统语义，属更大范围。
- 对照用例依赖真实竞争；实现中在读写之间插入 5ms 间隔以稳定放大交错窗口。若未来机器调度极端到不交错，该用例理论上可能偶发通过（届时它本身就说明竞争消失）。已连续 3 次验证稳定。
- 未覆盖「持锁进程被 SIGKILL 后的接管」在**真实多进程**下的时序（该恢复逻辑存在并被这次的多进程运行间接经过，但未构造专门的 kill 场景）。

## 验证

`pnpm run check` 通过：62 个测试文件、514 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
