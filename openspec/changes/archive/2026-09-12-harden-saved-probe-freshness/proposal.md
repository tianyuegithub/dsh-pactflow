# 已保存资源探针必须读取当前已保存配置（修复内层/外层测试反复分歧）

## Why

三类基础设施资源（K3s 集群、Harbor、Gitea）在真实部署中**反复**出现同一故障形态：卡片内「测试」（草稿路径）通过，卡片外「可用性测试」（已保存路径）失败。根因是同一个类缺陷：宿主侧 `probeInfrastructure` 及只读发现 Remote 在无 draft 时读取 `requireInfrastructure()`——**宿主启动时冻结的配置快照**。凡「保存动作发生在宿主启动之后」的资源，外层探针一律读到「资源不存在」，无论真实连通性如何。运营者被迫「保存→重启→再测」三步走，且失败信息不指名真实原因（已实际误导排障三次）。

`applies: 'restart'` 合同的真实意图是**运行时资源**（Worker 池、K3s client、派发准入、定时器）不在 Profile 运行中被换绑——探针是显式触发的只读诊断，不持有任何运行态，不应被该合同约束。本变更把「探针/发现/删除影响读取当前已保存文档」与「运行时资源重启生效」明确分离，一次消灭该类分歧。

同族缺陷一并收口：外层（已保存）探针成功路径曾永久保留测试日志的「进行中」标记（无后续异步步骤收敛它），当日已修复并有回归测试，但无合同绑定——本变更将其写入同一能力合同，防止回归。

## What Changes

- **探针数据源**：`probeInfrastructure`（无 draft）、`listImagePullSecrets`、`listHarborArtifacts`、`listK3sGitSecrets`、`infrastructureDeletionImpact`（无 draft）SHALL 读取**当前已持久化的 infrastructure 设置文档**（探针时刻即时构造只读视图），不再读取启动快照。
- **只读边界不变**：以上路径 SHALL NOT 重建/换绑任何运行时资源（Worker、池、K3s client、定时器仍由 restart 合同管辖）——运行中的派发行为在重启前保持不变。
- **日志收敛合同**：每次可用性探针调用 SHALL 使测试日志头部收敛到终态（成功/失败），「进行中」标记 MUST NOT 在探针结果与其后续发现步骤均落定后残留。
- **文案如实**：已保存探针的起始阶段说明由「测试重启后生效的配置」改为「测试当前已保存的配置」；运维手册 §3 同步更新生效时机说明（探针/发现/删除影响即时读已保存配置；运行时资源重启生效）。

## Capabilities

### New Capabilities

- `infrastructure-probe-freshness`：已保存资源的可用性探针、只读发现与删除影响评估 SHALL 读取当前已保存的配置文档（而非启动快照）；这些路径保持只读、不重建运行时资源；探针测试日志必须收敛到终态。

### Modified Capabilities

（无。）

## Impact

- **Host**：`index.ts` 新增已保存文档访问器（settings scope 挂载时注入）；上述五个 Remote 的无 draft 路径改用访问器；起始阶段文案更新。
- **客户端**：`settings-probe.ts` 已保存探针成功路径收敛 running 标记（已实现，本变更补合同）；`settings-model.ts` 阶段详情映射同步新文案。
- **测试**：新增宿主侧「保存后即可测」全链测试（先红后绿）；既有 worker-pool 探针测试与客户端日志收敛测试保持全绿。
- **文档**：`docs/installation-operations-安装运维.md` §3 生效时机说明。
- **不做**：不改 `applies: 'restart'` 对运行时资源的合同；不给运行中 Profile 增加 Worker 热换绑；`listInfrastructureHealth` 的快照语义保持（健康账本按指纹对账，与探针分流）。
