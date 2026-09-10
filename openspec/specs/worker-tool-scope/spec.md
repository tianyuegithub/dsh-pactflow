# worker-tool-scope Specification

## Purpose
约束编排器只读守卫的**作用域**：它只能作用于编排器会话，不得泄漏到被委派的 Worker 子会话（否则 Worker 的修改类工具会在到达文件系统前被拒，永远无法交付提交）；并要求 Worker 未产出提交时失败原因携带 Worker 自身的报告，以便区分静默空转与自称完成。

## Requirements

### Requirement: 编排器只读守卫不得泄漏到被委派的 Worker

编排器只读守卫 SHALL 只作用于编排器会话。被委派执行任务的 Worker 子会话（会话头 `origin='subagent'`）MUST NOT 被施加该守卫，否则其修改类工具（`bash`/`write`/`edit` 等）会在到达文件系统前被拒绝，Worker 永远无法产出提交。编排器自身（根会话）的只读语义 MUST 保持不变。

#### Scenario: Worker 子会话保留修改类工具且可执行

- **WHEN** 一个 `origin='subagent'` 的 Worker 子会话启动，并携带 `bash`/`write`/`edit` 工具
- **THEN** 这些工具仍在作用域内，且一次 `write` 调用执行成功（不被守卫拒绝）

#### Scenario: 编排器仍被拒绝

- **WHEN** 编排器（根会话）启动并携带 `bash`/`write`/`edit`
- **THEN** 这些工具从作用域移除，且直接调用被拒绝并给出「请通过 pactflow_dispatch_git 或 pactflow_dispatch_k3s」的指引

### Requirement: Worker 未产出提交的失败必须可诊断

当 Worker 以 `completed` 结束、但 Git 侧结算被拒（如未产出提交）时，Host SHALL 在失败原因中折入 Worker 自身的有界 outcome，使「静默空转」与「自称完成」可区分。折入的内容 MUST 仍受输出预算与脱敏约束。

#### Scenario: 失败原因包含 Worker 报告

- **WHEN** Worker 报告完成但未产生提交，结算因此失败
- **THEN** 失败原因为「Git 侧原因 — Worker reported: <Worker 自身报告>」
