# artifact-ref-handoff

## Why

多 agent/worker 之间的大内容（执行计划、报告、日志、诊断）目前只能经有界文本通道传递，而每个通道都有自己的硬上限：宿主 outcome/日志文本 4096 字节（`run-budgets` 的 `maxOutputBytes` 单一权威）、worker bridge 帧 64 KiB（超限直接断连、抛「远程交互内容过长」）、交互载荷 schema 16000 字符、探针日志尾部 32 KiB、K3s 输入 prompt 256 KiB 预检上限，以及模型单轮输出 token 上限（DSH 会话正文，插件不可拦截）。worker 运行时更彻底：`runner.mjs` 只保留末尾 1 MiB 内存环并把最后 32 KiB 写进 pod stdout，而宿主当前**没有任何读取 worker 容器日志的路径**（`probeLog` 只读探针容器）——超过一屏的执行记录实际等于丢弃。

这些"bounded"都是缺少外部内容存储时的妥协：截断破坏一次交付的原子性，"继续"续写浪费且接缝不可靠。测试集群已有稳定运行的 RustFS（S3 兼容对象存储，default ns，89 天）可复用。借此把"大内容不进有界通道"从单点补丁升级为跨边界架构不变量：有界通道只传**结构化地址 + 摘要**，内容本体一律外置。

## What Changes

- 新增**可插拔 artifact store**对接面：接口暴露 `put(content) → artifactRef` 与 `resolve(ref) → content`，外加保留账本必需的列表原语（最小客户端 4 操作：PutObject/GetObject/HeadObject/ListObjectsV2，path-style、手写 SigV4、零新依赖）；第一后端 = 集群现有 RustFS（S3 兼容），后端可整体替换（Gitea artifacts 仓库等）。
- 固定**结构化 artifactRef 地址合同**：`s3://<bucket>/<needId>/<runId>/<seq>-<kind>-<sender>.<ext>` + etag + bytes + sha256 +（后端返回时的）versionId + `kind` + 摘要（≤10 行且 ≤1 KiB）；**零签名**——presigned URL 是凭据等价物，禁止进入 Session Event、对话与日志；key 含随机段、写入后不可变且不可覆写，删除只归保留策略。
- **生产侧强制**：在插件拥有的有界通道上，内容超过该通道阈值必须走外置，通道只发 ref + 限额摘要；模型在会话正文中的直接输出**不属于**插件可拦截通道，不得声称被门禁覆盖（该场景的缓解是指令与工具引导）。
- **门禁**：阈值按通道配置且 MUST ≤ 该通道硬限（结果文档单列 ≤3 KiB 合同预算，避开 kubelet 终止消息 4 KiB 截断）；越限且未外置的内联载荷 MUST 被拒绝，返回显式错误码 `pactflow.artifact.oversize` 与外置指引——约定有门禁兜底，不依赖自觉。
- **消费侧协议**：载荷携带 artifactRef 即承诺结构化；消费者 MUST 先解析（解析仅限本绑定的 bucket，越界拒绝）并校验 bytes/hash 后再继续执行；读不到 / 版本或校验不符一律显式失败，禁止以对话记忆脑补内容。
- **脱敏门**：上传前内容扫描（已知凭据精确匹配 + 通用凭证模式），命中即拒收，扫描器故障同样拒收（fail-closed）；落点为 worker 侧上传路径（`worker/redact.ts` 已有内容级扫描先例），宿主 `redaction.ts` 的窄范围 URL 脱敏按既有合同保持不变。
- **凭据注入**：worker 的 S3 凭据经 K8s Secret 以 env 引用注入容器（非 projected volume、非 ConfigMap 明文），随 pod 生命周期回收；Secret 进创建意图（childNames）、启动对账与清理账本；凭据值不进 Session Log、argv、事件与持久日志。
- **执行日志全量外置**（物尽其用第一落点）：worker 在作业内把全量日志上传，结果文档只回传尾部 + ref；上传失败时宿主读取 worker 容器日志尾部作为**如实标记的降级取证**（上限取运行预算 `maxOutputBytes`，不引入第二套硬编码上限），收口现状"写 stdout 无人读"。
- **保留账本**：对象登记 + 列表对账（覆盖上传成功但结果未回传的孤儿对象），超龄（14d）/超量（512 MiB）标记给人裁决，不静默删、不静默堆（与 `retention-policy.ts` 失败场景同一哲学）。
- **资源化登记**：对象存储登记为可引用资源（架构文档 §3.9 的第七类）：绑定 schema 与 Git provider 同构、统一卡片生命周期、删除被引用资源失败关闭。
- **引用对人类可读**：工作台呈现 ref、摘要与校验状态；宿主提供按 ref 取回内容的显式读取入口，解析仍按绑定进行（Agent 面 MUST NOT 暴露端点参数）。
- **事件落账兼容**：ref 经**现有事件的 payload 可选结构化字段**落账，不新增事件类型、不升生产者版本——payload schema 非 strict，旧读端剥离未知键即可读新日志，老会话升级插件后也不会触发生产者声明冲突；投影如需外显则升 stateVersion。
- **范围纪律**：Git/OpenSpec 仍是代码与行为合同唯一正文 owner；对象存储只承载易逝/大内容，不承载耐久合同；验收证据链（磁盘证据目录 + evidence 门禁）语义不变，不因本 change 外置。

## Capabilities

### New Capabilities

- `artifact-ref-handoff`: 大内容经对象存储以结构化地址在有界通道间传递的完整行为合同——地址合同与零签名规则、按通道的门禁与阈值硬限、消费侧先解析后执行的义务、失败语义、内容脱敏门、worker 凭据注入与回收、对象保留账本与列表对账、后端可插拔与存储的资源化登记、引用的人类可读路径、事件载体兼容。

### Modified Capabilities

（无。`worker-interaction-relay` 的限长、身份绑定、审批/问答语义均不变：交互通道的门禁是**发送前本地拒绝**（worker 侧在构造请求时即知长度），不新增协议帧、不改 `dsh-worker-interactions/v1` 语义；现有 64 KiB 帧上限与 schema 限长继续作为恶意输入的原样兜底。桥与回传载荷新增结构化字段属实现细节，由新能力的合同覆盖。）

## Impact

- **Host**：`src/artifact-store.ts`（新增，最小 S3 客户端 Put/Get/Head/List）、`src/schema.ts`（artifactStore 绑定，与 Git binding 同构）、`src/k3s-worker.ts`（Secret env 注入 + 创建意图/对账/清理账本 + worker 容器日志尾部取证读取）、`src/retention-policy.ts`（对象保留账本 + 列表对账）、`src/host/cleanup.ts`（对象与 Secret 清理责任）、`src/domain.ts`（payload 可选字段 + 投影 stateVersion）、`src/index.ts`（宿主落账）。
- **Worker 运行时**：`packages/dsh-pactflow/worker/dsh/`（runner 全量日志落盘、上传助手）、`src/worker/redact.ts`（内容级脱敏门扩展）、`src/worker/bridge.ts`（发送前越限本地拒绝与指引）；镜像需重建并按摘要重新钉版（`worker/dsh/release-manifest.json`）。
- **Client/Settings**：第七类资源的卡片生命周期（登记/编辑/删除被引用失败关闭）与工作台引用呈现；`src/types.ts` 资源 kind 联合、`settings-model.ts`/`settings-probe.ts`/`resource-cards.tsx`/`locale.ts` 同步。
- **Session Event**：新增携带 artifactRef 的事件 payload 可选字段；事件只存 ref 与摘要，不存内容本体（§4 事实源不变量不变）；旧读端兼容与老会话可写性需有测试。
- **受影响面**：Host / Agent / Client / Remote / Session Event / Worker Provider 全边界——按仓库规则先落合同再分模块实施。
- **文档**：`docs/architecture-目标架构.md` §3.9"六类可引用资源"→七类（用户已裁决同意，2026-09-14）；`docs/development-plan-开发计划.md`（五类/六类枚举与验收矩阵行 9）、`docs/business-logic-业务逻辑.md` §2.1 同步。
- **验证路径**：真实 RustFS + 真实 K3s 验收（Git/存储/Gitea 类验收不走 mock，按仓库既有纪律）；后端能力观测（是否返回 versionId、列表行为）在连通验收中一并记录。
