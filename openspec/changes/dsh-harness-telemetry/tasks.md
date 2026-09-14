# tasks — dsh-harness-telemetry

## 0. 可行性 spike（阻塞，结论决定后续范围）

- [ ] 0.1 **本机不可执行**（需拉取并运行按 digest 钉版的 worker 镜像，且容器内需连模型；本机无集群、无 Harbor 凭据）。在现有 `dsh` 执行器镜像（容器 DSH `0.1.1-rc.2`）内实测：工具执行链是否有可用钩子接口供适配插件上报工具调用。产出：可行 / 不可行 / 需升级容器 DSH。证据记入实施状态
- [ ] 0.2 **本机不可执行**（同 0.1）。同镜像内实测：会话是否暴露 token 与模型调用数用量、字段形态。产出同上
- [ ] 0.3 按 0.1/0.2 结论定范围：两项可行 → 全做；任一不可行 → 该项转「不可得」并缩范围，本 change 只做 `verification` 级（不依赖钩子）；需升级容器 DSH → 停下，升级是独立决策（涉及 `dshVersion` 钉版与远程交互验收重跑），交人裁决
- [ ] 0.4 定义并写下 `verification` 级的合成 Profile：≥2 步、顺序敏感（步 1 写标记、步 2 断言）、探针后不残留。记入实施状态

## 1. 可证集合按 Harness 分裂（宿主侧，先做）

- [ ] 1.1 `src/harness-capabilities.ts`：`PACTFLOW_HOST_ATTESTABLE_LEVELS` 与 `PACTFLOW_PROBE_STAGE_LEVEL` 由全局常量改为**按 Harness 一份**；推导按 Harness 判定。先失败后通过。验证：单测
- [ ] 1.2 **不推断守卫**：`dsh` 可证 `tool-invocation` 不使 `codex` 的推导包含该级别。验证：单测（对抗性）
- [ ] 1.3 既有「未映射阶段名 MUST 被忽略」守卫扩展为按 Harness 分别判定，强度不降低。验证：单测

## 2. dsh 执行器适配插件上报

- [ ] 2.1 `worker/dsh/`：runner 上报工具调用的发生与计数
- [ ] 2.2 `worker/dsh/`：runner 实现验证协议——按登记 Profile 身份执行多步有序验证，回报逐步结构化报告（Profile 身份、每步退出码、实际顺序、每步时长）
- [ ] 2.3 `worker/dsh/`：回传 token 与模型调用数用量；字段缺失时如实留空，不填 0
- [ ] 2.4 `src/k3s-worker.ts`：结果文档解析新增用量与工具调用字段；越限与缺失走既有失败关闭，不静默补默认值。验证：单测

## 3. verification 级的诚实性（关键）

- [ ] 3.1 **往上冒充守卫**：宿主执行了验证但 runner 未回报逐步报告 → `verification` MUST NOT 被声称。先失败后通过——先写一版"宿主跑了就算"的实现证明测试能抓住它。验证：单测
- [ ] 3.2 **往下冒充守卫**：runner 只回报单命令自由格式输出（`cli-response` 形态）→ 至多 `artifact`，不含 `verification`。先失败后通过——先写一版"跑了命令就点亮"的实现证明测试能抓住它。验证：单测
- [ ] 3.3 宿主逐项核对：报告的步数/顺序/每步命令身份与登记 Profile 不符 → 不声称并指名不符项。验证：单测（顺序颠倒、缺步、多步三例）
- [ ] 3.4 第三方 Harness 的 `tool-invocation` 与 `verification` 保持不可证。验证：单测

## 4. 用量纳入预算

- [ ] 4.1 `src/run-budget.ts`：新增用量维度与**一等的「不可得」状态**；不可得 MUST NOT 记为 0、MUST NOT 参与预算判定。先失败后通过。验证：单测
- [ ] 4.2 **既有三项权威不被覆盖**：用量可得时，输出上限仍由 `maxOutputBytes` 单独决定。验证：单测（对抗性守卫）
- [ ] 4.3 Session Event：用量与工具调用计数走既有运行结果 payload 的**可选结构化字段**，不新增事件类型、不升生产者版本。验证：单测断言旧读端解析不失败、既有会话保持可写；若 `need-comment-threads` / `need-attachments` 已先实施，在当前版本号上重跑

## 5. 镜像重建与钉版

- [ ] 5.1 前置：确认 `manifest-producer-version-guard` 已归档、守卫为绿
- [ ] 5.2 镜像重建并按 digest 重新钉版；`adapterVersion` 按既有版本语义升级（倾向 `1.1.0 → 1.2.0`，实施时确认）；清单 `hostEventProducerVersion` 由守卫钉住
- [ ] 5.3 `release-manifest` / `runtime-manifest` 一致性由既有 `pack:check` 继续钉住。验证：`release-artifact.spec.ts`

## 6. 界面

- [ ] 6.1 能力级别呈现按 Harness 区分可证与不可证，不可证显式标注而非留空
- [ ] 6.2 运行预算呈现新增用量；不可得显式标注「不可得」，与「可得且为 0」视觉可区分。验证：client 单测

## 7. 终验

- [ ] 7.1 **真实 K3s + 真实 dsh 执行器镜像**：真实运行中 runner 上报工具调用与逐步验证报告，探针以合成 Profile 推导出 `tool-invocation` 与 `verification`，合成 Profile 探针后零残留；真实 token 用量回传并呈现。**无 mock 冒充**
- [ ] 7.2 真实对照：同一集群上以第三方 Harness 运行，断言两级仍标不可证、用量标不可得
- [ ] 7.3 回归：`pnpm run check` 全绿、`pnpm run pack:check`、`openspec validate --all --strict` 全绿
- [ ] 7.4 文档同步：`docs/CURRENT_STATUS-当前状态.md` 的 A10/A11 诚实清单相应条目更新；实施状态记录镜像 digest、`adapterVersion` 与真实验收证据
