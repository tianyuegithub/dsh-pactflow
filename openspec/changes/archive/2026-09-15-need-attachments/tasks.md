# tasks — need-attachments

## 0. 传输层评估（阻塞，任务 2 之前必须完成）

- [x] 0.1 评估结论（对 fork 核实）：`@deepseek-ai/dsh-attachment` 的**存储与语义不可复用**——`AttachmentStore` seam 全是图片语义（`validateImage`/`saveImage`/`readImage`、`ImageMediaType` 仅四种光栅格式、解码归一化、`ImageVariantId` 变体），且存 DSH_HOME 并绑对话历史。但评估揭示了更关键的一点：**客户端到宿主根本不存在独立的"传输层"——字节直接作为 Typert Remote 的参数传递**。证据：`@deepseek-ai/dsh-commands` 的 `@Remote execute(agent, line, images: readonly EncodedImageAttachment[], signal)`，而 `EncodedImageAttachment.data` 是 `Uint8Array`；`packages/typert/protocol` 未声明任何字节上限。
- [x] 0.2 据此**选定候选 1 的实质形态**：附件字节以 `Uint8Array` 作为 Remote 参数直送宿主，宿主侧经脱敏门后 put 进对象存储。**不引入分片协议**（0.2 原方案），**不新增 HTTP 端点**（0.3 原方案）——二者均无需评估即被更优解取代，否决依据即本条。
- [x] 0.3 ~~宿主新增上传端点~~ **不再需要**（见 0.2）：评估发现客户端到宿主根本不存在独立传输层，字节直接作为 Typert Remote 参数传递，分片协议与新 HTTP 端点两个候选均被更优解取代。作为已裁决的非任务结项，不再占据未完成计数

## 1 节为何不单独实施（2026-09-15 记录）

第 1 节标注「可与任务 0 并行」，但**单独实施会产生只有代价没有收益的状态**：新增
`pactflow/attachment-linked` 会提升 external producer 声明版本，而第 2 节（真正写入
该事件的路径）尚未实施。结果是每个用户的会话都换上一个没有任何写入方的新版本声明。

**2026-09-15 更新**：0.4 的阻断已解除（阈值实测为 32 MiB，见上），所以第 2 节不再受
任务 0 阻塞。但第 1 节仍等第 2 节一并实施，理由不变且更简单——**词汇表在有写入方之前
不预先提升版本**。届时 1.1 的「按实施时实际版本号」也才有确定答案。
- [x] 0.4 附件通道阈值：**已实测并定为 32 MiB**（2026-09-15）。

  先前记的「需对真实宿主实测，本机无已安装宿主」**前提有误**——`verify:profile:dev` 用兄弟 fork 源码就能起真实 DSH web profile 并发真实 Remote 调用，而那个 checkout 一直都在。新增 `scripts/measure-remote-payload-ceiling.mjs` 复用同一条链路，逐级加大载荷直到通道拒绝。载荷用不可压缩随机字节，且探针骑在 `pactflow/health` 上（该 Remote 忽略参数），**所以任何拒绝都是通道的而非参数校验的**。

  实测（本机，Node 22）：

  | 载荷 | 结果 | 耗时 |
  | --- | --- | --- |
  | 1 MiB | 通过 | 17ms |
  | 16 MiB | 通过 | 193ms |
  | 32 MiB | 通过 | 432ms |
  | 64 MiB | 通过 | 795ms |
  | 128 MiB | 通过 | 1617ms |
  | 256 MiB | 通过 | 3110ms |

  **结论：传输层不构成实际瓶颈，直到 256 MiB 都没有任何拒绝。**再往上（512 MiB）撞的是 Node 自己的最大字符串长度（`0x1fffffe8` 字符）——V8 对 JSON 序列化的限制，不是通道施加的字节上限；再探即是在测探针自己。

  **因此阈值是策略选择，不是传输上限的转述**，据此定 32 MiB，理由三条：
  1. **延迟**：32 MiB 往返 432ms，仍在交互可接受范围；再高一级（64 MiB / 795ms）已经开始像卡住。
  2. **内存**：整个载荷在客户端与宿主两侧同时以字符串/`Uint8Array` 驻留，实际占用是载荷的数倍。32 MiB 使最坏情形留在可预期范围内。
  3. **失败形态**：32 MiB 是「实测可通过」的 1/8、结构性极限（V8 ~512 MiB 字符串上限）的 1/16，故越限一定是**我们自己带明确文案的策略拒绝**，而不是 V8 的 `Invalid string length` 或传输层的不透明失败。这一条最重要——任务 2.1 要求「越限在发送前本地拒绝，返回 oversize 码与指引」，只有阈值远离硬极限时该承诺才成立。

  记录边界：这是开发通道宿主上的测量（脚本走 `verify:profile:dev` 同一条链路），官方发行版宿主的行为未测——但阈值留了 8–16 倍余量，正是为了让这个差异不影响结论。

## 1. 事件词汇（可与任务 0 并行）

- [x] 1.1 `PACTFLOW_EVENT_TYPES_V0_8` 逐条字面列出 22 类（21 + `pactflow/attachment-linked`），不由 V0_7 推导。实施时的实际版本号是 `0.8.0`（`need-comment-threads` 归档时已占用 0.7.0）。验证：`attachment-vocabulary.spec.ts`
- [x] 1.2 `PACTFLOW_EVENT_PRODUCER_VERSION` 升至 `0.8.0`，并新增 `0.7.0` 的 read-only 注册（此前最高只注册到 0.6.0）。验证：同上，用「重复注册 0.7.0 被拒」反证该只读通道确实已被占用
- [x] 1.3 老会话可写性：用例在升版后的服务上创建会话、写入事件，再次写入不得出现声明冲突。这是本任务唯一的真实风险——升版的代价由既有项目承担，而不是由这次改动承担。验证：同上
- [x] 1.4 三处连带同步，且**三条既有守卫都先红后绿**（它们正确抓住了升版的连带影响，这正是它们存在的意义）：`release-manifest.json` 的 `hostEventProducerVersion` → 0.8.0；运维手册计数 21→22 类并补记 0.7.0 一档；`ops-doc-event-count` 与 `producer-upgrade` 守卫扩展到 0.7.0/0.8.0。另修两条**过度绑定当前版**的守卫——`comment-threads` 断言 V0_7 是当前词汇、`run-usage-budget` 断言版本号字面为 0.7.0；二者要守的分别是「V0_7 自身字面完整」与「用量维度不新增事件类型」，都不该随他人升版而红，已解绑并写明理由

## 2. 上传与外置（依赖任务 0 选定）

- [x] 2.1 附件字节作为 Remote 参数（base64）直送宿主，无分片协议、无新端点。**越限检查在客户端、发送任何字节之前**：合同要求本地预拒并带 oversize 码与指引，理由正是替代方案——传完几十 MB 才被告知不行，或者更糟，传了一半。宿主侧同样再拒一次（`assertWithinChannelLimit('attachment', …)` 在任何网络流量之前），客户端这道不是它的替代品，是省下这次传输的那道。阈值取自 `PACTFLOW_CHANNEL_LIMITS.attachment` 单一定义，守卫断言客户端不得出现第二个手写字节数——漂移会表现为「客户端放行、宿主拒绝」。验证：`attachment-workbench.spec.ts` + `attachment-upload.spec.ts`
- [x] 2.2 `linkAttachment` Remote。顺序即合同：尺寸检查在任何网络流量之前；脱敏门在 `putArtifact` 内、请求发出之前，**扫描器故障与命中同样拒收**（扫不了的内容不是可以存的内容）；对象存在之后才追加事件，且事件只带 uri/etag/bytes/sha256/kind/媒体类型/摘要。上传门不传「已知凭证值」清单——那要求每次上传都把所有已配置凭证解析进宿主内存，正是这道门要防的暴露；模式扫描不需要它，且该模块本就声明自己不是任意秘密检测。验证：`attachment-upload.spec.ts` 对**真实 MinIO** 跑，四类凭证形态各一条并核验存储中零对象残留、日志中零事件
- [x] 2.3 `artifactLedger` Remote。`artifactObjectRecord` / `reconcileArtifactObjects` / `summarizeArtifactLedger` 此前**全仓零消费者**——账本函数写好了却没人接线，本任务正是接这条线。已记录对象来自持久日志（附件 ref + 外置运行日志），清单来自存储本身；存储持有而日志从未记录的键即孤儿，正是「上传成功、落账失败」留下的东西。**不删除任何对象**。验证：同上，在真实存储里放一个日志从未命名的对象，断言它被标为孤儿且仍然存在
- [x] 2.4 抽出 `artifactStoreClient(session)`，三条附件/日志路径共用——「未绑定」因此是一处拒绝一种措辞，而不是三份会漂移的副本，且**不存在任何一个分支让缺绑定退化成写到别处**。验证：同上（该用例故意在未武装存储时跑，若它走到了存储，失败的就会是「没有存储」而不是被断言的那件事）

## 3. Agent 面与读取

- [x] 3.1 Agent 面无任何 attach/upload/link 工具，且**不暴露任何 endpoint/bucket/access_key/secret_key/artifact_store 参数**——绑定是宿主的，一个这样的参数就能让模型把上传瞄准项目从未绑定的地方。`readAttachment` 经 `resolveArtifact`，它逐项校验 bytes 与 sha256，不符即抛 `corrupt`，**消费方因此不可能拿到与记录不符的内容**；「回落到记忆」的路径不存在，因为该函数要么返回校验过的字节要么抛错。**canary 实证**：给 Agent 面加一个带 `endpoint` 参数的 `pactflow_upload_attachment`，两条守卫同时转红，随后已还原。验证：`attachment-agent-scope.spec.ts`
- [x] 3.2 附件随 `pactflowDelivery` 投影进入快照，`pactflow_view` 自动携带——无需为它开第二条读取路径。用例断言文件名、sha256 与媒体类型可见，而签名地址与凭证字段不可见。验证：同上
- [x] 3.3 `readAttachment` 与 `artifactLog` 共用同一个 `artifactStoreClient(session)` 与同一个 `resolveArtifact`；后者内部 `boundKey(ref)` 强制 ref 落在绑定内，越出绑定即拒绝。用例另断言未曾 link 过的 id 被拒。验证：同上

## 4. 客户端

- [x] 4.1 工作台交付页新增附件区：上传入口、文件名/媒体类型/字节数/sha256、以及**显式**的「读取并校验」按钮（渲染本身不取任何内容）。摘要里展示 sha256 是因为读取要对它校验——不符是拒绝，不是静默替换。未绑定对象存储时入口不渲染，并明说「不会退回为内联大文本」，因为用户会预期的正是那种静默回落。overlay 接线走既有的加载路径（带代次守卫），而不是自己再取一次——否则被会话切换抢先的重载会画出错误需求的内容。验证：`attachment-workbench.spec.ts`（9 例真实渲染）

## 5. 终验（依赖 `artifact-ref-handoff` 5.1/7.1 完成）

- [x] 5.1 真实路径验收**已跑通**（2026-09-15）。`attachment-acceptance.real.spec.ts` 在真实 S3 兼容存储上一次走完整链，七步都在同一个用例里——拆成单测时每一半都令人信服而**接缝不**，而接缝正是这条要证的东西：离开浏览器编码器的那串字节，与工作台最终展示其已校验摘要的那串字节，中间隔着一次真实 HTTP 往返和一次真实 fold，必须是同一串。

  ① 浏览器端按工作台同样的方式编码 → ② 宿主经脱敏门真实上传并落账 → ③ 对象确实在存储里，键与字节数与记录一致（`listObjects` 核验）→ ④ 事件与日志中不含 access key、secret key、`X-Amz-Signature` 与内容本体 → ⑤ 读取经 `resolveArtifact` 对 sha256 校验后返回原文 → ⑥ 工作台由折叠后的投影渲染出同一个摘要，且不含内容本体 → ⑦ 放入一个日志从未命名的对象，孤儿对账真实命中它、且不误判已记录的附件。

  除浏览器 File API（不属于本条主张）外无任何 mock。**记录边界**：本条头部写的「依赖 `artifact-ref-handoff` 5.1/7.1 完成」未满足——那两条要求真实 K3s，本机 `kubectl`/`k3s` 均未安装。附件链路本身不经 Worker，故其全链在真实存储上是完整的；但「与运行日志外置共用同一条 Worker 侧路径」这一点仍未在集群上验证。
- [x] 5.2 回归：`pnpm run check` 全绿（130 文件 / 1047 通过 / 25 产物）、`openspec validate --all --strict` 55/55。传输层评估结论（0.2）与阈值实测（0.4）已记入实施状态；本节真实验收证据随本批次一并记入
