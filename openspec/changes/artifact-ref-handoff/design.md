# design — artifact-ref-handoff

## Context

现状与约束（动机见 proposal.md）：

- **有界通道与其硬限（代码事实，2026-09-14 复核）**：`run-budget.ts` `maxOutputBytes` 默认 4096 是宿主 outcome/日志的单一权威上限；bridge 帧 64 KiB（`MAX_BRIDGE_LINE`，超限 `socket.destroy()`、`ask()` 抛「远程交互内容过长」）；交互 schema 字段限长 16000 字符；`probeLog` 只读探针容器（`container: 'probe'`、`limitBytes: 32_768`、`tailLines: 200`），调用点全在探针路径；K3s 输入 prompt 预检 262144 字节。
- **worker 结果通道是终止消息文档**（`dsh_pactflow_k3s_result/v1` 写 `/dev/termination-log`，宿主按 specDigest/runNonceHash 精确比对）；kubelet 对终止消息有 4 KiB 上限（书面事实，本集群未实测）——该通道不是大内容载体，门禁阈值必须显著低于 32 KiB 默认值。
- **worker 日志现状**：`runner.mjs` 保留输出到内存环 1 MiB，最后 32 KiB 写 stdout；宿主无任何读取 worker 容器日志的路径，超出部分当前等于丢弃。
- **事件词汇机制**：producer 版本 + `eventTypes` 必须严格升版且为超集（[index.ts:432](../../../packages/dsh-pactflow/src/index.ts)），老会话在升级插件后写入会要求声明升级通道（上游 change 已实现，依赖见下）；`domain.ts` 的 payload schema 用非 strict `z.object`，旧读端会剥离未知键。
- **复用的集群事实（已验证）**：RustFS 运行于 default ns，S3 API ClusterIP `10.43.146.89:9000`、NodePort 32571，数据在 50Gi PVC（local-path）；镜像 `:latest`、单 root 凭据、plain HTTP。
- **宿主无 HTTP 服务面**：插件从不 listen；宿主 dashboard 绑 127.0.0.1:3080，上游拒绝放宽绑定（RCE/单 token 立场）。
- **worker 无宿主凭据**：Pods receive no API token、不写 Session Event；但 K8s Secret 注入与回收机制现成（`PactFlowK3sRuntimeSecrets`、run 创建意图的 `childNames`、children 账本、GC backstop）。
- **可复用的既有模式**：绑定 schema（`pactFlowWorkspaceGitSchema` 同构）、零凭据地址先例（`credentialFreeCloneUrl`）、保留账本（`retention-policy.ts` 标记不删）、资源删除被引用失败关闭（§3.9 资源化）、worker 侧内容级脱敏（`worker/redact.ts`）。

## Goals / Non-Goals

**Goals:**

- "有界通道 + 大内容外置"成为跨边界不变量：插件可强制的通道内只有 ref + 摘要，门禁强制，消费者先解析后执行。
- 后端可插拔：协议层只见 `put/resolve/list` 原语与地址合同；第一后端 RustFS。
- 全链 fail-closed：put 未确认不发址、解析失败不脑补、脱敏拒收、回收失败保留清理责任。

**Non-Goals:**

- RustFS 部署卫生（版本钉死、TLS、IAM 收敛、冗余备份）——归运维；本 change 只消费其 S3 接口。
- 耐久合同迁移——代码与行为合同的正文 owner 仍是 Git/OpenSpec，对象存储只接易逝/大内容。
- 让 worker 直接写 Session Log（§5 永久非目标）；presigned URL 通道（红线）。
- 拦截模型在会话正文中的直接输出——插件没有该通道的执行点，本 change 不声称覆盖（proposal Why 已区分）。
- 验收证据链外置（`PACTFLOW_ACCEPTANCE_EVIDENCE_DIR` 与 evidence 门禁语义不变）。
- 失败场景保留（`local-failure-retention`）与 Gitea/Harbor 现有资源的任何改动。

## Decisions

**D1：worker/宿主直连 S3，宿主不做内容代理。**
宿主 3080 是本地单 token 面，为其新增上传端点要么开 127.0.0.1 之外的绑定（撞上游立场），要么给 pod 发宿主凭据（新凭据面）。pod→ClusterIP 集群内原生可达，直连使大内容完全绕开宿主进程内存与文本通道。备选"宿主代理上传"被否。

**D2：手写最小 SigV4 客户端，不引 aws-sdk；操作集 4 个。**
PutObject / GetObject / HeadObject / **ListObjectsV2**——列表不是可选项：保留账本的前缀统计与"上传成功但结果未回传"的孤儿对象对账只能靠枚举发现（宿主自记账本无法覆盖后者）。签名风格对齐 `gitea.ts` 手写 fetch 的零依赖路线；备选 `@aws-sdk/client-s3`（依赖重、tree 大）被否。

**D3：地址字段固定名 `artifactRef`，结构化、强类型。**
字段：`uri(s3://bucket/key)`、`etag`、`bytes`、`hash(sha256)`、`kind`、`summary(≤10 行且 ≤1 KiB)`、可选 `versionId`（后端返回时有则必存）。协议规则：载荷出现 `artifactRef` 即承诺结构化 JSON；消费者见 ref 必先解析再执行；`uri` 只作不可变标识，解析只允许本绑定 bucket（越界即拒绝——不把 ref 当通用地址能力，避免宿主成为 SSRF 面）。备选"自由文本 `file_path` 约定"被否——弱合同无法门禁。

**D4：门禁阈值按通道配置，且 MUST ≤ 通道硬限；结果通道单列小预算。**
阈值进入验证配置/绑定 schema，不做全局单值。各通道与其硬限的关系：结果文档通道合同预算 ≤ 3 KiB（硬限 = kubelet 终止消息 4 KiB，留出 JSON 其余字段余量）；bridge 帧 64 KiB 硬限，默认阈值 32 KiB；事件 payload 与交互字段按 schema 限长取更小值。越限拒绝码统一 `pactflow.artifact.oversize`。备选"全局一刀切阈值"被否。

**D5：存储登记为第七类可引用资源（用户已裁决，2026-09-14）。**
绑定 schema 与 Git provider 同构（endpoint/bucket/credentialRef/pathStyle）；删除被引用失败关闭复用现有资源删除卫队；改动面按代码实际枚举：`types.ts` 的 `PactFlowInfrastructureResourceKind`、`settings-model.ts`/`settings-probe.ts`/`resource-cards.tsx`/`locale.ts`，以及架构文档 §3.9、开发计划（五类/六类两处）、业务逻辑 §2.1 的同步。

**D6：凭据经 bound Secret 以 env 引用注入，随 pod 回收。**
宿主创建执行 Job 时渲染 Secret（复用 `PactFlowK3sRuntimeSecrets` children 账本与 GC backstop），容器以 `env` + `secretKeyRef` 引用（与现有 model/input/git Secret 同机制，非 projected volume）；Secret 名 MUST 进入 run 创建意图（`childNames`）与启动对账、清理账本（`k3s-resource-identity` 对任何 K8s 资源适用）；凭据值不进 ConfigMap/事件/argv。第一版使用环境现状凭据（单 root key），IAM 收敛列开放问题。

**D7：ref 通知走现有回传载荷新增结构化字段，宿主落账；不新增事件类型。**
worker 结果文档与桥载荷新增 `artifactRef` 字段；Session Event 由宿主写入且只含 ref + 摘要。**事件载体选择**：复用现有事件类型的 payload 可选字段（经 `z.object` 非 strict 校验，旧读端剥离未知键），不新增事件类型、不升 producer 版本——避免老会话升级插件后的生产者声明冲突，也避免 ops 文档词汇计数门禁（`ops-doc-event-count.spec.ts`）连锁。投影如需外显 ref 则升对应 `stateVersion`（与既有 stateVersion 递增惯例一致）。备选"新增 `pactflow/artifact-*` 事件 + 升 0.6.0 词汇"被否：代价（声明升级链 + 文档计数 + 兼容矩阵）大于收益。备选"ref 走交互中继"被否——中继合同是审批/问答专用，不混职责。

**D8：执行日志外置由 worker 侧在作业内完成；降级取 worker 容器日志尾部，不是 `probeLog`。**
作业结束时 worker 将全量日志落盘并 `put` 上传，结果文档回传尾部 + ref。上传失败时宿主读取 **worker 容器**日志尾部作为如实标记的降级取证：`probeLog` 现有实现只读探针容器，MUST 泛化（容器名与上限参数化）或新增等价读取路径；降级上限取运行预算 `maxOutputBytes`（遵守 `run-budgets` 的单一权威），并在载荷中如实标记"降级、非全量"。`runner.mjs` 现阶段只留 1 MiB 内存环 + 32 KiB stdout，全量日志需要落盘再传。

**D9：脱敏门 = 已知凭据精确匹配 + 模式扫描双层，落点在 worker 上传路径。**
宿主已知绑定凭据明文可精确查找（零误报），叠加通用凭证模式扫描；命中即拒收。实现扩展 `src/worker/redact.ts`（已有 known-secret 精确替换与模式扫描），而非宿主 `redaction.ts`——后者被 `credential-safe-display` 合同限定为 URL/SCP userinfo 窄范围且不得声称检测任意秘密；且上传发生在 pod 内，门禁须与被上传内容同进程。

**D10：保留账本照 `retention-policy.ts` 哲学，登记 + 列表对账。**
对象按 `needId/runId` 前缀组织；超龄（默认窗口 14d）/超量（默认 512 MiB）标记并呈现，不自动删、不静默堆；真删除仅由用户裁决触发。账本数据源 = 宿主落账的对象记录 + ListObjectsV2 对账（发现孤儿/失联对象并标记）；前缀隔离用于账本归类与成本控制，**不**声称在单 root 凭据下是安全边界。

**D11：ref 的人类可读路径是宿主读取入口，不是外部链接。**
工作台呈现 ref、摘要与校验状态；宿主提供显式读取（同一 resolve 路径、按绑定凭据取回内容）。不生成 presigned URL（红线）；不新增宿主 HTTP 端点。

## Risks / Trade-offs

- [RustFS 处于 Beta 且镜像 `:latest`] → 合同定位其为易逝层，非事实源（Session Event/Git 才是）；换固定 tag 归运维；可插拔接口保证可整体换后端。
- [内网 plain HTTP 传输] → 已知环境妥协并记录；SigV4 不传输密钥本体，明文暴露面是内容本体与 access key id，凭据零进日志红线不放松；未来 TLS 由 ingress + 私有 CA 解决，不触碰合同。
- [后端 versionId 能力未知] → ref 将 `versionId` 定为可选并在"存在则必存、MUST 不缺失时不静默降级"的规则下工作；若后端不返回，钉版以 etag+hash 承担（任务 2.2 的连通验收必须记录该观测，作为合同是否收窄的证据）。
- [单 root 凭据被所有 worker 共享] → 第一版接受（单用户测试环境）；bucket 按 need/run 前缀 + 凭据随 pod 回收收敛暴露面；IAM 收敛为开放问题；前缀隔离不写成安全边界。
- [脱敏漏报] → 精确匹配已知凭据值兜底覆盖宿主自己发放的密钥；fail-closed：扫描器故障时拒绝上传而非放行。
- [对象存储不可用 = 交接阻塞] → 与 Gitea 不可用同命，失败关闭并显式报错；不存在静默降级为纯文本大载荷的路径。
- [单机 local-path 无冗余] → 易逝定位 + 保留账本如实呈现；耐久内容本就不在此层。
- [门禁不能覆盖模型朝向会话正文的输出] → 如实记录为覆盖边界；缓解是指令/工具引导，不作为门禁成效宣称。

## Migration Plan

1. 绑定 schema 与 store 客户端先行，未配置绑定时全系统行为与现状完全一致（零回归面）。
2. 生产侧自动外置 + ref 字段启用（新内容路径，不触碰存量；事件 payload 加可选字段，旧读端剥离未知键）。
3. 门禁按通道逐个启用（结果文档 → bridge → 事件载荷 → 交互发送点），每通道先验证拒绝码与外置指引文案；交互通道为发送前本地拒绝，不改协议。
4. 执行日志外置最后切换：worker 落盘上传 → 结果文档回传尾部+ref；降级路径为 worker 容器日志尾部读取（如实标记）。
5. 回滚：停用绑定与门禁即回到纯现状；已写对象只读保留至保留窗口。

## Open Questions

- RustFS IAM 能力核实（能否建受限用户/policy）——影响 D6 第二步收敛；受限凭据下跨 run 读取的授权设计随之而来，不改变本 change 的地址与门禁合同。
- 宿主→NodePort 32571 连通实测；pod→ClusterIP 9000 连通实测（任务 2.2，含 versionId 与 ListObjectsV2 行为观测）。
