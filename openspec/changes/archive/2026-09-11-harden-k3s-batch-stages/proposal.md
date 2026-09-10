## Why

GPT 评审 R04 指出：`scripts/run-real-k3s-batch.mjs` 的 `ttlStage`/`zeroProofStage` 只是 `throw new Error('not implemented')` 占位（显式失败是优点，但脚本无法完成它声称组织的整批收尾）。且即使补 happy path 也不够——TTL 与主动清理必须分开证明，手工删除不能冒充 TTL 生效。

## What Changes

- 新增纯模块 `scripts/k3s-batch-stages.mjs`：
  - `buildTtlProbeJob(...)`：构造仅用于证明 ttl-after-finished 的短 TTL 探针 Job（`restartPolicy: Never`、`backoffLimit: 0`、`ttlSecondsAfterFinished`）。
  - `evaluateTtlRecycle({ exists, finished })`：只有「Job 已完成且随后消失」才算回收；未完成不能算（TTL 从完成/失败起算）。
  - `evaluateZeroProof({ tracked, present, unexplained })`：仅当**每个被追踪的资源都按 UID 确认不存在**且无未解释残留才算归零；同名不同 UID 视为「替代对象」单列（我们的责任已消失）。
- `run-real-k3s-batch.mjs` 的 `ttlStage`/`zeroProofStage` 改为**真实实现**：TTL 阶段 apply 探针 Job、等完成、轮询观察回收、无论结果都清理探针；归零阶段按 UID 核对追踪资源并输出结构化 ZeroProof。两者在未显式武装（`PACTFLOW_K3S_TTL_PROBE=1` / `PACTFLOW_K3S_ZERO_PROOF=1`）时**失败关闭**，不假装已验证。

## Capabilities

### New Capabilities
- `k3s-batch-finalization`: 真实 K3s 批次收尾必须把 TTL 回收与主动清理分开证明：TTL 只在「Job 完成且随后消失」时成立；归零只在「每个被追踪资源按 UID 确认不存在且无未解释残留」时成立；未武装的批处理阶段必须失败关闭，不得静默通过。

### Modified Capabilities
（无。）

## Impact

- **脚本**：新增 `scripts/k3s-batch-stages.mjs`；`scripts/run-real-k3s-batch.mjs` 两个 stage 由占位改为实现。
- **测试**：新增 `tests/k3s-batch-stages.spec.ts`（5 项纯判定，含 UID 替换与未完成不可回收）。
- **运行边界**：驱动真实集群属 B 类，未运行；判定逻辑已单测且未武装时失败关闭。
