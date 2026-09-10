# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 覆盖缺口 | ✅ | `grep -rn zeroProofStage packages/dsh-pactflow/tests/` 为空；`ttlStage` 同 |
| 可离线验证 | ✅ | 未设环境变量时，`ttlStage()` / `zeroProofStage()` 在接触集群前即抛 `… is a B-class operation; set PACTFLOW_…` |
| 测试 | ✅ | `k3s-batch-stage-guards.spec.ts` 2 项：空 / `0` / `true` 均拒绝（只有精确 `1` 武装） |
| 对抗性验证 | ✅ | 将 `ttlStage` 守卫短路为 `&& false` → 用例失败，且**该 stage 直接访问真实集群**（用例耗时 **64376ms**，非毫秒级），这是「守卫即唯一闸门」的直接证据；已还原 |
| 意外运行清理 | ✅ | 上述访问由其 `finally` 清理；核对 `kubectl -n pactflow get jobs,pods` 无 `ttl-probe` 残留 |
| 验证 | ✅ | `pnpm run check` 68 文件 / **536** 测试 |

## 为什么这是有价值的守卫

本会话已两次因「门禁自身逻辑无人验证」致害。此处守卫的作用是**阻止未授权触碰真实环境**——它坏掉的后果不是报错，而是**直接操作生产集群**。对抗性验证给了这条结论最强的证据形式：移除守卫后确实发生了真实集群访问（64 秒耗时），而非假想。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 未设置时不运行 | `ttlStage refuses to run without its explicit arm` / `zeroProofStage …`（空值） |
| 非 1 的值不视为武装 | 同上（`0` / `true`） |
| 守卫被删除时测试失败 | 对抗性验证（移除后用例失败且真实访问集群） |

## 已知边界（诚实）

- 仅覆盖两 stage 的**守卫**；其武装后的真实行为由 B 类验收（`test:real-k3s-batch`，本会话已实跑通过）覆盖，不属离线测试。
- 对抗性验证期间**确实访问了真实集群**（创建探针 Job 并被清理）。该次运行是验证所需，未留残留；已明确记录而非隐去。
- `run-real-k3s-batch.mjs` 的 `main()`/`enforceImpactListGate()` 仍需真实集群才走到，未纳入离线断言。

## 验证

`pnpm run check` 通过：68 个测试文件、536 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
