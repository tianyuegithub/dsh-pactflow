# 设计：已保存探针的配置数据源

## 决策：访问器注入，快照仅作回退

`PactFlowService` 在 settings 注册闭包里保存一个**访问器** `savedInfrastructureAccessor = () => scope.get().infrastructure`（settings 后挂载场景下保持 undefined）。新增 `infrastructureForSavedProbe()`：访问器存在且返回有效文档时，即时 `infrastructureFrom(document)` 构造**一次性只读视图**；否则回退 `requireInfrastructure()`（启动快照，现行为）。

- **为什么不是热换 `this.infrastructure`**：那会违反 restart 合同（Worker/池/定时器被换绑，运行中会话的派发行为漂移），且 scope.watch 的日志文案与运维手册都要改。访问器把「读」与「绑定」分开——探针读新、运行时绑旧。
- **为什么 `infrastructureFrom` 幂等廉价**：它已被 validate 闭包在每次保存时调用做校验，纯解析+校验，无副作用；探针每调用构造一次可接受（诊断路径，非热路径）。
- **回退保留**：settings 未挂载（宿主侧单测裸启动）或 legacy `k3s` 模式（infrastructure=false）时回退快照/原样报「未配置」，行为与现状一致。

## 覆盖面（五个无 draft 入口）

| Remote | 性质 | 处理 |
|---|---|---|
| `probeInfrastructure`（无 draft） | 可用性探针 | 访问器 |
| `listImagePullSecrets` | 只读发现 | 访问器（draft 路径不变） |
| `listHarborArtifacts` | 只读发现 | 访问器（draft 路径不变） |
| `listK3sGitSecrets` | 只读发现 | 访问器 |
| `infrastructureDeletionImpact`（无 draft） | 影响评估（只读） | 访问器（draft 路径不变） |

`listInfrastructureHealth` **不改**：健康账本按连接指纹对账，属运行时历史而非配置视图；混入新文档会让「启动后保存、从未探针」的资源呈现空记录，徒增歧义。

## 探针 Job 的边界

已保存 harness 探针会经同一 infrastructure 创建临时探针 Job（K3s 内、`pactflow-probe` 镜像拉取策略）。读当前文档意味着「保存后、重启前」也能对新区发探针 Job——这是显式人触发的诊断动作，与「运行时派发不变」合同不冲突（探针 Job 不进入派发准入、不占用池并发）。文案如实更新即可。

## 文案

- `index.ts` start 阶段：`testing restart-applied settings` → `testing the currently saved settings`。
- `settings-model.ts` 详情映射锚点 `includes('restart-applied')` → `includes('currently saved')`，中文「读取 Host 当前已生效的保存配置」→「读取当前已保存的配置」。

## 测试策略

宿主侧 `saved-probe-freshness.spec.ts`（先红后绿）：

1. 空 infrastructure 启动 → 对不存在的 worker-pool 已保存探针 → `success: false`（现状基线）。
2. `settings.update` 写入含集群/仓库/模板/池的完整文档（**不重启**）→ 同一已保存探针 → `success: true`（start + resource-graph），且 `listWorkerPools()` 仍为 `[]`（钉住只读边界：探针读新、运行时不变）。

worker-pool 探针离线可跑（resource-graph 阶段纯校验），复用既有 `settings.spec.ts` 的草稿探针模式；其余 kind 的在线探针不进单测（需真实集群/网络，与既有测试边界一致）。

客户端日志收敛已由 `settings-probe-log.spec.ts`（3 项）绑定，本变更将其纳入合同描述，不再重复实现。
