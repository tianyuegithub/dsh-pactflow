# need-attachments

## Why

开发计划 §5.1 的 Content 事件家族包含「附件引用」，本仓零实现。截图、失败日志、设计稿、第三方报告——凡是不适合塞进有界文本通道的材料，当前既进不了需求，也进不了节点。用户只能在外部工具里另存，零脉侧留不下线索。

**先查了原生**。DSH 有 `@deepseek-ai/dsh-attachment`（抽象 `AttachmentStore` seam）与 `@deepseek-ai/dsh-attachment-local`（DSH_HOME 内容寻址存储）。评估结论：

- 它是**图片专用**——媒体类型只有 `image/png | jpeg | webp | gif`，按光栅语义解码归一化（`originalDimensions`、`ImageVariantId`），存于 DSH_HOME 且绑定到提示词与对话历史。
- 日志、PDF、设计稿、报告等通用附件**不能**走它。
- 但它证明了一件事：DSH 客户端到宿主的**字节传输路径是原生现成的**（用户在 Web 界面给提示词附图就在用它）。

因此本 change 的形态是：通用附件的**本体**走第七类资源（对象存储，`artifact-ref-handoff` 已交付零签名地址、hash+bytes 校验、脱敏门、保留账本、绑定外拒绝）；**浏览器到宿主的传输层**优先复用原生已有路径，任务 0 先做评估，评估结果决定后续任务形态。

## 传输层：本 change 最关键的未决点

零签名 URL 是硬约束，附件字节只能经宿主中转。宿主入口是 Typert Remote——而 `artifact-ref-handoff` 刚证明 Remote / 事件 / 交互全是**有界通道**（4 KiB / 8000 / 32 KiB）。一张截图就能撑爆任何一条。

三个候选，任务 0 按此顺序评估，**取第一个可行的**：

1. **复用 DSH 原生 attachment 的客户端→宿主传输层**（不复用其存储与图片语义）。若该传输层可承载任意字节且可被插件接入，则优先。
2. **分片经 Remote**：每片 ≤ 通道硬限，宿主侧按内容 hash 重组、校验后再上传对象存储。不新增端点，但引入分片状态与重组失败语义。
3. **宿主新增上传端点**：与「不新增 HTTP 端点」相悖，仅当前两者被证明不可行时才考虑，且须单独评审。

任务 0 的评估结论（含证据）记入实施状态后，任务 2 才能开始。

## What Changes

- **新增附件**：附件本体一律外置到项目绑定的 artifact store，事件只存结构化 `artifactRef` + 摘要 + hash + 字节数 + 媒体类型。零签名 URL 沿用既有禁令。
- **上传走既有脱敏门**：命中凭据即拒收，扫描器故障同样拒收（fail-closed）。
- **登记进既有保留账本**：超龄/超量标记不删；孤儿对账覆盖附件对象。
- **附件通道阈值单列**：按通道配置且 MUST ≤ 传输层硬限，数值在任务 0 评估后按真实观测确定。
- **未绑定对象存储时失败关闭**：附件入口显式不可用并说明原因，MUST NOT 回落为内联大文本、MUST NOT 写入 DSH_HOME 或任何替代位置。
- **Agent 面只读**：可读 ref 与摘要，MUST NOT 上传，MUST NOT 获得端点参数或凭据；消费内容前 MUST 先 resolve+校验。
- **事件**：新增 `pactflow/attachment-linked`。若 `need-comment-threads` 已先实施（`0.7.0`），本 change 升至 `0.8.0`；若本 change 先实施，则升至 `0.7.0`。无论哪种，词汇表逐条字面列出、老会话可写由测试钉死。
- **客户端**：工作台呈现附件摘要、字节数、媒体类型、校验状态与显式读取入口；读取复用既有按绑定解析的宿主入口。
- **非目标**：不做图片预览与变体（那是原生 attachment 的领域）；不做附件版本；不做附件的编辑与物理删除（保留账本裁决）；不做跨需求附件库。

## Capabilities

### New Capabilities

- `need-attachments`: 需求级通用附件的完整行为合同——传输层评估与选定、本体必须外置且受脱敏门与保留账本约束、通道阈值、未绑定存储时失败关闭、Agent 面只读与解析义务、事件词汇升版、引用的人类可读路径。

## Impact

- **Host**：`src/domain.ts`（新事件 + 字面词汇 + collaboration 投影扩展）、`src/index.ts`（上传/读取 `@Remote()`，复用 `artifactLog` 的解析与绑定约束）、`src/artifact-store.ts`（附件 kind）、`src/retention-policy.ts`（附件对象入账本）。
- **Client**：传输层实现（取决于任务 0）；工作台附件区。
- **Agent**：`pactflow_view` 快照补附件摘要；无写工具。
- **Session Event**：新增 1 类事件，升版。
- **Worker Provider**：不涉及。
- **前置依赖**：`artifact-ref-handoff` 的 5.1/7.1 真实验收。在其完成前，本 change 的真实验收任务 MUST NOT 声称通过。
- **架构对应**：§3 终局能力 9（资源化基础设施）的复用面；§3 终局能力 10「全部使用 DSH 原生机制」——传输层优先复用原生，是本 change 对该条的直接回应；§4 不变量「大内容不进有界通道」「原始凭证不得进入 Session Log」不放宽。
