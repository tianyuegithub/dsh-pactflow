## Why

真实崩溃重启套件（`test:real-crash-restart`）声称「clean up the Job/ConfigMap/branch it created」，但实际**从不删除它创建的远程任务分支**：清理函数用 `names()`（Kubernetes 对象名校验器）去校验 **git 分支名**，而分支名含 `/`，`names()` 立即抛错；旧代码又用 `catch { /* may never have pushed */ }` 静默吞掉异常。结果是每次运行都在验收仓库留下一个 `pactflow/need/node/*` 分支。

本轮真实运行时被发现：验收远程累积了多个残留分支，而测试**一直报告通过**——静默泄漏 + 假绿。

（同类教训在本批已出现一次：A11 的 `maxOutputBytes` 是「导出且被单测引用、但生产未接线」的死代码。二者共同点是**清理/约束的失败不可见**。）

## What Changes

- `scripts/crash-restart-runner.mjs`：
  - 新增 `refName()`（允许 `/` 的 git 引用名校验），`gitDeleteBranch` 改用它——不再把 K8s 对象名校验器用于分支名（这是根因）。
  - 清理改为**可验证**：删除后确认引用消失，并再等一拍复核，避免被容器迟到的 push 重新创建；重试若干次仍失败则 `log(WARNING)` 显式报告，不再静默。
  - 删除 Job（foreground cascade）后先等待片刻再删分支，让被 SIGKILL 的 Worker 的迟到 push 先落地。
  - 新增裁决字段：若分支最终未清理，`verdict.ok=false`（`remote task branch was not cleaned up`），使泄漏**使测试失败**而不是被忽略。

## Capabilities

### New Capabilities
- `real-suite-hygiene`: 真实环境套件必须自清理其创建的远程/集群资源，且清理失败 MUST 可见（使测试失败或显式告警），MUST NOT 静默吞掉。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/crash-restart-runner.mjs`（引用名校验、可验证清理、失败可见）。
- **测试**：`e2e/pactflow-real-crash-restart.e2e.spec.ts`（既有断言不变，现能捕获泄漏）。
- **环境**：已手动清理本会话 4 个残留分支（由本轮失败运行产生）。
- **兼容**：仅影响真实套件的清理路径；`pnpm run check` 全绿。
