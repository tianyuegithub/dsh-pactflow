# tasks — need-comment-threads

## 1. 事件词汇与老会话可写性（前置，先做）

- [ ] 1.1 `src/domain.ts` 新增 `pactflow/comment-added` 与 `pactflow/comment-voided` 两类事件与 payload schema（携带 `v`）；`PACTFLOW_EVENT_TYPES_V0_7` **逐条字面列出**全部类型，不由 `V0_6` 推导。验证：`domain.spec.ts` 断言词汇为字面数组且长度正确
- [ ] 1.2 `src/domain.ts` 的 `PACTFLOW_EVENT_PRODUCER_VERSION` 升 `0.7.0`（该常量已由 change `manifest-producer-version-guard` 从 `src/index.ts` 迁出），`src/index.ts` 补 `0.6.0` 的 read-only 注册。验证：单测断言 0.1.0–0.6.0 六个只读注册齐备
- [ ] 1.2a 同步 `worker/dsh/release-manifest.json` 的 `hostEventProducerVersion` 至 `0.7.0`——`release-manifest-accuracy` 守卫会强制这一步。**无需重建镜像**：worker 从不写 Session Event（架构 §4 不变量），生产者升版不改变镜像行为；该字段是宿主侧兼容性记录。验证：守卫转绿
- [ ] 1.3 **老会话可写性**：以已持久化 `0.6.0` 声明的会话夹具写入 `0.7.0` 事件，断言写入成功且日志追加升级后声明、无 conflicting declaration。**先失败后通过**——先构造会重演写冻结的夹具证明测试有效。验证：单测。实施状态如实标注「对 fork 验证，上游 PR 未合并」
- [ ] 1.4 旧读端兼容：以不识别两类新事件的读取路径解析新日志成功不抛错；`ops-doc-event-count.spec.ts` 与安装运维文档词汇计数同步更新至全绿。验证：单测
- [ ] 1.5 **跨 change 重跑**：若 `gitea-review-gate-closure` / `node-rerun-authorization` / `dsh-harness-telemetry` 任一已在本 change 之前实施，重跑其「老会话可写」断言于 `0.7.0`。验证：对应单测全绿并记入实施状态

## 2. 评论核心

- [ ] 2.1 归属与身份：fold 校验归属对象存在、同需求、非 archived；作者类别由宿主从会话上下文判定并**覆写调用方自述**。三条拒绝路径先失败后通过。验证：单测
- [ ] 2.2 **评论永不构成授权**：含「批准」字样的评论不改变阶段、不改变节点状态、不产生 `review-recorded`、不进入批准证据集合。验证：单测（对抗性守卫）
- [ ] 2.3 `agent` 评论计数预算：取既有运行预算合同语义，超出指名拒绝；`human` 不受限。先失败后通过。验证：单测（两条成对）
- [ ] 2.4 作废：以追加事件表达，原文不变；投影折叠可展开；从事件流重放两次结果一致；`agent` 不能作废。验证：单测
- [ ] 2.5 独立 collaboration 投影：只存计数与最近 N 条摘要，正文经 `@Remote()` 分页读取；`stateVersion` 按既有惯例声明。验证：单测断言注入大量评论后投影体积不随之线性增长

## 3. Agent 面

- [ ] 3.1 `pactflow_add_comment`：落账身份强制 `agent`。验证：单测断言自述 `human` 被忽略
- [ ] 3.2 `pactflow_view` 快照：每条评论带来源与作者类别标记；已作废评论不进快照；`agent` 评论不呈现为人的指令（与挂机通知同族的标记）。验证：单测

## 4. 客户端

- [ ] 4.1 工作台「讨论」区：按当前需求过滤，显示作者类别/时间/正文，已作废折叠可展开；人可发表、可作废。验证：client 单测 + overlay e2e

## 5. 终验

- [ ] 5.1 真实会话验证：真实 DSH 会话中人与模型各追加评论，断言身份落账正确、快照标记正确、作废折叠生效；升级前创建的真实会话在升级后可写。**无 mock 冒充**
- [ ] 5.2 回归：`pnpm run check` 全绿、`openspec validate --all --strict` 全绿；词汇计数变更与 fork 验证边界记入 `docs/implementation-status-实施状态.md`
