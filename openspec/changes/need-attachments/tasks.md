# tasks — need-attachments

## 0. 传输层评估（阻塞，任务 2 之前必须完成）

- [x] 0.1 评估结论（对 fork 核实）：`@deepseek-ai/dsh-attachment` 的**存储与语义不可复用**——`AttachmentStore` seam 全是图片语义（`validateImage`/`saveImage`/`readImage`、`ImageMediaType` 仅四种光栅格式、解码归一化、`ImageVariantId` 变体），且存 DSH_HOME 并绑对话历史。但评估揭示了更关键的一点：**客户端到宿主根本不存在独立的"传输层"——字节直接作为 Typert Remote 的参数传递**。证据：`@deepseek-ai/dsh-commands` 的 `@Remote execute(agent, line, images: readonly EncodedImageAttachment[], signal)`，而 `EncodedImageAttachment.data` 是 `Uint8Array`；`packages/typert/protocol` 未声明任何字节上限。
- [x] 0.2 据此**选定候选 1 的实质形态**：附件字节以 `Uint8Array` 作为 Remote 参数直送宿主，宿主侧经脱敏门后 put 进对象存储。**不引入分片协议**（0.2 原方案），**不新增 HTTP 端点**（0.3 原方案）——二者均无需评估即被更优解取代，否决依据即本条。
- [ ] 0.3 ~~宿主新增上传端点~~ 不再需要（见 0.2）
- [ ] 0.4 按选定传输层确定附件通道阈值：**未定**。Remote 参数的实际字节天花板（传输缓冲与内存）需对真实宿主实测，本机无已安装宿主。阈值在实测前不预设——`artifact-ref-handoff` 的既有通道阈值（result-document 3 KiB / bridge 32 KiB）不适用于此路径

## 1. 事件词汇（可与任务 0 并行）

- [ ] 1.1 `src/domain.ts` 新增 `pactflow/attachment-linked`；新词汇表按实施时实际版本号（`0.7.0` 或 `0.8.0`）**逐条字面列出**。验证：`domain.spec.ts`
- [ ] 1.2 生产者版本升级 + 前一版 read-only 注册。验证：单测
- [ ] 1.3 老会话可写性：先失败后通过。验证：单测。实施状态标注「对 fork 验证」
- [ ] 1.4 旧读端兼容 + `ops-doc-event-count` 与运维文档计数同步。验证：单测

## 2. 上传与外置（依赖任务 0 选定）

- [ ] 2.1 按选定传输层实现浏览器→宿主传输；越限在发送前本地拒绝，返回 oversize 码与指引，不部分上传。先失败后通过。验证：单测
- [ ] 2.2 宿主侧：经既有脱敏门（命中拒收 + 扫描器故障拒收）→ 上传 artifact store（附件 kind）→ 事件只存 ref+摘要+媒体类型。先失败后通过。验证：单测
- [ ] 2.3 对象入既有保留账本；孤儿对账覆盖附件对象（上传成功但落账失败的对象被标为孤儿）。验证：单测
- [ ] 2.4 未绑定对象存储：入口显式不可用并指名原因，**无内联回落、不写 DSH_HOME**。验证：单测

## 3. Agent 面与读取

- [ ] 3.1 Agent 只读：工具面无上传能力，宿主对 Agent 来源的上传请求拒绝；消费前 MUST resolve+校验，校验不符显式失败不回落记忆。验证：单测（含「以记忆替代对象内容」路径不存在的对抗断言）
- [ ] 3.2 `pactflow_view` 快照补附件摘要（ref、字节数、媒体类型、校验状态），不含内容本体。验证：单测
- [ ] 3.3 宿主读取入口复用 `artifactLog` 的解析与绑定约束；越出绑定拒绝。验证：单测

## 4. 客户端

- [ ] 4.1 工作台附件区：上传入口（按选定传输层）、摘要/字节数/媒体类型/校验状态、显式读取按钮。验证：client 单测 + overlay e2e

## 5. 终验（依赖 `artifact-ref-handoff` 5.1/7.1 完成）

- [ ] 5.1 真实路径验收：真实对象存储上完成「浏览器上传 → 脱敏门 → 落账 ref → Agent resolve+校验 → 工作台读取」全链；凭据不进事件、日志与 argv；孤儿对账真实命中一次。**无 mock 冒充**
- [ ] 5.2 回归：`pnpm run check` 全绿、`openspec validate --all --strict` 全绿；传输层评估结论与真实验收证据记入实施状态
