## Why

真实 K3s 批处理的 `ttlStage` 与 `zeroProofStage` 是**B 类**操作：它们会创建/查询真实集群资源。两函数各有一道「未武装即拒绝」的守卫（要求 `PACTFLOW_K3S_TTL_PROBE=1` / `PACTFLOW_K3S_ZERO_PROOF=1`，且必须精确为 `1`），但此前**没有任何测试**。

这道守卫是「防止未授权触碰真实环境」的唯一闸门。若它被误删或改宽，后果不是报错，而是**直接操作真实集群**——本会话已多次证明「门禁自身逻辑无人验证」会致害（`verify-profile` 从未运行、`check:release` 结构上不可满足）。

## What Changes

- 新增 `tests/k3s-batch-stage-guards.spec.ts`（2 项）：两 stage 在**未武装**时失败关闭并给出「B-class operation」拒绝语；并断言只有精确的 `1` 才算武装（`0`/`true` 均不武装）。
- 未改动两个 stage 的行为。

## Capabilities

### New Capabilities
- `b-class-stage-arm-guard`: 变更型（B 类）批处理阶段必须在未显式武装时失败关闭，且「已武装」只认精确的 `1`；该守卫必须被测试覆盖，以免误删导致未授权触碰真实环境。

### Modified Capabilities
（无。）

## Impact

- **测试**：新增 `tests/k3s-batch-stage-guards.spec.ts`（`pnpm run check` 67 文件 / 534 → 68 文件 / 536）。
- **兼容**：纯新增测试；stage 行为与拒绝语不变。
- **证据**：对抗性验证时**实际观察到**守卫被移除后 stage 直接访问真实集群（用例耗时 64s），证明该守卫就是唯一闸门；该次运行由其 `finally` 自行清理（已核对 `ttl-probe` 无残留）。
