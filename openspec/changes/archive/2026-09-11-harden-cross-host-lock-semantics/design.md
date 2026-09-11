## Context

见 `proposal.md · Why`。锁实现（`workspace-lock.ts`）已核对的机制事实：

- **抢占原语**：`rename(pending, lockPath)`——POSIX 语义下 rename 到已存在**非空**目录必败（EEXIST/ENOTEMPTY）；owner 文件在 rename **之前**写入 pending，故持有期锁目录恒非空。
- **同宿主恢复**：owner 文件含 `{host}`，文件名含 `owner-<pid>-<uuid>.json`；`recoverDeadOwner` 仅当 `host === hostname()` 且 `process.kill(pid, 0)` 报 ESRCH 时才接管。
- **清扫**：`recoverLockArtifacts` 对 `pending-*`/`released-*` 目录逐个走 `recoverDeadOwner`——异宿主条目在其中被安全跳过。
- **超时**：5 秒硬编码 deadline，超时抛「PactFlow Workspace configuration lock timed out; inspect…」——无任何测试绑定该消息全文（已 grep 核实），可安全增强。

## Goals / Non-Goals

**Goals**

- 把「异宿主遗留锁失败关闭、不得改动」从代码事实升格为**被测试钉住的合同**（防未来被"改进"成按龄抢占）。
- 超时错误可诊断（指名持有 host/pid），使跨主机卡死的人工恢复可执行。
- 把共享 FS 依据、验证边界、NFS runbook 写入运维手册并由测试绑定。

**Non-Goals**

- 不实现跨主机死主恢复（TTL/租约会偷活主，明确违背设计原则；本机死活可探测、异主机不可——非对称是本质的）。
- 不在本轮完成真实 NFS 双客户端验证（集群无 RWX、本机挂载需 sudo；只交付 runbook 并如实标注未运行）。
- 不改恢复/夺取行为本身（本 change 的运行时改动仅限超时错误信息）。

## Decisions

### 决策 1：异宿主语义用「真实子进程」验证而非进程内调用

- **理由**：被钉住的是**完整竞争路径**（清扫→pending→竞争→超时→错误），进程内调用会绕过真实的 hostname 比对与子进程隔离；与 4 进程测试同一 driver 模式（环境变量传参、字面量 argv、JSON 结果到 stdout）。

### 决策 2：错误增强是 best-effort 附加，不掩盖原超时

- **理由**：owner 文件可能损坏/丢失（崩溃窗口）——读取失败时必须仍抛出原超时错误，不能因诊断读取而掩盖锁竞争失败本身。
- **做法**：deadline 到期后 `readFile` owner 文件，解析 `host` 与文件名 pid，拼入 `（held by host "X", pid Y）`；任何读取异常走原消息。消息前缀保持逐字不变。

### 决策 3：异宿主主机名在测试中先断言 ≠ 本机 hostname

- **理由**：若测试机恰好叫那个名字，测试会**静默反转**成同宿主语义而全绿——这是典型的空转风险；先用 `expect(foreign).not.toBe(hostname())` 封死。

### 决策 4：NFS runbook 写入手册并绑定测试，但不进默认测试套件

- **理由**：真实挂载需 sudo 且改变系统状态（nfsd、/etc/exports、mount），不可作为无人值守测试运行；runbook 的价值在于让**人**能在有权限的环境一步复现。绑定测试只验证手册小节存在且含关键命令，防漂移。

## Risks / Trade-offs

- [跨主机卡锁需要人工干预，可能被用户视为"缺陷"] → 语义已写明：这是「绝不偷活主」的代价侧；恢复步骤两步（看 owner 文件 → 确认后删目录），且错误信息现在直接给出持有者。
- [错误消息新增后缀可能影响下游 grep] → 前缀逐字不变；仓库内无对该消息的既有断言（已核实）。
- [测试依赖真实 hostname 差异] → 断言前置排除；hostname() 在 CI/本机恒有稳定值。

## Migration Plan

1. 改 `workspace-lock.ts` 超时错误（best-effort owner 读取）。
2. 新 driver + 3 项真实子进程测试 + 手册小节 + 文档绑定。
3. `pnpm run check` 全绿 → validate → archive → 文档登记 → 提交推送同步。

## Open Questions

（无。）
