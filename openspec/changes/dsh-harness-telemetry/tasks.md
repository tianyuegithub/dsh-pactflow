# tasks — dsh-harness-telemetry

## 0. 可行性 spike（阻塞，结论决定后续范围）

- [ ] 0.1 **本机不可执行**（需拉取并运行按 digest 钉版的 worker 镜像，且容器内需连模型；本机无集群、无 Harbor 凭据）。在现有 `dsh` 执行器镜像（容器 DSH `0.1.1-rc.2`）内实测：工具执行链是否有可用钩子接口供适配插件上报工具调用。产出：可行 / 不可行 / 需升级容器 DSH。证据记入实施状态
- [ ] 0.2 **本机不可执行**（同 0.1）。同镜像内实测：会话是否暴露 token 与模型调用数用量、字段形态。产出同上
- [ ] 0.3 按 0.1/0.2 结论定范围：两项可行 → 全做；任一不可行 → 该项转「不可得」并缩范围，本 change 只做 `verification` 级（不依赖钩子）；需升级容器 DSH → 停下，升级是独立决策（涉及 `dshVersion` 钉版与远程交互验收重跑），交人裁决
- [x] 0.4 `PACTFLOW_VERIFICATION_PROBE_PROFILE`（`src/harness-verification.ts`）：两步，步 1 写标记、步 2 断言并删除。**顺序敏感是刻意的**——步骤可交换的 Profile 无法区分「按序执行了」与「执行过了」，而那正是这次观测唯一要证明的事。标记落在 `/tmp` 而非任务工作树（写工作树会表现为 Worker 改动），末步删除故探针后零残留。守卫逐条断言这四点。验证：`harness-verification.spec.ts`

## 1. 可证集合按 Harness 分裂（宿主侧，先做）

- [x] 1.1 `src/harness-capabilities.ts`：两个全局常量改为按 Harness 一份的 `HarnessAttestation`，经 `hostAttestableLevels(harness)` / `probeStageLevels(harness)` 读取；`harnessAchievedLevel` 与 `harnessProbeMaxLevel` 都改为按 Harness 判定，`k3s-worker` 三个探针调用点传入 `template.harness`。**今天四个 Harness 的取值完全相同**——本任务交付的是形状与守卫，不是差异；`dsh` 的两级要等它的执行器真的上报（任务 2）。验证：`harness-capability-split.spec.ts`
- [x] 1.2 **不推断守卫**：对抗用例直接构造「给 `dsh` 授予 `tool-invocation` 后观测 `codex`」这一场景，断言凡自身可证集合不含该级别的 Harness 一律推导为 `connection`。这条守卫必须**先于**任何一个 Harness 获得新级别而存在——之后就再没有可写测试的失败态了。验证：同上
- [x] 1.3 既有「未映射阶段名 MUST 被忽略」守卫改写为 `it.each` 逐 Harness 判定，并把「永不虚报 tool-invocation / verification」一并改为逐 Harness——强度不降低，且 `dsh` 将来获得该级别时，这个循环正是强制它「只为 dsh 声明」的那道摩擦。验证：`harness-capabilities.spec.ts`（逐 Harness 版）

## 2. dsh 执行器适配插件上报

- [ ] 2.1 `worker/dsh/`：runner 上报工具调用的发生与计数
- [x] 2.2 `worker/dsh/verification.mjs`：runner 侧验证协议。**本条不依赖第 0 节的 spike**——它不需要 DSH 的工具执行钩子，只需要执行已登记 Profile 并如实回报，因此可以先做。

  两处诱惑被刻意拒绝，因为宿主的核对分辨不出、会照单声称：
  - **前一步失败也要把后面每一步跑完并回报**，不得截断后标成「未到达」。Profile 天生顺序敏感（步二能过是因为步一跑过），截断的报告与顺序错乱的报告对核对而言是同一种证据。
  - **回报本进程真正 spawn 的命令**，而不是 Profile 声明的那些。二者只在一切正常时相同，而要紧的正是出了问题那次。

  spawn 失败（127）与超时（124）都给退出码而非省略该步——省略会让宿主去核对一个从未结束的步骤。Profile 畸形或未挂载时整体返回 undefined（宿主据此至多声称 `artifact`），而不是部分honour一个没人登记过的身份。

  runner 接线为 best-effort：失败只写一行 stderr，绝不改变本次运行结果。`verification.mjs` 已入 Dockerfile 与 `check-package` 必需产物清单（26 项）。

  验证：`worker-verification-protocol.spec.ts`（13 例）。**两侧在同一个文件里对接**——runner 产出的报告交给宿主的 `reconcileVerificationReport` 真实判定，因为合同是二者之间的约定，各自单独都可能自洽地错。
- [ ] 2.3 `worker/dsh/`：回传 token 与模型调用数用量；字段缺失时如实留空，不填 0
- [x] 2.4 `parseResultUsage` / `parseResultToolInvocations`：用量与工具调用是结果文档上的**可选**字段。缺失（第三方 Harness 今天的文档，合法）与畸形（负数、小数、字符串、半填、非对象）经两条不同路径落到同一个答案——不可得，且**任何一条都不产出数字**。补默认值会把没人测量过的数字写进持久记录，正是这个维度存在的理由所否定的。测得的 0 仍与「不告诉我们」可区分。越限仍走既有的 `assertWithinChannelLimit` 失败关闭。验证：`k3s-result-usage.spec.ts`（14 例）

## 3. verification 级的诚实性（关键）

- [x] 3.1 **往上冒充守卫**：`attestedLevelFromReport` 在无报告或空报告时返回 `artifact`。宿主本来就在每次交付上执行登记的验证命令，据此点亮 `verification` 是把一方的能力算到另一方头上——这个级别描述的是 **Harness** 能被要求做什么。**canary 实证**：把实现改成「宿主跑了就算」（无条件返回 `verification`）后，该用例与 3.2 的用例同时转红。验证：`harness-verification.spec.ts`
- [x] 3.2 **往下冒充守卫**：单条自由格式命令结果至多 `artifact`。每个 runner 本来就产出 CLI 输出，那正是 `artifact` 的定义；接受它会让这一级与下一级无从区分。**canary 同上实证**：同一次改动使该用例转红。验证：同上
- [x] 3.3 `reconcileVerificationReport` 逐项核对 Profile 身份、修订、步数、按位置的每步命令身份与每步退出码，**收集全部不符项而非止于第一条**——运维读到「未通过核对」什么也学不到，读到「步 2 命令身份不符、步 3 退出 1」才可行动。顺序颠倒 / 缺步 / 多步三例齐备，另加身份不符、修订不符、步失败、多重不符。**canary 实证**：去掉按位置的步身份比对后，「顺序颠倒」用例转红。验证：同上
- [x] 3.4 第三方 Harness 的 `tool-invocation` 与 `verification` 保持不可证。**由任务 1 的逐 Harness 守卫覆盖**：`harness-capabilities.spec.ts` 的「永不虚报」用例已改为 `it.each` 逐 Harness 断言四者的可证集合与阶段映射都不含这两级。`dsh` 将来获得它们时，该循环强制那次授予只对 `dsh` 声明。验证：`harness-capabilities.spec.ts`

## 4. 用量纳入预算

- [x] 4.1 `src/run-budget.ts`：新增 `PactFlowRunUsage`（`available` 判别联合）、`parseRunUsage`、`PactFlowUsageBudget` 与 `evaluateUsageBudget`。不可得是独立状态而非 0——真实的零仍与「该 Harness 不告诉我们」可区分；部分回报、负数、小数、字符串一律判为不可得而非强制转换（强转会制造一个没人测量过的数字，与把缺失记成 0 是同一缺陷的另一条路径）。判定结果带 `judged`，使「在预算内」与「根本没判」不再是同一个值。验证：`run-usage-budget.spec.ts`（17 例）
- [x] 4.2 **既有三项权威不被覆盖**：对抗用例在用量为极大值时断言 `boundOutputToBudget` 与 `evaluateAttemptBudget` 的结论逐字不变；另断言默认预算**不含**任何用量上限字段——一个默认上限会让每一个既有运行都被一个没人选过的数字评判。验证：同上
- [x] 4.3 用量走既有运行结果 payload 的可选结构化字段。守卫直接扫 `src/domain.ts`：任一版本词汇表中不得出现提及 usage/token/modelCalls/toolInvocation 的事件类型，且 `PACTFLOW_EVENT_PRODUCER_VERSION` 仍为 `0.7.0`。这比「断言既有会话可写」更强——**没有新增事件类型，写冻结就无从发生**。旧读端解析不失败亦有用例。`need-comment-threads` 已归档，当前版本号即 `0.7.0`。验证：同上

## 5. 镜像重建与钉版

- [x] 5.1 前置已满足：`manifest-producer-version-guard` 已归档为 `archive/2026-09-15-manifest-producer-version-guard`；守卫 `release-manifest-accuracy.spec.ts` 与 `release-artifact.spec.ts` 共 17 例全绿
- [ ] 5.2 镜像重建并按 digest 重新钉版；`adapterVersion` 按既有版本语义升级（倾向 `1.1.0 → 1.2.0`，实施时确认）；清单 `hostEventProducerVersion` 由守卫钉住
- [ ] 5.3 `release-manifest` / `runtime-manifest` 一致性由既有 `pack:check` 继续钉住。验证：`release-artifact.spec.ts`

## 6. 界面

> **6.1 已做，6.2 等第 2 节（2026-09-15 修正）**。我最初把两条一并推迟，理由是「呈现
> 的都是 runner 上报的数据」——**这对 6.1 不成立**：可证/不可证是**宿主侧的声明**，任务 1
> 完成后它今天就完整且真实，与 runner 是否上报无关。6.2 才真的依赖用量数据。
>
> 6.2 仍等第 2 节：现在建出来只会满屏「不可得」，且它该长什么样取决于第 2 节最终回报
> 的字段形态。
>
> 宿主侧的数据基础已就位且可查：`hostAttestableLevels(harness)` / `probeStageLevels(harness)`
> 给出按 Harness 的可证与不可证集合（任务 1），`parseResultUsage` /
> `parseResultToolInvocations` 给出用量与工具调用的「可得 / 不可得」判别（任务 2.4），
> `evaluateUsageBudget` 的 `judged` 使「在预算内」与「根本没判」不再是同一个值（任务 4.1）。
> 呈现层接线时无需再做判别逻辑。

- [x] 6.1 `src/client/harness-capability-view.tsx`：按 Harness 分别呈现，**两个列表都显示**——可证的与不可证的。

  不可证必须被**指名**而不是省略：省略读起来像是对该 Harness 的判断（「它做不到」），而宿主真正知道的要窄得多（「本仓探针没有证据」）。对本仓不编写其 runner 的第三方执行器，这是两回事，而只有后一句是我们有资格说的。界面为此写了一行明话：「不等于该 Harness 做不到」。

  数据由已登记模板**派生**而非另取一次——第二个来源会让面板为列表里已经没有的模板显示结论。客户端**重述**了阶梯与可证集合而不是 import：`harness-capabilities.ts` 在宿主工程里，import 会把整个宿主面拖进客户端包。重述只在「漂移时有东西会红」的前提下才安全，因此配了逐 Harness 的对齐守卫。

  验证：`harness-capability-presentation.spec.ts`（11 例，含真实渲染与对齐守卫）
- [ ] 6.2 运行预算呈现新增用量；不可得显式标注「不可得」，与「可得且为 0」视觉可区分。验证：client 单测

## 7. 终验

- [ ] 7.1 **真实 K3s + 真实 dsh 执行器镜像**：真实运行中 runner 上报工具调用与逐步验证报告，探针以合成 Profile 推导出 `tool-invocation` 与 `verification`，合成 Profile 探针后零残留；真实 token 用量回传并呈现。**无 mock 冒充**
- [ ] 7.2 真实对照：同一集群上以第三方 Harness 运行，断言两级仍标不可证、用量标不可得
- [ ] 7.3 回归：`pnpm run check` 全绿、`pnpm run pack:check`、`openspec validate --all --strict` 全绿
- [ ] 7.4 文档同步：`docs/CURRENT_STATUS-当前状态.md` 的 A10/A11 诚实清单相应条目更新；实施状态记录镜像 digest、`adapterVersion` 与真实验收证据
