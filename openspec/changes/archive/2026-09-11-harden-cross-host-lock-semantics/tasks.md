## 1. Host 超时可诊断性

- [x] 1.1 `src/workspace-lock.ts` 超时错误追加持有者信息：deadline 到期后 best-effort 读取锁目录 owner 文件（解析 `host` 与文件名 pid），拼入 `held by host "X", pid Y` 后缀；读取失败保持原消息逐字不变。验证：现有测试全绿（消息前缀不变）

## 2. 跨主机语义测试（真实子进程，离线）

- [x] 2.1 新增 `scripts/workspace-lock-foreign-driver.mjs`：单次锁竞争，结果（acquired / error message）以 JSON 输出到 stdout。验证：node --check 通过
- [x] 2.2 新增 `tests/workspace-lock-cross-host.spec.ts` 三项：①异宿主遗留锁 → 子进程有界失败关闭、错误含异宿主主机名与 pid、锁目录内容逐字节不变；②异宿主遗留 pending 工件 → 本机竞争者清扫后原样保留；③同宿主死主 → 竞争者正常恢复获锁（回归守卫）。每项先断言伪主机名 ≠ 本机 hostname（防空转）。验证：3 项全绿
- [x] 2.3 手册绑定：运维手册新增「跨主机/共享盘上的锁」小节（语义、人工恢复步骤、真实 NFS 双客户端验证 runbook 且标注未运行）；测试断言小节含关键命令与「未运行」标注。验证：绑定测试通过

## 3. 收口

- [x] 3.1 `pnpm run check` 全绿 + `openspec validate --all --strict` 通过 + archive 归并
- [x] 3.2 待办清单第 11 行与实施状态更新；提交推送并同步主目录
