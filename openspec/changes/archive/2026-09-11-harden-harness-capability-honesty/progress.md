# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试（先失败） | ✅ | 对抗性：把 `verification` 加回 `PACTFLOW_PROBE_STAGE_LEVEL` 后，`harness-capabilities.spec.ts` 的诚实性用例失败（2 failed / 6 passed）——证明「不虚报不可证级别」此前无守护；已还原 |
| 可证集合与映射 | ✅ | `PACTFLOW_HOST_ATTESTABLE_LEVELS`（connection/protocol/artifact/cancellation）、`PACTFLOW_PROBE_STAGE_LEVEL`、`harnessProbeMaxLevel()` |
| 推导合并为一份 | ✅ | `k3s-worker.ts` 删除本地镜像逻辑，`probeAchievedLevel` 委托 `harnessAchievedLevel`（同一映射） |
| 未知阶段不推断 | ✅ | `ignores unknown stage names rather than inferring a level`：含 `tool-invocation`/`verification`/未来名的成功阶段 → 结果仍为 `connection` |
| 级别取最高 | ✅ | `derives the highest reached level ... regardless of order`：cleanup 先于 cli-response 出现仍为 `cancellation`；失败阶段不计 |
| 探针报告级别 | ✅ | `k3s-cleanup.spec.ts` 新增用例：镜像探针 `achievedLevel='cancellation'`、`maxLevel='cancellation'`；API 探针无 `cli-response` 阶段且上报级别 |
| 真实探测路径 | ✅ | `e2e/pactflow-harness-probes.e2e.spec.ts` 增真实级别断言（API 探针阶段不含 `cli-response`）——**未在真实集群运行**（见下） |

## 关键设计决定（诚实性）

- **`tool-invocation` 与 `verification` 均无探针证据**：前者需 Harness runner 上报工具调用（不在本仓所有权内），后者需专门验证阶段（当前无此阶段）。因此二者**不入可证集合**，映射里也没有它们，推导永不返回它们。
- 该「不虚报」此前**只是隐式成立**（缺分支），本 change 变为**显式常量 + 守卫测试**：任何人若为不可证级别补上映射，测试立即失败。
- 上限 `maxLevel` 由 `harnessProbeMaxLevel()`（可证集合最高）给出，而非硬编码字面量，避免上限与集合漂移。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 不可证级别永不虚报 | `never claims tool-invocation or verification ...` + `ignores unknown stage names ...` |
| 级别随成功阶段取最高 | `derives the highest reached level ... regardless of order` |
| 探针上限取自可证集合 | `never claims tool-invocation or verification ...`（`harnessProbeMaxLevel()` 与集合/映射一致性断言） |
| 镜像探针报告级别 | `k3s-cleanup.spec.ts` → `reports the capability level reached by each probe ...` |
| API 探针的级别只由协议与清理证据推导 | 同上用例（断言无 `cli-response` 阶段）+ e2e 真实断言 |

## 已知边界（诚实）

- **未实现为 `tool-invocation`/`verification` 增设探针阶段**：前者需 Harness runner（镜像侧，不在本仓）上报结构化工具调用证据；后者需新增专门验证阶段。二者属新能力，本 change 只保证**不虚报**，未新增证据来源。
- **真实六级实证未做**：`e2e/pactflow-harness-probes.e2e.spec.ts` 的级别断言已加入，但**本 change 未运行真实集群**（此前已在真实集群跑过该套件的旧版本）。
- 级别推导只认「成功阶段」；阶段语义是否为真由各探针的既有实现保证，本 change 未改造探针的观测逻辑。

## 验证

`pnpm run check` 通过：61 个测试文件、511 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
