# tasks — artifact-ref-handoff

## 1. Store 客户端与绑定基座

- [x] 1.1 新增 `src/artifact-store.ts`：手写 SigV4 最小客户端，4 个操作 PutObject/GetObject/HeadObject/ListObjectsV2（path-style）；put 返回 etag 与后端提供的版本标识，resolve 校验 hash+bytes 且只允许本绑定 bucket；单测覆盖签名向量、前缀列表、越出绑定的目标拒绝——隔离级 fake S3 上先失败后通过
- [x] 1.2 `src/schema.ts` 新增 artifactStore 绑定（endpoint/bucket/credentialRef/pathStyle，与 Git binding 同构；凭据只从环境/密钥服务来）；未配置绑定时现有全套测试零回归（`pnpm run check` 维持全绿）
- [x] 1.3 `artifactRef` 强类型与地址合同实现（uri/etag/bytes/hash/kind/summary，可选 versionId；summary 同时受行数与字节数约束）；单测覆盖"缺字段不可构造、摘要超行数或超字节不可构造、版本标识存在时不静默省略"
- [x] 1.4 对象 key 唯一性与不可覆写：key 含随机段，同 key 二次写入不替换既有 ref；单测先失败后通过

## 2. 凭据注入、镜像与真实验证

- [x] 2.1 `src/k3s-worker.ts`：Job 创建时渲染 bound Secret 并以 env `secretKeyRef` 注入（非 ConfigMap 明文、非 argv），Secret 名进入创建意图 `childNames`、启动对账与 children 清理账本；单测断言凭据不进 ConfigMap/事件/argv、崩溃对账可发现该 Secret、清理回收失败保留清理责任（先失败后通过）
- [x] 2.2 worker 镜像重建并按摘要重新钉版：上传助手与全量日志落盘进 `packages/dsh-pactflow/worker/dsh/`，更新 `release-manifest.json` 摘要；构建产物核验（镜像摘要与清单一致）
- [x] 2.3 真实路径连通验收：worker pod→ClusterIP `10.43.146.89:9000` 真实 PUT/GET/HEAD/LIST；宿主→NodePort 32571 真实 GET；**一并记录后端行为观测**——是否返回版本标识、ListObjectsV2 前缀行为是否可用；结果记入验收记录并据此确认合同是否需要收窄

## 3. 脱敏门与保留账本

- [x] 3.1 `src/worker/redact.ts` 扩展内容级脱敏门：已知凭据精确匹配 + 通用凭证模式扫描；先失败后通过——含凭据内容上传被拒收，扫描器自身故障时同样拒绝（fail-closed）
- [x] 3.2 `src/retention-policy.ts` 对象保留账本：按 needId/runId 前缀登记，超龄（14d）与超量（512 MiB）标记并呈现，不自动删除；**列表对账**发现已上传但无引用的孤儿对象并标记；单测覆盖标记、呈现、"无裁决不删除"与孤儿对账

## 4. 通道、门禁与解析义务

- [x] 4.1 结果/桥载荷新增结构化 `artifactRef` 字段；宿主落账 Session Event 仅含 ref+摘要，并**复用现有事件 payload 的可选字段**（不新增事件类型、不升生产者版本）；单测断言事件与日志无内容本体、无凭据，且生产者声明与既有会话保持可写（先失败后通过）
- [x] 4.2 旧读端兼容：以不识别 ref 字段的读取路径解析含 ref 的日志成功且不失败；投影形状变化经 stateVersion 升级表达；`tests/ops-doc-event-count.spec.ts` 与安装运维文档词汇计数保持全绿（先失败后通过）
- [x] 4.3 超长门禁：阈值按通道配置（结果文档 ≤3 KiB 合同预算、bridge ≤32 KiB、事件与交互按 schema 取更小值，均 MUST ≤ 通道硬限），越限内联返回 `pactflow.artifact.oversize` 与外置指引；按通道（结果文档 → bridge → 事件载荷 → 交互发送点）逐个启用，交互通道为发送前本地拒绝、不改 `dsh-worker-interactions/v1`；每通道先失败后通过
- [x] 4.4 消费侧解析义务：依赖 ref 内容的执行前 MUST resolve+校验；缺失/版本不符/hash 或字节不符/越出绑定返回显式错误码；单测断言"以对话记忆内容替代对象内容"路径不存在，"ref 指向绑定外目标"在零出网下拒绝（失败关闭）
- [x] 4.5 发送侧时序：对象存储确认写入前构造的 ref 无法通过校验（缺 etag 或版本标识），门禁拒绝进入通道；单测先失败后通过

## 5. 执行日志外置

- [ ] 5.1 worker 作业结束把全量日志落盘并 put 上传，结果文档回传尾部+ref（含大小）；真实 K3s 验收（长日志端到端：尾部+ref 可解析、hash 可校验、结果文档不超其通道阈值）
- [x] 5.2 降级取证：worker 未上传时宿主读取 **worker 容器**日志尾部（泛化现有探针读取路径的容器名与上限参数，或新增等价读取路径并复用其身份校验模式）并如实标记降级与非全量，上限取运行预算 `maxOutputBytes`、不引入第二套硬编码上限；单测断言标记存在且上限来自预算

## 6. 资源化登记、界面与文档

- [x] 6.1 第七类资源登记：`types.ts` 资源 kind 联合、`settings-model.ts`/`settings-probe.ts`/`resource-cards.tsx`/`locale.ts` 与 Settings 卡片生命周期（登记/编辑/删除）；删除被引用存储失败关闭并给出引用证据（复用现有删除卫队）；client 测试覆盖
- [x] 6.2 引用的人类可读路径：工作台呈现 ref、摘要与校验状态，宿主提供按 ref 取回内容的显式读取入口（同一解析与绑定约束，不生成签名地址、不新增 HTTP 端点）；client 测试覆盖
- [x] 6.3 文档同步：`docs/architecture-目标架构.md` §3.9 六类→七类（已裁决 2026-09-14）、`docs/development-plan-开发计划.md`（五类/六类两处与验收矩阵行 9）、`docs/business-logic-业务逻辑.md` §2.1；`docs/implementation-status-实施状态.md` 记录阶段与验证命令

## 7. 终验

- [ ] 7.1 全链真实验收：worker put → ref 回传 → 另一 worker/宿主 resolve+校验；门禁拒绝路径（含结果文档与交互两个通道）；Secret 回收；孤儿对象对账与保留账本呈现——全部真实 RustFS + 真实 K3s，无 mock 冒充
- [ ] 7.2 回归：`pnpm run check` 全绿、`openspec validate --all --strict` 全绿；验收证据（连通性、versionId/List 观测、截断消除、账本）记入实施状态
