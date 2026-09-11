## Why

11 号待办的剩余项：工作区文件锁的**跨主机（共享盘）语义**从未被验证。真实跨进程互斥（4 进程）与无锁对照早已交付，但锁文件放在跨主机共享文件系统上时的行为只存在于代码推理中。接线定性发现两个此前**未被合同约束**的事实：

1. **异宿主遗留锁被故意不恢复**：`recoverDeadOwner` 对 `owner.host !== hostname()` 的锁直接返回——因为无法探测异主机进程死活，夺取会破坏「绝不偷活主」的核心不变量。这意味着跨主机崩溃后的锁**永久卡死待人工**，是失败关闭（安全），但该语义无合同、无测试，未来一次"顺手改进"就可能把它改成危险的按龄抢占。
2. **超时错误不可诊断**：竞争者超时后只报「timed out; inspect the active or interrupted writer」——在跨主机场景下，运维**不知道锁被哪台机器、哪个进程持有**，人工恢复无从下手。

同时，共享文件系统互斥的**依据**（服务端 rename 原子性）与**验证边界**（真实 NFS 双客户端验证因集群无 RWX 存储、本机挂载需 sudo 而未运行）都应写清，不得让「已验证」覆盖到未验证的部分。

## What Changes

- `src/workspace-lock.ts`：锁竞争超时错误**指名当前持有者**——从锁目录的 owner 文件读取 `host` 与文件名中的 `pid`，附入错误（owner 文件不可读时保持原消息）；**不改变**异宿主不恢复的行为本身。
- 新增测试 `tests/workspace-lock-cross-host.spec.ts`（真实子进程，离线、零特权）：
  - 异宿主遗留锁：竞争者在有界时间内**失败关闭**，错误含异宿主主机名与 pid；锁目录内容**逐字节不变**（未偷、未删）；
  - 异宿主遗留的 pending/暂存工件：本机清扫后**原样保留**；
  - 同宿主死主：仍被正常恢复、竞争者正常获得锁（回归守卫，防"改进"破坏既有行为）。
- 新增 driver `scripts/workspace-lock-foreign-driver.mjs`（子进程执行一次锁竞争并输出 JSON 结果，供父进程断言）。
- 运维手册新增「跨主机/共享盘上的锁」小节：语义声明、人工恢复步骤、**真实 NFS 双客户端验证 runbook**（精确命令，需 sudo / 集群 RWX——属当前环境不具备的未运行边界），并由测试绑定文档存在。

## Capabilities

### New Capabilities
（无。）

### Modified Capabilities
- `multiprocess-workspace-lock`: 扩展两条合同——①**异宿主遗留锁必须失败关闭且不得被改动**（含超时错误的可诊断性）；②**共享文件系统互斥的依据与验证边界必须文档化**（服务端 rename 原子性为依据；跨主机死主恢复明确不在保证内；真实 NFS 验证的 runbook 与未运行状态如实记录）。

## Impact

- **Host**：`src/workspace-lock.ts` 仅超时错误信息增强（新增 owner 读取，best-effort、失败不掩盖原超时）；恢复/夺取行为零改动。
- **测试**：新增 `tests/workspace-lock-cross-host.spec.ts`（3 项，真实子进程）+ 文档绑定断言；新增 `scripts/workspace-lock-foreign-driver.mjs`。
- **文档**：`docs/installation-operations-安装运维.md` §6 新小节；待办清单第 11 行更新为「失败关闭语义已验证；真实 NFS 双客户端验证待环境（runbook 就绪）」。
- **兼容**：错误消息前缀不变（新增后缀）；行为零变化；纯新增测试与文档。
