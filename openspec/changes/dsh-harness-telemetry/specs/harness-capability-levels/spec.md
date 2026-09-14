## ADDED Requirements

### Requirement: 可证级别集合必须按 Harness 分别声明

插件 SHALL 为每个受支持的 Harness 分别声明其可由观测证据证明的能力级别集合与「成功阶段 → 级别」映射，MUST NOT 使用单一全局集合覆盖全部 Harness。某个 Harness 可证的级别 MUST NOT 被推断到其它 Harness。

既有的「未映射阶段名 MUST 被忽略、MUST NOT 被推断为级别」守卫 SHALL 继续有效，并 MUST 按 Harness 分别判定。

#### Scenario: 一个 Harness 可证不推断其它 Harness

- **WHEN** `dsh` 的可证集合包含 `tool-invocation`，而以 `codex` 的观测推导级别
- **THEN** `codex` 的 `tool-invocation` 仍为不可证，其推导结果不含该级别

#### Scenario: 未映射阶段名按 Harness 分别忽略

- **WHEN** 某 Harness 的观测含不在**该 Harness**阶段映射中的成功阶段名
- **THEN** 该阶段被忽略，MUST NOT 被推断为任何级别

### Requirement: verification 级必须有区别于 artifact 级的独立观测

`verification` 级的观测 SHALL 定义为：runner 按验证协议执行一个**多步、顺序敏感、与已登记验证 Profile 身份绑定**的验证任务，并回报**逐步结构化报告**——至少含 Profile 身份、每步退出码、实际执行顺序、每步时长。宿主 MUST 把报告与登记的 Profile 逐项核对（步数、顺序、每步命令身份），核对不符 MUST NOT 声称该级别。

单一命令的自由格式输出（`cli-response`）MUST 只证明 `artifact` 级；不带 Profile 身份或不逐步的报告 MUST NOT 被当作 `verification` 观测。探针 SHALL 以临时的、至少两步且顺序敏感的合成 Profile 触发该观测，探针结束后合成 Profile MUST 不残留。

#### Scenario: 逐步有序报告证明 verification 级

- **WHEN** runner 对一个两步顺序敏感的合成 Profile 回报了逐步报告，且步数、顺序、每步命令身份与登记一致
- **THEN** 推导结果包含 `verification`

#### Scenario: 单命令输出只证明 artifact 级

- **WHEN** runner 只回报了一条命令的自由格式输出，没有 Profile 身份与逐步结构
- **THEN** 推导结果至多为 `artifact`，不含 `verification`

#### Scenario: 报告与 Profile 不符时不声称

- **WHEN** runner 回报的步数或顺序与登记的合成 Profile 不一致
- **THEN** `verification` 级不被声称，且不符项被指名记录

### Requirement: 本仓维护的 dsh 执行器必须可证工具调用与验证

`dsh` Harness 的适配插件由本仓维护并按镜像 digest 分发，因此 SHALL 上报工具调用的发生与计数，并 SHALL 按上述验证协议执行并回报。`dsh` 的可证级别集合 SHALL 因此包含 `tool-invocation` 与 `verification`。

`verification` 级的判定 MUST 以 **runner 确实按协议执行并回报了逐步报告**为准，MUST NOT 以「宿主自己执行了验证命令」冒充——宿主自身的能力不得被记为 Harness 的能力。

#### Scenario: dsh 上报工具调用后可证该级别

- **WHEN** `dsh` 执行器在运行中上报了工具调用计数，探针据此推导级别
- **THEN** 推导结果包含 `tool-invocation`

#### Scenario: 宿主执行验证不构成 Harness 的 verification 级

- **WHEN** 宿主自行执行了验证命令，但 runner 未回报逐步报告
- **THEN** 该 Harness 的 `verification` 级 MUST NOT 被声称

#### Scenario: 第三方 Harness 的两级保持不可证

- **WHEN** 推导 `claude`、`codex` 或 `opencode` 的能力级别
- **THEN** `tool-invocation` 与 `verification` 不出现在其可证集合与推导结果中
