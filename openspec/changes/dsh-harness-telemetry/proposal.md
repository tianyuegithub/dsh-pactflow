# dsh-harness-telemetry

## Why

两处「诚实但残缺」的现状，根因相同，且都被一个此前未被利用的事实推翻。

**现状一 —— 能力阶梯有两级永远测不出来。** `src/harness-capabilities.ts` 的可证级别集合是 `connection / protocol / artifact / cancellation`，`tool-invocation` 与 `verification` 被显式排除，注释写明：

> `tool-invocation` needs the Harness runner to report that it invoked a tool, and `verification` needs a dedicated verification stage; both are evidence outside what this repository's probes currently emit.

**现状二 —— 运行预算算不了用量。** `PACTFLOW_DEFAULT_RUN_BUDGET` 只有 `maxAttempts` / 时长 / `maxOutputBytes`，没有 token 或模型调用数。原因同样是「Harness termination document 无 token 字段」。

两处都做了正确的事：不可证就显式标不可证，不虚报。但结论建立在一个**过宽的前提**上——「执行器不归本仓管」。

事实是：**容器内 DSH 执行器的适配插件正是本仓所有物**。项目规则明确：

> 容器内 DSH 执行器可由本仓库维护适配插件与源码补丁，按固定镜像摘要独立分发。

`worker/dsh/release-manifest.json` 就是这件事的证据：`adapterVersion 1.1.0`、协议 `dsh-worker-interactions/v1`、镜像按 digest 钉版。

也就是说，对 `dsh` 这一种 Harness，「让 runner 上报工具调用」「增设专门验证阶段」「回传 token 用量」**全都在本仓可达范围内**。对 `claude` / `codex` / `opencode` 三种第三方 runner 仍然不可达——这部分继续诚实标注，不虚报。

不做的代价：能力阶梯顶部两级对所有 Harness 一律空白，用户无从区分「这个执行器真的能调工具吗」；预算无法按真实消耗设限，`maxOutputBytes` 只能近似代表成本。

## What Changes

- **`dsh` 执行器适配插件新增三项上报**：工具调用发生与计数、专门验证阶段的执行与结果、token 与模型调用数用量。三项随 `adapterVersion` 升级并按镜像 digest 重新钉版。
- **能力可证集合按 Harness 分别声明**：可证级别不再是全局常量，而是每个 Harness 一份。`dsh` 可达 `tool-invocation` 与 `verification`；`claude` / `codex` / `opencode` 的可证集合保持不变。
- **不可证的一律不虚报**：第三方 Harness 的这两级 MUST 继续显式标为不可证，MUST NOT 因为 `dsh` 能测就推断其它 Harness 也能。既有的「未映射阶段名 MUST 被忽略、MUST NOT 被推断为级别」对抗守卫保持有效并扩展到按 Harness 的判定。
- **`verification` 级的独立观测（评审后补定义）**：首版只说「runner 回报可核验结果」，评审指出这与 `artifact` 级（`cli-response`：跑一条命令回结果）没有区分——跑一条验证命令仍然只是跑命令。现定义：`verification` 级的观测是 runner **按验证协议执行一个多步、有序、与已登记验证 Profile 身份绑定的验证任务，并回报逐步结构化报告**（Profile 身份、每步退出码、执行顺序、每步时长），宿主把报告与登记的 Profile 逐项核对。只会跑 shell 命令的 runner 回的是一个输出块，产生不出与 Profile 绑定的逐步有序报告——这就是两级的观测差异。探针以一个临时的、≥2 步且顺序敏感的合成 Profile 触发该观测。
- **可行性先于任务展开（评审后补）**：工具调用上报要在容器内 DSH（当前钉 `0.1.1-rc.2`）的工具执行链上挂钩，token 用量要从该版本的会话里取。**钉版的容器 DSH 有没有可用的钩子接口、有没有暴露用量，方案没查。** 任务 0 是 spike：在现有镜像里各试一次，拿到证据（可行/不可行/需升级容器 DSH 版本）再展开其余任务。spike 结论不可行时，本 change 缩为只做 `verification` 级（它不依赖钩子）。
- **token 用量纳入预算但不伪造**：用量可得时纳入运行预算的呈现与判定；**不可得时 MUST 显式标为「不可得」，MUST NOT 以 0 或任何估算值冒充**。预算的既有三项（attempts / 时长 / 输出字节）保持为单一权威，token 是新增维度而非替代。
- **不扩大安全承诺**：本 change 只增加观测与计量，MUST NOT 改变工具作用域、沙箱声明或 Worker 权限边界。
- **非目标**：不为第三方 Harness 伪造上报；不做跨 Harness 的能力协商；不做成本换算与计费；不改第三方 runner 的镜像。

## Capabilities

### Modified Capabilities

- `harness-capability-levels`：新增「可证级别集合按 Harness 分别声明」与「本仓维护的 dsh 执行器可证 tool-invocation 与 verification」两条 Requirement，并把既有的「不可证级别永不虚报」扩展到按 Harness 的判定。
- `run-budgets`：新增「token 与模型调用数用量在可得时纳入预算、不可得时显式标注」Requirement，钉死「MUST NOT 以 0 或估算值冒充」。

## Impact

- **Worker 运行时**：`packages/dsh-pactflow/worker/dsh/`（runner 上报工具调用与用量、新增验证阶段执行与回报）；镜像重建并按 digest 重新钉版，`release-manifest.json` 的 `adapterVersion` 升级。
- **Host**：`src/harness-capabilities.ts`（可证集合与阶段映射由全局改为按 Harness）、`src/infrastructure-probe.ts`（新增验证阶段）、`src/run-budget.ts`（新增用量维度与「不可得」表达）、`src/k3s-worker.ts`（结果文档解析新增用量与工具调用字段，越限与缺失走既有失败关闭）。
- **Client**：能力级别呈现按 Harness 区分可证与不可证；运行预算呈现新增用量与「不可得」标注。
- **Session Event**：**不新增事件类型、不升生产者版本**——用量与工具调用计数走既有运行结果 payload 的可选结构化字段。
- **Agent / Remote**：只读可见，不新增写工具。
- **架构对应**：§3 终局能力 5（双执行路径）与 §4 不变量「K3s 结果必须绑定精确身份」不放宽；诚实性要求（架构 §7「未运行、被跳过或被环境门控的验证不得计为通过」）在本 change 中体现为「不可得不得冒充」。
- **清单版本漂移不在本 change**：`release-manifest.json` 的 `hostEventProducerVersion` 漂移（`0.5.0` vs 代码 `0.6.0`）首版曾捎带在此修复，评审指出「半小时的修复不该等一个要重建镜像、上真实集群的 change 几周」，已拆为独立小 change `manifest-producer-version-guard`。本 change 升 `adapterVersion` 重新钉版时，MUST 先确认该守卫已在（绿），钉版后清单中该字段由守卫钉住。
- **对其它活跃 change**：本 change 不升生产者版本；若 `need-comment-threads` / `need-attachments` 已先实施，本 change「老会话可写」断言在当前版本号上重跑。
- **验证路径**：真实 K3s + 真实 `dsh` 执行器镜像，按仓库既有纪律**不走 mock**。
