## Why

`workspace-lock.ts` 的 `withWorkspaceFileLock` 是「跨进程互斥」这一**声明**的实现，但此前**没有任何测试**覆盖它——既没有单元测试，也没有跨进程测试。所有既有测试都在单进程内运行，无法观察到跨进程互斥是否真的成立；「多宿主并发」因此在文档中只能记为 **not-run**。

本 change 用一个**真实多进程**测试补上这一缺口：N 个独立 Node 进程对同一文件做 read-modify-write，由真实文件锁保护；只有真正跨进程互斥，计数才会精确等于 进程数×迭代数。并配一个**对照**：同样的负载**不加锁**必须丢失更新，从而证明断言不是「恰好没踩中」的空转。

## What Changes

- 新增 `scripts/multi-process-lock-driver.mjs`：单进程负载驱动（读取→等待→写回共享计数；`PACTFLOW_LOCK_UNLOCKED=1` 时跳过锁）。输入全部经环境变量传入，argv 保持字面量。
- 新增 `tests/workspace-lock-multiprocess.spec.ts`：
  - 「加锁」用例：并发启动 4 个真实子进程 × 15 次迭代，断言计数精确为 60；
  - 「对照」用例：同样负载不加锁，断言计数 **小于** 60（证明存在真实竞争与丢失）。
- 首次实现曾用 `execFileSync`，对照用例失败并暴露**测试本身不可并发**（子进程被顺序执行）；已改为先 `spawn` 全部子进程再 `Promise.all` 等待，使其真正并发——这正是对照用例的价值。

## Capabilities

### New Capabilities
- `multiprocess-workspace-lock`: 跨进程工作区文件锁必须在**真实多进程**下被验证为互斥；验证必须包含「无锁会丢失更新」的对照，以免断言沦为空转。

### Modified Capabilities
（无。）

## Impact

- **脚本/测试**：`scripts/multi-process-lock-driver.mjs`、`tests/workspace-lock-multiprocess.spec.ts`。
- **被验证的实现**：`src/workspace-lock.ts`（未改动，只是首次获得真实跨进程验证）。
- **兼容**：纯新增测试与测试基建；`pnpm run check` 全绿（新增 2 项）。
