# DSH 零脉实施状态

> 本文件按批次**追加历史**（最新在顶部）。文中各段落的验证数字（如「65 文件 / 528 测试」）是**该批次当时的基线**，不是当前基线。已提交基线参见 `docs/CURRENT_STATUS-当前状态.md`；当前尚未提交的批次及其验证结果，以本文件顶部最新记录为准。

## 2026-09-15 need-attachments 从 2/18 做到 18/18（附件能力完成）

0.4 的阈值实测解除阻断后，第 2 节不再受任务 0 阻塞，整个 change 因此再无外部依赖——
剩下的全是开发工作。

**基线：`pnpm run check` 130 文件 / 1047 通过 / 16 跳过 / 25 产物；`openspec validate
--all --strict` 55/55。**

### 事件词汇（第 1 节）

`PACTFLOW_EVENT_TYPES_V0_8` 逐条字面列出 22 类，生产者版本 0.8.0，并补上 0.7.0 的
read-only 注册（此前最高只到 0.6.0）。**三条既有守卫先红后绿**——`release-manifest` 的
`hostEventProducerVersion`、运维手册计数、`ops-doc-event-count`/`producer-upgrade`
——它们正确抓住了升版的连带影响，这正是它们存在的意义。

另修两条**过度绑定当前版**的守卫：`comment-threads` 断言 V0_7 是当前词汇、
`run-usage-budget` 断言版本号字面为 0.7.0。二者真正要守的分别是「V0_7 自身字面完整」
与「用量维度不新增事件类型」，都不该随他人升版而红。这类守卫把「我关心的事实」和
「当时恰好成立的事实」写在了一起，后者会把将来每一次正当改动都变成一次假警报。

### 上传、外置与账本（第 2 节）

顺序即合同：尺寸检查在任何网络流量之前；脱敏门在请求发出之前，且**扫描器故障与命中
同样拒收**；对象存在之后才追加事件，事件只带地址与摘要。

上传门刻意不传「已知凭证值」清单——构造它要求每次上传都把所有已配置凭证解析进宿主
内存，正是这道门要防的暴露；模式扫描不需要它，且该模块本就声明自己不是任意秘密检测。

`artifactObjectRecord` / `reconcileArtifactObjects` / `summarizeArtifactLedger` 此前
**全仓零消费者**——账本函数写好了却没人接线，2.3 接上了这条线。

附件字节走 base64 而非 `Uint8Array`：后者带 `Symbol.toStringTag`，Remote 边界拒绝符号
键属性。base64 也正是实测通道天花板时用的形态，故 32 MiB 阈值直接适用于该字段。

### Agent 面与工作台（第 3、4 节）

Agent 面无任何 attach/upload/link 工具，且不暴露 endpoint/bucket/access_key/secret_key/
artifact_store 任一参数——绑定是宿主的，一个这样的参数就能让模型把上传瞄准项目从未
绑定的地方。**canary 实证**：加一个带 `endpoint` 参数的 `pactflow_upload_attachment`，
两条守卫同时转红，随后已还原。

客户端越限检查在发送任何字节之前，阈值取自单一定义且守卫禁止第二个手写字节数——漂移
会表现为「客户端放行、宿主拒绝」。未绑定存储时入口不渲染并明说「不会退回为内联大
文本」，因为用户会预期的正是那种静默回落。

### 全链真实验收（5.1，真实对象存储）

`attachment-acceptance.real.spec.ts` 七步在同一个用例里：浏览器编码 → 脱敏门 → 真实
上传 → `listObjects` 核验对象确实存在且字节数一致 → 事件与日志不含 access key /
secret key / 签名 / 内容本体 → `resolveArtifact` 对 sha256 校验后返回原文 → 工作台由
折叠后的投影渲染同一摘要 → 放入一个日志从未命名的对象，孤儿对账真实命中它且不误判
已记录的附件。

**为什么是一个用例而不是七个**：拆开后每一半都令人信服而**接缝不**，而接缝正是这条要
证的东西——离开浏览器编码器的那串字节，与工作台最终展示其已校验摘要的那串字节，中间
隔着一次真实 HTTP 往返和一次真实 fold，必须是同一串。

**记录边界**：任务 5.1 头部写的「依赖 `artifact-ref-handoff` 5.1/7.1 完成」未满足——
那两条要求真实 K3s，本机 `kubectl`/`k3s` 均未安装。附件链路本身不经 Worker，故其全链
在真实存储上是完整的；但「与运行日志外置共用同一条 Worker 侧路径」仍未在集群上验证。

### 一处我自己写错的论证

把 32 MiB 说成「比任何极限低一个数量级」，写进了代码注释、tasks.md 与实施状态三处。
实际是实测可通过值（256 MiB）的 1/8、V8 字符串上限（~512 MiB）的 1/16。**测试先抓出
了它**（32×10 > 256），我改正了论证而不是调松断言——它是写进持久合同的定尺理由，说
错了就等于给将来的人一个错误的安全边界感。

## 2026-09-15 归档两个 change，并推进 dsh-harness-telemetry 的宿主侧（0 → 13/27）

**归档**：`fail-open-closure`（30/30）与 `spec-corpus-corrections`（10/10）。归档后
67 change / 51 spec / 4 活跃；`openspec validate --all --strict` 55/55，且不再有任何
「archive would refuse」提示（此前 `fail-open-closure` 的六份 delta 全部会被拒绝——
Requirement 名在现 spec 中不存在却写成了 MODIFIED；已按校验器判据改为 ADDED）。

**清除一个归档硬阻断**：`dsh-harness-telemetry` 的 delta 只有 `ADDED`，却与既有
`harness-capability-levels` 直接冲突——既有 Scenario 断言 `tool-invocation` /
`verification`「不出现在可证级别集合」，delta 说 `dsh` 的集合「包含」二者。按原形态
归档会让同一份 spec 自相矛盾。改为 MODIFIED 替换那条 Requirement 为按 Harness 判定，
并按校验器要求把原有全部 Scenario 逐条带入，第三方 Harness 上的原有强度逐字不变。

### 已完成（13/27，均为宿主侧，不需集群/镜像/模型）

- **1.1–1.3 可证集合按 Harness 分裂**。两个全局常量改为按 Harness 一份。**今天四个
  Harness 取值完全相同**——交付的是形状与守卫，不是差异。先做形状的理由：那两级并非
  对所有 Harness 同等遥不可及，`dsh` 的适配插件由本仓编写并按 digest 分发，是唯一可能
  上报它们的；全局常量意味着给 `dsh` 授予一个级别就在同一次编辑里授予了所有 Harness，
  而到那时**已经没有可写测试的失败态了**。既有「永不虚报」与「未映射阶段名必须忽略」
  两条守卫改写为 `it.each` 逐 Harness，强度不降低且成为将来那次授予的摩擦。
- **3.1–3.3 verification 级的诚实性**（该 change 自称「关键」）。新增
  `src/harness-verification.ts`。两头造假都堵住：往上——宿主本来就在每次交付上执行
  登记的验证命令，据此点亮是把一方能力算到另一方头上；往下——每个 runner 本来就产出
  CLI 自由格式输出，那正是 `artifact` 的定义。`reconcileVerificationReport` 逐项核对
  Profile 身份、修订、步数、按位置的每步命令身份与每步退出码，**收集全部不符项而非止
  于第一条**。任务要求的「先写冒充实现证明测试能抓住它」两个 canary 都实证过：无条件
  返回 `verification` → 3.1/3.2 用例同时转红；去掉按位置的步身份比对 → 「顺序颠倒」
  用例转红。两次均已还原。
- **0.4 合成 Profile**。两步、顺序敏感（步 1 写标记、步 2 断言并删除）。顺序敏感是
  刻意的——步骤可交换的 Profile 无法区分「按序执行了」与「执行过了」。标记落 `/tmp`
  而非任务工作树（写工作树会表现为 Worker 改动），末步删除故零残留。
- **2.4 结果文档解析**。用量与工具调用是可选字段。缺失（第三方 Harness 今天的文档，
  合法）与畸形（负数/小数/字符串/半填/非对象）经两条路径落到同一答案——不可得，且
  任何一条都不产出数字。补默认值会把没人测量过的数字写进持久记录。测得的 0 仍与
  「不告诉我们」可区分。
- **4.1–4.3 用量维度**。`judged` 使「在预算内」与「根本没判」不再是同一个值；对抗用例
  断言用量为极大值时输出上限与尝试预算的结论逐字不变；默认预算**不含**任何用量上限
  （默认上限会让每个既有运行都被一个没人选过的数字评判）。4.3 的守卫直接扫 `domain.ts`
  断言未新增事件类型且生产者版本仍为 `0.7.0`——比「断言既有会话可写」更强，没有新增
  事件类型，写冻结就无从发生。
- **3.4 / 5.1**：3.4 由逐 Harness 守卫覆盖；5.1 前置已满足且其守卫 17 例全绿。

### 纠正一处误判：`verify:profile:dev` 本机可跑，`agent-skill-composition` 5.1 已通过

先前把该任务记为「`verify:profile:dev` 链路需已安装宿主，本机无」——**前提有误**。该命令
用的是 DSH **源码**（`DSH_SOURCE` 指向兄弟 fork checkout），而那两个 checkout 一直都在
（`../deepseek-harness-pactflow-p0`、`../deepseek-harness-pactflow-upstream-pr`，`CLAUDE.md`
的依赖前提段本来就写明了）。实跑全链通过：install → boot → 重复 add（升级路径，断言 Bundle
层不重复）→ boot → remove → dump-config 无残留 → 干净复启且 `pactflow/health` 返回 404。

并把「skill 行随 preset 卸载」由论证改为核验：`scripts/verify-profile.mjs` 新增
`requireSkillCatalog`，安装后在本次 DSH_HOME 下定位实际安装的 preset 目录，断言
`agent.cordis.yml` 含两行 skill 且 `skills/` 下有目录；remove 后断言该目录整体消失。
**canary 实证**：把 `skills/` 改名为 `skillz/` 后转红，改回后复跑全绿。「没有独立生命周期」
正是一旦有人给它一个生命周期就会立刻失效的那种说法，所以改为每次跑都检查。

边界如实记录：这是**开发通道**证据（脚本自己打印 `not release evidence`），不等于官方发行版
上的安装验收——后者仍受上游 external event producer 能力缺口阻断。

### 又一处误判纠正：真实对象存储验收本机可跑，6 例首次真正执行

`artifact-store.real.spec.ts`（2）与 `artifact-handoff.real.spec.ts`（4）长期计入
「7 个按环境门控跳过」。我先前把它们归为「需真实 RustFS，本机无」——**再次是前提有误**。
Docker 已安装，且实测 Docker Hub 与 quay.io 均可达（不可达的只有私有 Harbor
`192.168.31.200:8080`）。本机起 MinIO 即得到一个真实的 S3 兼容对象存储：

```
docker run -d --name pactflow-minio -p 19000:9000 \
  -e MINIO_ROOT_USER=… -e MINIO_ROOT_PASSWORD=… quay.io/minio/minio:latest server /data
PACTFLOW_REAL_ARTIFACT_ENDPOINT=http://127.0.0.1:19000 \
PACTFLOW_REAL_ARTIFACT_BUCKET=pactflow-acceptance \
PACTFLOW_REAL_ARTIFACT_ACCESS_KEY=… PACTFLOW_REAL_ARTIFACT_SECRET_KEY=… \
pnpm run test:real-artifact
```

走仓库自己的门禁入口（`scripts/run-real-artifact.mjs`，它带 `--passWithNoTests=false`
且对「执行零例」显式报错）：**`6 case(s) executed and passed, 0 skipped`**。观测记录：
`backend versionId present = false`、`ListObjectsV2 prefix listing works, entries=2`。

证据不是"测试说绿"：在容器内直接查 `/data/pactflow-acceptance`，真实对象确实落盘，
层级为 `handoff-<uuid>/<uuid>/{0-execution-log-runner,1-report-host,2-execution-log-worker,
3-report-host}-<hash>/`——手写 SigV4 的 PUT/GET/HEAD/LIST 全程走真实 HTTP 路径。

**但 `artifact-ref-handoff` 的 5.1 与 7.1 仍不勾**：两条都明写「真实 K3s」，而本机
`kubectl`/`k3s` 均未安装。现在真实的是对象存储那一半（SigV4 往返、前缀列举、hash 校验、
ref 解析与绑定约束），Worker 侧「作业结束落盘并上传、结果文档回传尾部+ref」与
「另一 worker/宿主 resolve+校验、Secret 回收、孤儿对账」仍需集群。半条不算一条。

### 第三处误判纠正：附件通道阈值已实测（need-attachments 0.4）

同一形态第三次出现。0.4 记的是「Remote 参数的实际字节天花板需对真实宿主实测，本机无
已安装宿主」——而 `verify:profile:dev` 用兄弟 fork **源码**就能起真实 DSH web profile
并发真实 Remote 调用。新增 `scripts/measure-remote-payload-ceiling.mjs` 复用同一条链路。

方法上两点刻意：载荷是不可压缩随机字节（否则任何一层压缩都会美化结果）；探针骑在
`pactflow/health` 上，该 Remote 忽略参数，**所以任何拒绝都是通道的而非参数校验的**。

实测：1 MiB / 17ms、16 MiB / 193ms、32 MiB / 432ms、64 MiB / 795ms、128 MiB / 1617ms、
**256 MiB / 3110ms，全部通过，零拒绝**。再往上（512 MiB）撞的是 Node 自己的最大字符串
长度 `0x1fffffe8` 字符——V8 对 JSON 序列化的限制，不是通道的字节上限；再探即是在测
探针自己，故阶梯到此为止。

**结论：传输层不构成瓶颈，阈值是策略选择而非传输上限的转述。** 定 32 MiB，三条理由：
延迟（432ms 仍属交互可接受，再高一级已像卡住）；内存（整个载荷在两侧同时驻留，实际
占用是数倍）；**失败形态**——32 MiB 是「实测可通过」的 1/8、结构性极限的 1/16，故越限
一定是我们自己带明确文案的策略拒绝，而不是 V8 的 `Invalid string length`。最后一条最
重要：任务 2.1 承诺「越限在发送前本地拒绝，返回 oversize 码与指引」，只有阈值远离硬
极限时该承诺才成立。

副作用：0.4 解除后 **need-attachments 第 2 节不再被任务 0 阻塞**。

### 把这条教训做成可执行的：`pnpm run probe:readiness`

光写下教训不够——前几次误判正是因为「本机不可执行」是写在文档里的一句话，没有任何东西
会去复查它。`scripts/probe-acceptance-readiness.mjs` 把它变成每次都真跑的探测：

- 逐个**实测**前置（Node 22、DSH 源码 checkout、Docker、公共 registry、S3 端点、kubectl、
  集群、Harbor 基础层、两个凭据、`~/.dsh`），不读任何人工维护的结论；
- 每条验收通道只列**它自己**缺的东西，并在末尾明写「不要由此推断同一 change 的其它任务
  也做不了」——那正是五次误判的错法。

本机当前输出：**1/8 通道可跑**（`verify:profile:dev`），缺口收敛为三样：`DEEPSEEK_API_KEY`、
`PACTFLOW_GITEA_API_TOKEN`、Harbor/K3s 可达。注意脚本刻意标注了两处最容易误判的地方：
`verify:profile:dev` **不需要** `~/.dsh`，真实对象存储验收 **不需要**集群。

### 五次误判的共同形态（本轮最值得记下来的一件事）

本轮把「没有官方发行版宿主 / 没有集群 / 没有镜像」**五次**错当成「这件事做不了」：

1. `verify:profile:dev` —— 用兄弟 fork **源码**即可，不需要已安装宿主，checkout 一直都在；
2. 真实对象存储验收 —— 任意 S3 兼容端点即可，Docker 装着、公共 registry 可达；
3. 附件通道阈值 —— 同 `verify:profile:dev` 链路，起真实宿主发真实 Remote 即可测；
4. `dsh-harness-telemetry` 2.2（runner 验证协议）—— 不需要 DSH 工具执行钩子（那是 2.1/2.3
   依赖的 spike 结论），只需执行已登记 Profile 并如实回报，可单测；
5. `dsh-harness-telemetry` 6.1（能力级别呈现）—— 可证/不可证是**宿主侧声明**，任务 1 完成
   后今天就完整且真实，与 runner 是否上报无关。

**五条都不需要被阻断的那个资源。** 后四次都是在复查前一次误判时才发现的。

共同的错法是**从资源缺失一路推到整节任务**：「没有集群」→「第 2 节做不了」→ 连其中不碰
集群的那条也不做。真正该问的是逐条的「**这一条**具体缺什么」。

教训不是「要更乐观」，而是**「不可执行」本身是一个需要证据的断言，和「已通过」同样需要**。
凡记「本机不可执行」的条目，必须同时记下**是什么具体缺失使它不可执行**（哪个二进制、哪个
端点、哪个凭据、哪条结论未出），否则那句话会变成不会被复查的传闻——这正是它前几次存活
下来的方式。本文件中所有「不可执行」条目已按此要求改写。

### 本机确证不可执行的（未勾选，按规则不得计为通过）

逐项实测而非假设：`~/.dsh` 不存在；`kubectl` / `k3s` / `podman` / `minikube` / `kind`
二进制均未安装；`~/.kube/` 不存在；`DEEPSEEK_API_KEY` / `PACTFLOW_GITEA_API_TOKEN` /
`PACTFLOW_RELAY_IMAGE` / `KUBECONFIG` / `DSH_CLI_ENTRY` /
`PACTFLOW_REAL_ARTIFACT_ENDPOINT` 全未设置。

**Docker 已安装**，但 worker 镜像的基础层在 `192.168.31.200:8080`（Harbor）上，实测
`docker pull` 超时不可达，故 `build:worker-image` 与依赖它的 `test:worker-container`、
`test:worker-interactions` 同样阻断——这一条此前只是推断，现已实测确证。

- `dsh-harness-telemetry` 0.1/0.2/0.3（spike，需按 digest 钉版的镜像且容器内连模型）、
  第 2 节（执行器上报）、第 5 节（镜像重建钉版）、第 7 节（真实 K3s 终验）。
- 第 6 节（界面）**有意等第 2 节**：两条呈现的都是 runner 上报的数据，现在建出来只会
  满屏「不可得」，且它该长什么样取决于第 2 节最终回报的字段形态。宿主侧的判别逻辑已
  就位，呈现层接线时无需再做判别。
- `need-attachments` 第 1 节**有意不单独实施**：新增事件类型会提升生产者声明版本，而
  真正写入它的第 2 节依赖任务 0.4 的阈值实测（需已安装宿主）。结果是每个用户的会话都
  换上一个没有任何写入方的新版本声明。任务 0.4 自己立的规矩是「阈值在实测前不预设」，
  同一条理由适用于词汇表。
- `agent-skill-composition` 3.1–3.4（三个真实模型套件，是该 change 自己写死的合入条件）、
  5.1/6.1（需已安装宿主与真实会话）。
- `artifact-ref-handoff` 5.1/7.1（真实 RustFS + 真实 K3s 全链）。

## 2026-09-15 全仓四路评审与失败关闭收口（fail-open-closure）

上一批评审只覆盖本轮改动；这一批把范围放到 `packages/dsh-pactflow` **全部现有代码**，分四路独立跑：安全与不变量、正确性与边界、测试套件真实强度、文档与合同一致性。交回的高危项形态高度一致——**合同写了失败关闭，实现留了一个放行的口子**，以及**宿主把自己的失败报告成别人的失败**。

对应 OpenSpec change：`fail-open-closure`（Modified: `credential-safe-display`、`git-credential-binding`、`k3s-resource-identity`、`validation-integrity-signals`、`run-budgets`、`gitea-review-gate`）。

**基线：`pnpm run check` 全绿，121 文件 / 953 通过 / 7 跳过 / 25 产物；`openspec validate --all --strict` 56/56。**

### 本机实证的缺陷（逐条，非转述）

1. **脱敏对多行整体放行**。`redactUrlCredentials` 首行 `if (/[\r\n]/.test(value)) return value`。直接 import 真实模块实测：`Command failed: git clone https://user:secret-token@…\nfatal: Authentication failed for '…'` 原样返回，明文凭证保留。而 `boundedOutcome` 是宿主写入事实源的唯一错误文本通道，git/execFile 的 stderr 几乎总是多行——**最常见的一种带凭证文本恰好是唯一不被脱敏的那一种**。既有 `display-redaction.spec.ts` 五条样本全是单行。
2. **向人工审批做出虚假的肯定陈述**。敏感改动 diff 范围 `commit~1..commit` 只看尖端提交；任何计算失败被 `catch { sensitive = [] }`；审批文案随即打印「验证敏感文件改动：无」。同一函数上方的注释原本明写「`none` 是显式陈述，所以列表缺失不会被误认为没有改动」。判定还是整路径全等匹配，实测 `validationSensitiveChanges('packages/dsh-pactflow/package.json\napps/web/vitest.config.ts\npackage.json')` 只返回 `['package.json']`——**本仓自己的子包就在盲区**。
3. **崩溃重启销毁在途执行**。全仓 `phase: 'cleaned'` 只出现在探针路径三处，Run 路径零处；`runLedger.remove` 唯一调用点在启动对账内部、且在按 UID 删除之后。宿主崩溃重启时集群里仍在跑的 Job 被 `gracePeriodSeconds: 0` + Background 强删，并发的 `waitExisting` 随即观测到 missing 判 Run 失败。`probe-recovery.spec.ts` 原有用例只覆盖「有 UID 就删 / 无 UID 不删」，**无一条断言在途不得删**。
4. **清理责任被静默删除**。三个账本单条记录不合法走 `continue`，而 `persist()` 是全量覆盖——跳过即永久删除，日志零提示；`load()` 用 `loaded ??=` 永久缓存 + 全量覆盖，两进程共用同一 `DSH_HOME` 时后写者抹掉前者记录且任何对账都发现不了；`withWorkspaceFileLock` 全仓只保护 `workspace-projects.json` 一个文件；`this.writes.then(cb)` 在一次写失败后永久毒化整条链。
5. **模型可指名任意 Secret 与任意凭证**。`k3s_git_secret_name` 与 `credential_ref` 都是模型可调工具上的自由字符串；前者只校验 K8s 名称形状（`pactflow-git-` 前缀只是列举端点的 UI 过滤），后者只校验 `configured`。
6. **凭证绑定失败关闭被无关条件把门**。`gitProviders.length > 0` 才检查——空 registry 正是升级后的常见初始态。实测：清空 registry 后 `verifyGitea` 不再拒绝，直接去连服务端。
7. **宿主算术错误被报成别人的故障**。`boundOutputToBudget` 实测中文 1500–1699 字、预算 4096：**200/200 全部越限，恒为 4098 字节**；`git rev-list` 与验证命令的 1 MiB 上限实测双双溢出（4 MiB 输出下 `git show` 报「Git command failed」、`node -e` 打印 4 MiB 后被报成「validation command failed (exit unavailable)」）；`HARNESS_TIMEOUT_SECONDS` 对 15 秒探针得到 `max(1, -15)` = 1 秒。
8. **拒绝结论被吞掉**。挂机驱动不检查 `recheckReviewGate` 返回值，而拒绝时 `recordReviewGateObservation` 保留的是旧 `lastGap`。
9. **按名删除的潜伏分支**。`cancel()` 的 `jobUid === undefined` 分支按可重用名删三个子资源（无 `preconditions`）且以 `!isNotFound && !isTimeout` 吞掉删除超时。当前三个调用点都带 UID 使其不可达。
10. **日常内循环对 `src/index.ts` 完全空转**。50 个 spec 导入 `lib/` 产物而 `pnpm test` 不构建、无新鲜度守卫。**探针实证**：在 `initialize()` 首行注入 `throw new Error("SABOTAGE")` 后，`domain.spec.ts` 19 例仍 19 passed。

### 处置

全部修复，每条先写复现用例确认红再改实现。新增测试文件八个：`validation-sensitive-scan`、`git-secret-ownership`、`k3s-artifact-secret`、`ledger-durability`、`git-output-budget`、`k3s-budget-arithmetic`、`build-freshness`，以及 `display-redaction` 的三条多行反例。

两处**既有用例断言的正是缺陷本身**，按「不得削弱断言换绿」的相反方向处理——改写并在注释中写明它此前断言了什么、为什么那是错的：
- `probe-ledger.spec.ts` 的「skips structurally invalid rows」→ 拒绝加载（其中「不为缺 UID 的记录编造 secretUid」那半保留）；
- `domain.spec.ts` 中在无 infrastructure 下绑定显式 Gitea 端点的用例 → 登记其所指名的 Provider，其余覆盖不变。

### 行为可见变化（升级需知）

- 空 registry 下的历史 Gitea 绑定由「放行」变为「拒绝并要求重新确认 Provider」；
- 不在 `pactflow-git-` 前缀内的 Git Secret 名由「接受」变为「拒绝」；
- monorepo 子包命中的验证敏感改动由「不报」变为「上报」；
- `pnpm test` 在产物比源码旧时由「全绿」变为「红」。

### spec 语料库与代码相反的四条（已立项 `spec-corpus-corrections` 更正正文）

评审第四路逐条比对 51 份 spec 与代码，发现四处**spec 正文与已交付且经评审的代码相反**。每条都先判定哪一侧承载错误，判据是「哪一侧被真实执行时会造成损害」，结论四条全是 spec 错：

1. `gitea-review-gate` 要求复查节奏「取既有运行时合同」——但 `run-time-contracts` 管的是 K3s 租约与 Job 墙钟，与 API 轮询节奏无关，没有可继承的合同。归档 change 的 `tasks.md` 2.3 当时已记录前提有误，正文未回写。
2. 同一能力的「Agent 面与 Worker MUST NOT 触发合并」比它**自己的 Scenario** 宽（Scenario 限定在等待态期间），无条件表述会把有人工批准背书的正常收口也判为违规。
3. `node-rerun-authorization` 要求 attempt 上限耗尽时进入持久 `paused`。重跑的前态是 `succeeded`，写 `paused` 等于为拒绝一次操作而摧毁交付终态且不可逆——这正是上一轮评审抓出的高危缺陷，代码已改为只拒绝不改状态。`retryNode` 能这么做是因为其前态是 `failed`；旧表述是照搬。
4. `failure-scene-retention-policy` 内部两条 Requirement 互斥（一条要求查询报告三项容量字段，另一条要求「只返回保留总数与超期清单」），现网实现必然违反其一。

### 需用户裁决（未单方面处置）

`node-rerun-authorization` 要求以 **Git 祖先链查询**判定「该节点提交是否已合并入受保护默认分支」，并在查询不可得时失败关闭并指名「无法判定是否已合并」。代码实际只查本地投影 `delivery.releases[needId]` 是否存在，无祖先链查询、无「无法判定」分支——投影缺失（冷恢复、跨需求分支、release 事件未落账）即**放行**。

两侧各有理据：按 spec 实现要在同步只读 Remote 路径里引入远端 Git 查询，是实打实的设计变更；按代码改 spec 则是降级一条已写下的失败关闭要求，且残余风险真实（一个已合并的节点可能被重跑）。**属目标本身的裁决，已在 `spec-corpus-corrections` 的 proposal 中提请，未在本批处置。**

### 评审提出但未在本批处置的（如实记录）

- **文档与合同一致性一路**交回的 7 条高危、13 条中危绝大多数尚未处置：`CURRENT_STATUS` 把三个已归档 change 仍标为活跃、§1 与 §3/§4 三处自相矛盾、`development-plan` 保留了已被架构 §6 推翻的「决策 1 选 B」、`dsh-harness-telemetry` 的 delta spec 只有 `ADDED` 却与既有 `harness-capability-levels` 硬冲突（**归档前必须处置**）、`node-rerun-authorization` 与 `gitea-review-gate` 各有两条 spec 与代码相反、`README` 11 条失效链接、三份状态文档基线数字两两不一致、`verification-label` 是死代码但两处文档称已接线、`openspec-spec-hygiene` 守卫能力远低于其宣称。
- 代码侧未处置：`comment-added` 去重只覆盖最近 20 条、`readComments` 全量扫描性能、`pullRequestGateState` 评审列表不翻页、`cancelReviewGate` 无客户端入口、`pactflowDelivery` 未升 `stateVersion`、`observe()`/`terminalObservation()` 无请求超时、租约过期时 `settleRunInSession` 抛错而非结算、`worker-interactions` 单条消息异常即永久关链、logTail 按字符截断按字节校验。

## 2026-09-15 四路独立评审与处置（本轮收尾）

对本轮 24 个提交、86 文件、6602 行做了四路独立评审（领域与 fold / 宿主服务 / 测试与守卫强度 / 客户端与合同一致性）。**评审真的跑了 canary**，抓出的问题比我自查多得多，其中三条守卫被证明是零防护。

### 已修复的高严重度缺陷（四条，均为本轮引入）

1. **`markStaleSuccessors` 会让运行中的下游永久无法落账**。给 `running`/`claimed` 后继打过期标记时推进了其 revision，而 `settleRunInSession` 拒绝 `currentNode.revision !== currentRun.nodeRevision` 的结果——下游会被一个纯信息性的标记**卡死在半途**。更讽刺的是我自己的 spec 写的是「running 的下游在其结果落账时被标记」，实现却是立刻标记。**修**：只标记 `succeeded` 后继；running/claimed 的在自己结果落账那一刻由 `settleRunInSession` 末尾的自检补上（此时 Run 已终态，推进 revision 无害）。**canary 实证**：恢复旧行为后新用例转红。
2. **`rerunNode` 预算耗尽会把已成功节点改成 `paused`**，等于**为了拒绝一次操作而摧毁交付终态**——且没有任何路径能把 `succeeded` 放回去，一次点击就让整个需求永远无法收口。我照抄了 `retryNode` 的写法，却没意识到它的前态是 `failed`（改成 paused 无损），而这里是 `succeeded`。**修**：只拒绝，不改动任何状态；预算也进 `rerunRefusal`，让 preview 先行告知而不是点下去才出事。
3. **`planRerunsSucceededNode` 误伤所有增量方案**。`validateExecutionPlan` **要求**方案必须包含该需求下每一个既有节点，所以只要有一个节点成功过，任何后续方案必然命中——挂机从此再也选不了方案。而它防的威胁根本不存在：`materializePlanReview` 的 `create` 对已存在节点直接 return，方案确认**结构上无法重跑**任何节点。**修**：移除该守卫，改为结构性论证 + 行为测试（批准含已成功节点的方案后，该节点 state/revision/Run 数全不变）。
4. **挂机等待外部评审时每秒追加一条 `autopilot-updated` 事件**。驱动每秒一跳而评审者以小时计，等于每小时 3600 条事件写进唯一事实源，且 autopilot revision 每秒变动使任何携带 `expectedRevision` 的并发调用必然 CAS 失败。**修**：仅在 reason 真的变化时落账。

### 已修复的零防护守卫（三条）

- **`review-gate-boundary` 的「不得提交评审、不得改分支保护」完全空转**：我用单行正则要求 URL 与 `method: 'POST'` 出现在同一行，而本仓写法是分两行——**该正则永远不可能命中**。评审注入了一个向 `/pulls/N/reviews` POST 批准票的方法，8 项全绿。这是本轮唯一自称「adversarial guard」的边界守卫，实际零防护。**修**：改为行为断言（真实客户端 + recordingFetch，断言读门全程零写请求）+ 写请求总数封顶为 3 并逐一列名。**同一 canary 现在转红**。
- **「核验实现唯一」靠 `this.gitea.mergePullRequest` 字面量计数**：`const gitea = this.gitea` 别名即可逃逸，把合并搬进 `src/host/*.ts` 也能逃（扫描范围只有 `index.ts`）。**修**：扫描扩到整个宿主面含 `src/host/*.ts`，改为统计 `mergePullRequest(` 总出现次数。
- **skill 的实际可加载性无人守卫**：把 `skills/` 改成 `skillz/` 指向不存在的目录，`preset.spec` 仍全绿——此时 persona 还在指挥模型去加载六个不存在的 skill，而 persona 正是那 66% 被迁出内容的唯一取回通道。**修**：在 `agent-skill-composition.spec.ts` 用**真实注册表 + 真实文件系统提供方**驱动发现，断言六个 skill 全部解析出来且描述非空。**canary 实证**：目录指错即转红。
  - 附带发现：`preset.spec.ts` 的 `fs` 桩只有 `sandboxMode`，而 skill 提供方在存在 `ctx.fs` 时**经它读 SKILL.md**，于是目录恒空。这解释了为什么可加载性断言不能放在那个夹具里，落点因此改到独立测试。

### 其它已修

- 红线反向检查曾是**恒真**（`if (element.test(body))` 包住一条循环外已无条件执行过的断言），改为可证伪形式并加自证用例；红线自证从「只模拟删一条」改为**逐条**（否则把另外四条的正则弱化成 `/./` 不会被发现）。
- `typecheck` 守卫只验「所列工程有 source」，删掉 client 工程仍绿；补「必须覆盖 host 与 client 两面」。

### 评审提出但**未处置**的（如实记录，非缺陷即说明理由）

- `counters` 在「主体数量」维度无界并整体进快照（中）、`comment-added` 去重只覆盖最近 20 条（中低，当前生产路径不可达）、`evaluateReviewGate` 不校验 PR 号身份（中，当前两个调用点都传对）、`reviewGate` 合并成功后不清除导致复查诬告（中）、`readComments` 全量扫描的性能（中）、`pullRequestGateState` 评审列表不翻页（中）、`cancelReviewGate` 无客户端入口（中）、客户端三个新组件绕开 overlay 既有取消/代次防护（中）、`pactflowDelivery` 未升 `stateVersion`（中）、persona 收缩丢了「交付请求起手式」（中）。
- **这些都是真问题**，但都不是「会造成错误交付」的那一类；本轮已到收尾，逐条处置留作下一批。它们已在此登记，不得因为没写进 tasks.md 就消失。
- 一条系统性隐患：测试 `import '../lib/index.js'`（构建产物），只跑 `pnpm test` 而不 build 会拿到旧代码的绿。`pnpm run check` 含 build 所以门禁安全，但本地「先失败后通过」会有假阴性。
- 验证：`pnpm run check` **exit 0** —— **114 文件 / 901 用例（894 通过 / 7 环境门控跳过 / 0 失败）**，`pack:check` 25 必需产物。

## 2026-09-15 Agent Skill 组合（change `agent-skill-composition`，17/23 任务完成，**persona 收缩未取得合入门**、未归档）

当前阶段：六个随包 skill、preset 挂载、persona 收缩、红线守卫、文档单一来源迁移全部落地，全量门禁全绿，**真实挂载审计通过**。但按本 change 自己写死的合入条件，**收缩尚不得视为完成**——见下。

- **任务 0 核实（对 fork）**：三包齐备，且发行版自带的 `cordis` preset 就是可照抄的参考实现——skill 行由 preset 自己的 `agent.cordis.yml` 挂载（**不是** `cordis.patch.yml`），`customSkillDirs` 以 `baseUrl` 解析 preset 目录。**与立项设想不同**：原以为要照搬 `pactflowPresetRoot` 造一个宿主侧 root provider，实际不需要——skill **注册表**留宿主面，preset 只挂提供方（`skill-filesystem`）与加载工具（`tool-skill`）；宿主 profile 里这两行被 `disabled: true`，注释写明「presets own local discovery」。
- **Workflow Consumer 经评审砍掉**，理由已记入 proposal 防日后重提：脚本能做的只剩「多发几次 dispatch」，而模型并行调工具就能做到；且它与宿主持久的 `need-autopilot` 是两个编排器，DSH 自己声明 workflow 的 worker thread「只是隔离，不是安全边界」。
- **persona 划分表**：留下的五条红线——只读编排器身份、不得自批准或伪造人工批准、不得直接改共享工作区、任何执行代理调度前必经方案确认、Worker 职责与边界。迁出的六段——执行方案拆分判据、Worker 数量语义、本地恢复候选比对、挂机授权边界、收口三层门禁、七类资源登记。**净增两段**——异常速查、等待外部评审时不要手工合并。
- **收益实测（非估计）**：persona 文本 **4676 → 1603 字节，减少 66%**。这部分此前每一轮都常驻系统提示，包括一个只是「看看进度」的只读问答。
- 划分判据只有一条：**这条内容如果模型没主动加载就会出事吗？** 会出事的留 persona（「不得自批准」），不会的进 skill（「单节点优先」——不合理的拆分仍要过人工方案选择）。这条判据同时定义了最危险的失败模式：把红线挪进按需加载的 skill，就把硬约束降级成「模型记得加载才生效」。守卫因此**双向检查**，并含一条「删掉一条红线后守卫必须转红」的自证用例。
- 守卫按**结构化红线清单 + 逐条关键约束要素**检查，不是整串比对（那会让每次文案润色都红，最终导致守卫被放宽或删除），也不是「非空即过」。
- **文档单一来源**：`docs/business-logic-业务逻辑.md` 的 §6 / §2.1 / §9 三节正文迁入对应 skill，原位改为指向；守卫断言这三节只指向、不复制。理由是这三段既要给人读也要按需喂模型，两份可独立编辑的正文必然漂移。
- **真实挂载审计通过**：`preset.spec.ts` 在真实 `agent-presets` 组合里挂起 preset，两行 skill 激活，`skill` 加载工具出现在 Agent 工具面（工具数 18→19）。审计过程中真实拦截两次——先是两包未声明依赖（「cannot be resolved」），补 link + peer 后又是「waiting for skills」，才发现注册表在宿主面、测试夹具需补 `SkillRegistry`。
- `pack:check` 也真实拦截一次：三个 in-box peer 必须声明为 **optional**，否则公开安装会强求单独安装。必需产物 **19 → 25**（六个 SKILL.md 入清单——tarball 缺它们就等于发出一个指向加载不到的指令的 persona）。
- **未完成，且按本 change 自己的合同不得视为完成**：任务 3.1–3.4 要求 persona 收缩后重跑 `test:real-worker` / `test:autopilot` / `test:worker-interactions` 三个真实模型套件并全部通过，**任一未通过则收缩不合入**。三者都需真实模型额度与真实集群，本机不可达，**因此未跑**。收缩改动已提交但**该 change 不得归档**，直到三个套件真实通过。另 5.1（remove 后无残留）与 6.1（真实会话中按需加载 / `/name` 调用）同因未跑。
- 验证：`pnpm run check` **exit 0** —— **114 文件 / 893 用例（886 通过 / 7 环境门控跳过 / 0 失败）**，`pack:check` 25 必需产物；`openspec validate --all --strict` 56/56。

## 2026-09-15 已成功节点重跑（change `node-rerun-authorization`，21/25 任务完成，真实端到端未跑、未归档）

当前阶段：fold 授权、重跑入口、五条失败关闭、过期检测接入、下游标记、挂机排除与界面全部落地并通过全量门禁。**剩 4 项**：7.1/7.2 真实端到端与真实挂机对照，5.1 收口漂移序列的夹具未写。归档待用户授权。

- **用户 2026-09-15 推翻 2026-09-11「保持现状」裁决**，架构 §3 终局能力 4 措辞相应修订为「**未经所有者显式授权的**终态复活在事件折叠层被拒绝」（提交 `1559e16`）。
- 实现中的事实更正：立项 proposal 称过期检测「交付即死码、零生产调用点」——**不准确**。`@Remote('staleCodeInputs')` 一直存在，只是**客户端与 Agent 面都不调用**，且它报告的情形本来也无法处置。现在 `rerunPreview` 是它的首个真实生产消费者。
- **fold 层此前根本没有终态复活判定**：拒绝只在服务层的 `retryNode`（`cannot retry from state succeeded`）。本 change 把判定下沉到 fold——离开 `succeeded`（`archived` 除外）必须携带事件内持久的 `rerunAuthorization`，且其 `fromRevision`/`priorState` 须与被授权的状态吻合。授权证据**在事件里而非调用时的内存标志**，否则冷恢复重放无法复现判定、投影就不再是纯 fold。因此这条改动让 fold 比原来更强，而不是更弱。
- 五条失败关闭：活跃 Run / `archived` / `paused` / 需求处于 `closing` 或 `deployed` / **已产生交付记录**。最后一条的实现与立项设想不同：改用**已落账的 release 记录**判定，而非临时祖先链查询——release 是持久事实，不存在「查询失败」路径，因而从设计上就没有失败开放的口子（原任务 2.5 的假设前提随之消失，以更强形式满足）。
- 下游**只标记不级联**：运行落账产生新提交时标记所有消费它的后继（含正在 `running`/`claimed` 的，它们消费的也是旧输入），后继保持 `succeeded`、不派发、不新建 Run。级联会把一次人的决定放大成 N 次无人决定的执行，而「上游这次改动要不要紧」——一次注释修改和一次接口签名变更在这里长得一模一样——只有人能判断。
- **挂机排除**：`planRerunsSucceededNode` 使含已成功节点的推荐方案不被挂机自动选中，转为交人显式选择并持久报告。不排除的话，模型推荐含重跑的方案 → 挂机自动选中 → 重跑被授权，**全程没有人**，本 change 最核心的约束会被既有挂机合同直接打穿；还会形成「重跑 → 下游过期 → 重跑下游」的预算黑洞。
- 预算：重跑计入**同一** attempt 上限（不另起计数），超限进入既有持久 `paused`。
- 界面：工作台进展页新增「重跑已成功节点」区——先「查看重跑影响」（展示依赖/分支/上次提交/当前提交四项与不可解析项），**看过影响后才出现「授权重跑」**，非默认勾选；节点行标出输入已过期。
- 测试 `node-rerun.spec.ts` **19 项，全程真实 Git 与真实派发**——代码输入只存在于真正跑过的 Run 上，手搓夹具只能测形状测不到行为。含 fold 三条、入口四条、失败关闭四条、过期检测三条、下游标记三条、模型不可达两条。
- 验证：`pnpm run check` **exit 0** —— **113 文件 / 872 用例（865 通过 / 7 环境门控跳过 / 0 失败）**，`pack:check` 19 产物；`openspec validate --all --strict` 56/56。
- 文档同步：`CURRENT_STATUS` 的 `code-input-staleness` 由 **partial（触发路径不可达）** 改为 passed；待办清单第 16 条关闭。

## 2026-09-15 受保护分支收口等待态（change `gitea-review-gate-closure`，21/24 任务完成，真实受保护仓库验收未跑、未归档）

当前阶段：等待态、复查、挂机交互、权限边界与界面全部落地并通过全量门禁。**剩 3 项**：6.1/6.2/6.3 真实受保护仓库端到端（需真实 CI + 真人点批准），以及 3.3 的宿主级三条（需 closing.spec 的本地 Gitea 桩夹具）。归档待用户授权。

- 修复的洞：`closeGitNeed` 此前在 `requiredApprovals > 0 || statusChecks.length > 0` 时直接抛 `cannot auto-merge`，把合并推给人到网页手工完成——而手工合并产生的交付终态**宿主从未核验**：祖先链没核、任务集合是否精确对应本次基线没核、清理责任没先于交付记录持久化。required approvals 与 CI 检查正是受保护分支的常规配置，**这意味着仓库一开分支保护，架构 §4 最强的那条保证就自动失效**。
- 形态：抛错改为**持久等待态**，需求停在 `closing`，宿主保留收口责任。等待态经**既有收口清理记录的可选字段**表达——不新增事件类型、不升生产者版本。
- **「核验实现唯一」是结构性的**：复查在门齐备后**直接重新调用 `closeGitNeed`**（收口本就幂等，复用既有 closing/PR/release），因此不存在第二份合并与复验实现。守卫断言 `mergePullRequest` 与 `revalidateMergeCommit` 各只有一处调用点，且 `recheckReviewGate` 体内不含二者。
- 判定层 `src/review-gate.ts`（纯模块，脱离 ctx 可测）：四条失败关闭（head 漂移 / base 变更 / 需求 revision 漂移 / 检查由成功转失败）+ 外部合并 + 就绪 + 等待。**「从未绿过的检查首次失败」不算回归**（CI 可重跑，等待继续且失败可见），只有 success→failure 需要人。第五条「任务集合不符」由重入收口时的既有摘要校验执行。
- **立项前提修正**：tasks 2.3 原写「间隔与最大次数取既有 `run-time-contracts` 合同」——该合同管的是 K3s 租约与 Job 墙钟，**不含复查节奏，前提有误**。改为自有有界合同：间隔 30s × 上限 40 次（约 20 分钟无人值守，匹配 CI 时长且不刷 API）。耗尽只停自动化，授权与等待态都保留，人可手动复查。
- 挂机（`need-autopilot` 修改面）：等待态对挂机是「等待外部人与 CI」——**不计入连续无有效进展、不唤醒模型、不调 `block_autopilot`**。不处理的话，不变的进展摘要会累积 `stalledTurns` 直到挂机误报「无可验证进展」，且每 tick 唤醒模型去看一个只有评审者能推动的需求，把模型步数预算花在它答不了的问题上。**canary 实证**：移除该处理后 8 项中 6 项转红。外部手工合并→挂机阻塞而非完成。
- 权限边界（对抗性守卫）：门状态读取全程 GET，请求面不含 approve/review 提交、分支保护修改、强制合并或 CI 触发；`force_merge: false` 钉死；**Agent 工具面完全不暴露评审门入口**（比「只能复查」更强）。批准计数按人取最新一条决定，忽略 stale/dismissed/comment-only——先批准后要求修改的人不再计入。**必需检查无状态上报 = pending，不是缺席**：沉默不是成功。
- 收敛 `mergePullRequest` 重试：受保护分支下 405 `not ready to be merged` 是「门未满足」，重试无意义且会变成不断敲打分支保护的循环——改为失败关闭，由等待态处理。单测断言只尝试一次。
- 既有守卫拦截并修正一处设计：清理记录的「身份不可变」守卫拒绝了等待态更新，据此明确 `reviewGate` 是**随复查推进的可变观测注解**（与 `retainUntil`/`sizeBytes` 同类），不属资源身份。
- 取消：新增 `cancelReviewGate` 撤销等待态，**PR 不被自动关闭**——它是他人可见的外部对象，编号仍可从日志查到。
- 界面：工作台「验收交付」页呈现等待态、PR 引用、逐项缺口与复查按钮；文案明说「不需要你到网页上手工合并」，外部合并时明说「尚未产生交付终态」。
- 新增测试 4 个文件共 **50 项**：`review-gate`（27，判定/间隔/唯一性守卫）、`review-gate-boundary`（8，权限边界与 Gitea 读取语义）、`review-gate-persistence`（7，真实服务重放与取消）、`autopilot-review-gate`（8，挂机交互）+ 工作台界面（5）。
- 验证：`pnpm run check` **exit 0** —— **112 文件 / 849 用例（842 通过 / 7 环境门控跳过 / 0 失败）**，`pack:check` 19 产物；`openspec validate --all --strict` 56/56。

## 2026-09-15 需求级评论（change `need-comment-threads`，14/15 任务完成，真实会话验证未跑、未归档）

当前阶段：评论的事件、投影、宿主入口、Agent 工具与工作台讨论区全部落地并通过全量门禁。**仅剩任务 5.1 真实会话验证**（需真实 DSH 会话中人与模型各发一条），归档待用户授权。

- 事件与版本：新增 `pactflow/comment-added` 与 `pactflow/comment-voided`；`PACTFLOW_EVENT_TYPES_V0_7` **逐条字面列出 21 类**（不由 V0_6 推导）；生产者 `0.6.0 → 0.7.0`，补 `0.6.0` 只读注册（现 0.1.0–0.6.0 六个）。运维手册计数与 `ops-doc-event-count` 守卫同步至 21/19/19。
- **老会话可写性（任务 1.3）真实验证**：`producer-upgrade.spec.ts` 用真实 `SessionStore` 造出已持久化 `0.6.0` 声明的会话，再以 `0.7.0` 句柄写入 `comment-added` —— 成功，且日志追加升级后声明（`['0.6.0','0.7.0']`）。**两条对抗路径同验**：词汇窄化（丢一个类型）与版本降级均如实抛 `conflicting declaration`，证明测试确实在驱动升级门而非一个什么都放行的运行时。**边界如实标注**：这是对 fork 验证的，上游 PR 未合并，属工作假设。
- 投影：独立 `pactflowCollaboration` 单元，只存**每主体计数 + 每需求有界尾部 20 条摘要**，正文经 `@Remote('listComments')` 分页。注入 100 条后尾部仍为 20、计数仍为 100；测试断言常驻投影的序列化结果**不含正文**。作废以追加事件就地标记，原文不动；计数只由 `comment-added` 推动，故对已移出尾部的评论的作废是无害 no-op —— 若要在 fold 里证明其存在，需要一份「每个写过的 id」索引，那正是这个投影要避免的无界增长；存在性改在写入边界（`voidComment` 读全量日志）校验。
- 作者身份由**入口**决定：`@Remote('addComment')` = human，`appendAgentComment()` = agent。**参数里根本没有 author 字段**；测试传 `author: 'human'` 给 agent 入口，落账仍为 `agent`。
- 预算：`run-budget.ts` 新增 `maxAgentCommentsPerSubject`（默认 20，单一权威不另造硬编码）+ `evaluateAgentCommentBudget`。人不受该预算约束；每个主体（need/node/run）各自计数。正文长度沿用 `maxOutputBytes`。
- Agent 面：新增 `pactflow_add_comment`（工具描述明写「授权 NOTHING，绝不用于请求或声称批准」）；`pactflow_view` 快照新增 `discussion`，**每条带 `source: 'pactflow-comment'` 与作者类别**，已作废条目完全不进模型上下文。`pactFlowDiscussionView` 拆到 `src/discussion-view.ts` 以便宿主与客户端共用一份实现（domain.ts 带 zod，不进浏览器包）。
- 客户端：工作台进展页新增「讨论」区——作者标签、时间、正文、发表框、逐条作废、「查看全部（含已作废）」分页。`discussion` 声明为**可选字段**且组件做防御：该字段跨 Remote 边界，升级期间客户端可能配到尚无此字段的宿主，缺失时进展页照常渲染（有专门用例）。
- 新增测试 4 个文件共 **57 项**：`comment-threads`（19，领域/fold）、`comment-host`（17，真实服务集成）、`producer-upgrade`（4，升级通道）、`session-workbench-view` 讨论区（5）+ 既有夹具更新。
- 验证：`pnpm run check` **exit 0** —— **108 文件 / 794 用例（787 通过 / 7 环境门控跳过 / 0 失败）**，`pack:check` 19 产物；`openspec validate --all --strict` 56/56。
- 三处守卫如实拦截了本批改动并被逐一处置：`release-manifest-accuracy`（清单 `hostEventProducerVersion` 未随 0.7.0 同步 —— 判断**无需重建镜像**，worker 从不写 Session Event，该字段是宿主侧记录）、`ops-doc-event-count`（手册计数）、`domain`/`preset`（工具清单与生产者版本）。

## 2026-09-15 分发清单版本守卫（change `manifest-producer-version-guard`，已实施、未归档）

当前阶段：七个新立项 change 的第一个，按 tasks 全部完成并通过全量门禁。**归档待用户授权。**

- 缺陷事实：`worker/dsh/release-manifest.json` 声明 `hostEventProducerVersion: "0.5.0"`，而宿主实际注册 `0.6.0`。Git 历史定位——`1594fa5` 在同一提交把常量从 `0.3.0` 改为 `0.6.0` 并写入清单 `0.5.0`（即**自引入起就是错的**，不是曾对过后漂移）；`3146903` 刷新镜像 digest 与 `adapterVersion` 时也未连带更新。全仓库仅该 JSON 自身出现该键，**无任何测试或脚本校验**。
- 改数字的证据基础（非新证据主张）：当前 digest 镜像推送于 `3146903`，其时代码已是 `0.6.0`，其后的 `test:worker-container` 与集群内 Pod 验收均在 `0.6.0` 宿主下完成——即该镜像**本就是**在 `0.6.0` 下构建并验收的，修正清单是纠正记录错误。据此撤销首版 design 中「先钉版再改数字」的排序顾虑。
- 实施：① `EVENT_PRODUCER_VERSION` 迁至 `src/domain.ts` 并更名 `PACTFLOW_EVENT_PRODUCER_VERSION`，`src/index.ts` 改为导入——迁移原因是单测**不以模块方式 import `src/index.ts`**（默认 vitest 无标准装饰器转换），常量留在服务类文件里则守卫读不到；② 新增 `tests/release-manifest-accuracy.spec.ts`，失败消息指名两侧具体取值；③ 清单修正为 `0.6.0`。
- **先失败后通过**：守卫首次运行如实报红——`release-manifest.json declares hostEventProducerVersion "0.5.0" but the host registers "0.6.0"`，修正后转绿。
- 实施中扩展（spec 已同步）：发现同族字段 `hostPluginVersion` 属同一类（对应插件包版本，当前值正确），一并绑定以防未来漂移；spec Requirement 相应由「宿主事件生产者版本」扩展为「与代码事实一一对应的版本字段」，并显式排除镜像自身标识字段（digest / `adapterVersion` / `dshVersion` / `protocol`）——它们由构建钉版产生，不存在「代码里的另一份」可供比对。
- 验证：`pnpm run typecheck` 干净；`pnpm run check` **exit 0**——`pnpm test` **105 文件 / 747 用例（740 通过 / 7 环境门控跳过 / 0 失败）**（较本批前 +1 文件 +2 用例）、`pack:check` 19 必需产物；`openspec validate --all --strict` **56/56**。
- 边界：不动镜像、不动 `adapterVersion` / `dshVersion` / 协议版本、不动其它字段——那些归 `dsh-harness-telemetry`。该 change 升 `adapterVersion` 重新钉版前以本 change 归档为前置。

## 2026-09-15 功能对照 → 七个 change 立项（经独立架构评审修订）+ 架构 §3.4 措辞裁决

当前阶段：按用户要求以功能维度对照计划 §4–§10 七个里程碑与代码，列出未完成功能后立项；经一轮以独立架构师视角的自评审，按评审意见修订后全部通过 `openspec validate --all --strict`（56/56：48 spec + 8 change）。**本批只新增 `openspec/changes/` 与文档，`src/`、`scripts/` 零改动。**

- 功能对照结论（已验证）：主链路（需求→十阶段→DAG→派发→真实提交→验证→受保护分支合并）完整且真实跑通过；未完成功能集中在协作层与 Agent 组合富度。核对中撤回一条误判——移动端适配**已完成**（`pactflow-overlay.e2e.spec.ts:535` 在 390×844 下覆盖浮层/工作台/项目面板/验证编辑器），此前沿用了 2026-09-11 待办清单的过时表述。
- 用户裁决（2026-09-15）：① 推翻 2026-09-11「成功节点不重跑」裁决，立项做重跑；② token 用量与 Harness 两级探针按 `dsh` 镜像可证范围立项；③ 评论+附件 / Gitea 待审闭环 / Agent Skill 三项一起立。
- 立项七个 change（首版五个，评审后拆一合零砍一增一）：`need-comment-threads`（评论）、`need-attachments`（附件，等 `artifact-ref-handoff` 5.1/7.1）、`gitea-review-gate-closure`（受保护分支等待态，Modified `git-closing-integrity` + `need-autopilot`）、`node-rerun-authorization`（所有者授权重跑，Modified `code-input-staleness` + `need-autopilot`）、`agent-skill-composition`（Skill 随包分发，**Workflow Consumer 经评审砍掉**——与宿主持久的 `need-autopilot` 是两个编排器且 DSH 自认不是安全边界，等具体用例）、`dsh-harness-telemetry`（按 Harness 分裂可证集合，任务 0 为可行性 spike）、`manifest-producer-version-guard`（`hostEventProducerVersion` 漂移修复从 telemetry 拆出，半小时可归档）。合计 139 条任务，8 个活跃 change。
- 评审修订要点：附件先评估 DSH 原生 `attachment`（图片专用，不承载通用附件，但浏览器→宿主传输层原生现成）；挂机不得自动授权重跑（排除而非纳入）；等待态对挂机是「等待外部人与 CI」不计无效进展；`verification` 级定义为多步顺序敏感绑定 Profile 的逐步报告，补「往下冒充」守卫；persona 收缩以三个真实模型套件为合入门；评论带作者标记进模型上下文、agent 评论计数预算、只作废不删除。
- **架构 §3 终局能力 4 措辞修订（用户裁决 2026-09-15）**：「终态复活」→「未经所有者显式授权的终态复活」。这是有意削弱不变量，补偿为所有者显式授权（排除一切自动路径含挂机）、历史 Run 全保留、下游只标记不级联；`node-rerun-authorization` 任务 0.1 据此解锁。
- 未决：架构 §6 决策 1 的「`confirm-execution-granularity` 当前尚未归档」表述已过时（2026-09-13 已归档），修订提案已出，待用户确认后修改。
- 验证：`openspec validate --all --strict` 56/56；`openspec-spec-hygiene` / `ops-doc-event-count` 守卫全绿；旧 change 名残留 0 处。

## 2026-09-15 目标↔实现三方对账 + 当前状态视图同步（文档批次，无代码改动）

当前阶段：按用户要求通读目标架构（§3 十条终局能力 / §4 四类不变量 / §7 完成的定义）、48 份 spec、61 个归档 change、活跃 change 与实施状态，并与代码、npm registry 实测对账。**本批只改文档，`src/`、`scripts/`、`openspec/` 零改动。**

- 实测基线（本批重新采集，非引用历史）：分支 `main`，HEAD `f8fddaf`；`pnpm exec vitest run packages/dsh-pactflow/tests --maxWorkers=1` = **104 文件 / 745 用例 / 229 套件，738 通过 / 7 环境门控跳过 / 0 失败**；`openspec validate --all --strict` **49/49**（48 spec / 61 归档 change / 1 活跃 change）。7 个跳过全部来自未武装的真实存储套件（`artifact-store.real` 2、`artifact-handoff.real` 4）与 1 项平台门控预检，**按规则不计为通过**。
- **上游阻断复查（新证据）**：npm registry 查 `@deepseek-ai/dsh` —— `latest = 0.1.5-rc.1`、`next = 0.1.5-rc.2`，与 2026-09-11 实证缺 `sessions.externalEventProducers` 的两个版本**完全相同，四天来无新发行版**。`src/index.ts:368` 硬要求该能力，故终局能力 1（官方生命周期）与计划 §1 完成条件 1/2 **仍阻断**，且 `check:release` 首个真实步骤 `verify:profile` 结构上跑不通 → 架构 §7 的终止条件在上游发版前不可达。插件侧已就绪（0.1.0–0.5.0 只读注册齐备），上游发版后无需改动。
- **`docs/CURRENT_STATUS-当前状态.md` 同步**（此前停留在 2026-09-11 固化点 `36d9057`，落后 36 个提交 / 8 个 spec / 11 个 change / 180 个用例，整张能力表缺 2026-09-12 起交付的全部能力）：① 固化快照段显式标为历史、不再冒充当前基线；② 基线段换成本批实测数字；③ §1 补 **16 条**能力行（最小验证策略、宿主自有基线、预算暂停、卡片草稿隔离、探针新鲜度、模型探针认证/路径、本地执行仓库隔离、远程审批中继、按需求挂机、原生方案选择、会话工作台、项目面板按需加载、收口认证来源、Web 原生组成、出网来源约束、大内容外置传址）；④ 新增 **§1.5 仓库纪律守卫（元能力）** 8 行——此前 `b-class-*`、`evidence-*`、`openspec-spec-hygiene`、`operator-doc-accuracy`、`release-gate-*` 从未在本视图出现；⑤ §2 补 5 行真实环境（远程交互、需求全流程闭环 dogfood、RustFS 连通、集群内 Pod 上传、artifact 全链 **not-run**）；⑥ §3 上游行补今日 npm 复查；⑦ §4 新增四条。
- **`docs/remaining-work-priorities-待办优先级.md` 同步**：基线由「46 change / 37 spec / 561 测试」更新为实测值；P0–P3 历史表保留并标注为当时记录；追加「2026-09-15 复核」把待办面收敛为四类（唯一上游阻断 / 需真实环境 / 本轮新发现 / 已裁决为终态）；修正已过时的「当前状态：无待裁决项」小标题。
- **本批新发现（未处置，已登记待裁决）**：
  - `worker/dsh/release-manifest.json` 的 `hostEventProducerVersion` 写 `0.5.0`，而 `src/index.ts:228` 的 `EVENT_PRODUCER_VERSION` 是 `0.6.0`。该字段自引入提交 `1594fa5` 起即为旧值（同一提交把常量从 `0.3.0` 改为 `0.6.0`），`3146903` 更新镜像摘要与 `adapterVersion` 时也未连带更新；**全仓库仅该 JSON 自身出现该键，无任何测试或脚本校验**。与 `operator-doc-accuracy` 守卫的运维文档事件计数属同一类缺陷，但镜像分发清单侧无对应守卫。不影响运行时（无消费者），影响镜像兼容性对账的准确性。**未擅自修改**——改数字等于声称「该镜像已按 0.6.0 验证」，属证据主张，须用户裁决；补守卫属 `operator-doc-accuracy` 的 spec 扩展，须走 OpenSpec。
  - 两处门禁设计张力（此前已识别，本批正式登记）：`REQUIRED_NOT_RUN` 桶与 `check:release` 零跳过要求互斥；`real-web-gate-prerequisites` 靠正则 `^const (enabled|record|realDescribe)\b` 反推必需开关，改门控变量名即可绕过。
  - `docs/architecture-目标架构.md` §6 决策 1 写着 `confirm-execution-granularity`「当前尚未归档」，实际已于 2026-09-13 归档为 `openspec/changes/archive/2026-09-13-confirm-execution-granularity/`。**架构文档变更权仅用户，本批未改**，已出最小化修订提案待裁决。
  - 观察（非缺陷）：终局能力 2（项目身份）与 4（DAG 编排）无专属 capability spec，行为由单元测试与开发计划 §2.3 承载。按架构 §7 判定二者「有证据」，不构成隐性未完成。
- 结论（区分事实与判断）：**已验证事实**——目标与实现无方向性偏离，§3 十条终局能力中九条已有相称证据，第十条为上游发版阻断且插件侧已就绪；`artifact-ref-handoff` 28 项任务已勾 26 项，代码全部已提交。**工作假设**——`hostEventProducerVersion` 的正确值应为 `0.6.0`（依据：清单写入与常量改值同属提交 `1594fa5`，当前镜像推送于其后的 `3146903`），但未经镜像内实证。**未知项**——上游发行版纳入 `externalEventProducers` 的时间。
- 验证：文档改动后复跑 `pnpm exec vitest run packages/dsh-pactflow/tests` 全绿（结果见本条上方基线）；`ops-doc-event-count`（唯一读文档的门禁，读的是 `installation-operations-安装运维.md`）未被本批触及。

## 2026-09-15 5.1/7.1 验收承载补齐 + 本机构建环境重建（change `artifact-ref-handoff`，两项仍未勾选）

当前阶段：本机此前无法构建（Node v20.20.2 低于 `^22.19.0 || >=24`、两个 DSH fork 兄弟目录缺失），5.1/7.1 在本机既跑不了也无脚本承载。本批重建构建环境并补齐验收承载的**存储侧**；**5.1 与 7.1 如实保持未勾选**——集群侧需真实 K3s 与人工参与，本机不可达，无 mock 可以冒充。

- 环境重建：Node 22.20.0 装入 `~/.local/node22`（SHA256 与 nodejs.org 官方 SHASUMS256 逐字节一致），corepack 激活 pnpm 11.7.0；两个 DSH fork 取自 `tianyuegithub/deepseek-harness`——`deepseek-harness-pactflow-p0` ← 分支 `codex/external-producer-declaration-upgrade`（含 external producer 声明升级实现），`deepseek-harness-pactflow-upstream-pr` ← 分支 `codex/external-session-event-producers-clean`；`package.json` 的 46 个 `link:` 目标零缺失，两 fork 各自 `pnpm install` + `build:lib` 通过。**两 fork 真身置于 `~/dsh-forks/`（同步范围外），仓库同级位置留符号链接**——实测 Synology Drive 不跟随符号链接（链接以 `type: symlink` 同步，链接内 canary 文件零上传），既避免约 2G / 14.6 万文件进入云同步，又保持 `link:` 相对路径可解析（`readlink -f` 已穿透、`pnpm run build` 全链通过），`pnpm run build` 全链通过（host→typert→agent→client）。**分支到目录的映射是工作假设**：两分支全仓库仅 9 处差异且全部位于 `packages/core/session`，upstream-pr 侧引用的 6 个包字节相同，故映射方向不影响产物。
- 验收承载（本批新增）：`tests/artifact-handoff.real.spec.ts` 覆盖存储侧真实链路——长日志 put→ref→resolve 的 bytes/sha256 校验、结果文档尾部+ref 落在 `result-document` 3 KiB 预算内、`result-document` 与 `interaction-request` 双通道 oversize 拒绝码与外置指引、ListObjectsV2 孤儿对账、保留账本超龄/超量标记且标记后对象仍可读（mark-never-delete）；key 经 `pactFlowArtifactObjectKey` 生成（含随机段）。入口 `scripts/run-real-artifact.mjs` 与 `test:real-artifact`——**未武装时显式失败并声明"跳过不是通过"**，不静默跳过。
- 落点裁决：该套件**刻意不放 `e2e/`**。`run-real-web-gate.mjs` 动态发现 `e2e/` 下每个 spec 并经 `assertReleaseWebReport` 要求 `numPendingTestSuites` 为 0 且逐 suite 全通过，因此 env 门控套件放进 `e2e/` 会使该门禁结构上不可满足。**发现的设计张力（未改动，供裁决）**：`real-suite-inventory.spec.ts` 的 `REQUIRED_NOT_RUN` 桶专为"等待真实环境的 `expect.fail` 骨架"而设，但任何进入该桶的 e2e 骨架都会让 web gate 永不通过——该桶当前为空，冲突尚未暴露。另：`real-web-gate-prerequisites.spec.ts` 只扫描 `^const (enabled|record|realDescribe)` 开头行提取 `process.env`，门控若拆成其它变量名即可绕过武装集完整性检查。
- 实现侧复核（未改动）：5.1 的实现链路完整——`runner.mjs` 落盘 `/tmp/pactflow-log-{ref.json,tail.txt}` → `WORKER_SCRIPT` python 段并入结果文档 `logArtifact`/`logTail` → `k3s-worker.ts` 以 `parsePactFlowArtifactRef` 解析，解析失败返回 `failed` 并给出明确 outcome（fail-closed，非静默吞错）。故 5.1/7.1 的缺口确为验收未跑，不是实现缺失。
- 验证：`pnpm run check` 全绿（exit 0；build→test→pack:check，19 个必需产物齐全）；`pnpm test` = **102 文件通过 / 2 跳过（104），738 测试通过 / 7 跳过（745）**——本批新增套件贡献其中 1 个跳过文件与 4 个跳过测试（未武装即跳过），通过数与基线持平；`openspec validate --all --strict` 49/49。新套件另经独立 tsc 类型检查（`typecheck` 只覆盖两个 tsconfig 的显式 files，不含 `tests/`），并在内存版 S3 stand-in 上实跑 4/4——**后者只验证测试代码自身可运行，不是真实路径验收，不得计入 5.1/7.1**。
- 未完成（如实保留未勾选）：5.1 与 7.1 的**集群侧**——dispatch 内 worker put、ref 经结果文档回传、per-run artifact Secret 随 children 清理账本回收、UI 绑定存储后派发消耗真实模型额度的长任务。需真实 K3s + 真实 RustFS + 人工参与，一并见 `test:real-artifact` 与 tasks 5.1/7.1。

## 2026-09-14 大内容外置与传址协议（change `artifact-ref-handoff`，实施主体完成、未全部完成、未提交）

当前阶段：OpenSpec 规划四件套（DS 评审迭代版）+ 存储客户端/绑定/门禁/脱敏/保留账本/凭据注入/日志外置的宿主与 worker 侧实现完成并通过定向与全量测试；**真实 RustFS 连通验收通过**（宿主→NodePort 32571，SigV4 PUT/HEAD/LIST/GET/建桶/不可覆写全链实测，凭据仅经 env 注入未进日志）。**关键后端观测：该 RustFS 不返回 versionId**（合同按"有则必存、etag+hash 钉版"设计即为此情形，合同无需收窄）；ListObjectsV2 前缀列举可用。代码未提交、未推送，规格未归档；worker 镜像未推送 Harbor。

- 已完成（tasks 1.1–1.4、2.1、2.3、3.1、3.2、4.1–4.5 已勾选）：`src/artifact-store.ts`（手写 SigV4 四操作 Put/Get/Head/List + createBucket 仅供开通/验收；path-style；零依赖；`putArtifact`/`resolveArtifact` 含 hash+bytes 校验与越界绑定拒绝）；`src/schema.ts` 绑定与 `src/infrastructure.ts` 第七类校验（私网/集群内明文 HTTP 例外）；`src/k3s-worker.ts`（per-run artifact Secret env 注入 + childNames 意图/对账/清理账本；结果文档 ≤3 KiB 门禁与 `logArtifact` 结构化校验；`workerLogTail` 降级取证取运行预算）；`src/worker/redact.ts` 内容级 fail-closed 脱敏门；`src/worker/log-upload.ts` + `worker/dsh/runner.mjs`（全量日志落盘上传，未绑定零行为变化）；`retention-policy.ts` 对象保留账本（超龄 14d/超量 512MiB 标记不删 + ListObjectsV2 孤儿对账）；事件/桥/交互三通道 oversize 门禁（`pactflow.artifact.oversize`），事件走非 strict payload 可选字段、不升生产者版本。
- 验证：定向测试 7 个新 spec 全绿（artifact-store 11、binding 7、upload-gate 6、retention 5、channels 8、k3s-artifact 7、log-upload 6 等）；真实 RustFS 验收 `tests/artifact-store.real.spec.ts`（env 未设自动跳过）2 项通过；`pnpm run build` 通过、typecheck 干净。最终 `pnpm run check` 与 `openspec validate` 结果见下批注。
- 二次收尾（同日夜）：发现 worker.sh 实为宿主渲染的 `WORKER_SCRIPT`（本仓库所有物），先前"base image 不配合"的顾虑不成立——`WORKER_SCRIPT` 结果文档 python 段已并入 `/tmp/pactflow-log-ref.json`（logArtifact）与 `/tmp/pactflow-log-tail.txt`（logTail ≤1536B），runner.mjs 同时写尾部文件；dispatch 主链接线完成（项目 artifact 绑定→plan 传 artifactStoreSpec→run 传 artifactCredentials，绑定指向未知存储失败关闭）；宿主读取入口 `@Remote('artifactLog')`（按绑定解析+hash 校验，无签名地址无新端点）；Settings 第七类卡片（settings.tsx/settings-model.ts/settings-contract.ts 联合类型/两 CredentialInput）与工作台执行记录"执行日志已外置"折叠呈现+读取按钮（overlay→workbench 全链穿透）；`@Remote('probeInfrastructure')` 支持 artifact-store 探针（listObjects 探活）。**镜像已推送 Harbor 并钉版**：`datavdl/pactflow-worker@sha256:1e426b2e…`（adapterVersion 1.0.0→1.1.0，分发票）与 `@sha256:9a45e270…`（验收票），release-manifest/runtime-manifest 一致性由 pack:check 钉住；`test:worker-container` 真实容器链通过。**集群内真实 Pod 验收通过**：按 digest 拉新镜像的一次性 Pod 经 ClusterIP 直连 RustFS SigV4 上传成功（凭据 Secret 注入、用后即删）——补全 pod→ClusterIP 路径与镜像内上传链。
- 验证（二次收尾后）：全量 `check` **737 测试通过 + 2 真实套件按 env 跳过**；`validate --all --strict` 49/49。
- 未完成（如实保留未勾选）：5.1 的"绑定 artifact store 的项目正式派发长任务"端到端（需消耗真实模型额度并在 UI 绑定后派发，属用户参与的验收）与 7.1 同因未跑；RustFS IAM 收敛与受限凭据跨 run 授权保持开放问题。
- 文档同步：架构 §3.9 六类→七类（用户已裁决）、开发计划两处枚举与验收矩阵行 9、业务逻辑 §2.1 增第七类。
- 安全边界：凭据全程 env/Secret，argv/日志/事件无凭据字面量；扫描门 fail-closed（扫描器故障拒上传）；`createBucket` 标注为开通/验收用、不属交接协议操作集；前缀隔离不声称安全边界。Mimosa 完整扫描未清账（不得宣称安全）。

## 2026-09-13 本地执行仓库隔离（change `isolate-local-worker-runtime`，已验证、未归档）

当前阶段：独立任务仓库、派发前沙箱预检、任务内 Maven 缓存与候选恢复全部实施并通过真实端到端验收；最终包已安装到本地 `127.0.0.1:3080` 并经浏览器核验。最后已验证提交基线仍为 `71826df`；本轮与前序六个 change 的改动均未提交。会话中断（上一代理 token 耗尽）后的接续工作由本 change 收尾完成。

- 实施内容：`src/local-workspace.ts`（`checkoutKind=isolated-clone` 独立仓库物化、钩子/签名/fsmonitor 禁用、恢复快照字节级校验）；`src/local-preflight.ts`（与子代理同源的原生沙箱预检：真实写/提交探测、普通目录主仓否定用例、Maven 工具链与任务内缓存探测、提供器与策略漂移守卫）；`src/host/dispatch.ts`（独立仓库派发指令含 `-Dmaven.repo.local` 私有缓存与恢复候选来源声明）；候选摘要、方案绑定恢复与漂移拒绝（`tests/local-recovery.spec.ts` 6 项）。
- 验证：最终 `pnpm run check` **94 文件 / 686 项全绿** + `pack:check` 19 必要产物；`test:real-worker` 真实模型端到端 **1 项通过（26.8 秒）**——原生方案确认（人选择卡）→ `isolated-clone` 派发 → 真实 spawn Worker 完成提交，断言含 `checkoutKind==='isolated-clone'` 与任务仓内 `worker.txt` 字节校验；旧共享工作树可复现 `index.lock` 拒绝、新独立仓库可提交、主仓目录仍受保护（会话内真实沙箱回归）。
- 本轮真实回归发现并修复三个缺陷（前轮中断未及真实验证）：① `autopilot.spec.ts` 夹具用虚构提供器名 `local-fixture`，被新增的 spawn/fork fail-closed 白名单拒绝（12 项红）——夹具改用真实原生名 `spawn`，与 closing/dependency-input 等同类对齐；`execution-plan-choice.spec.ts` 保留任意名，因其直接 mock `executionOptions` 且专门验证同名提供器替换语义。② e2e 接线：`connectFreshWorkspace(root)` 语义是"在 root 下创建并连接 `<root>/workspace`"，误传克隆根本身导致套出空目录、`bind_git` 正确拒绝"Session workspace must be the Git checkout root"，代理如实阻塞未伪造——修正为传克隆父目录。③ `local-preflight` 防漂移守卫比较 `ctx.get()` 服务实例同一性，而 Cordis 每次读取返回新的 traceable 代理，真实宿主必误报（纯对象 mock 单测无法暴露）——改为语义校验：提供器 Map 实例比对、沙箱模式重新 resolve、沙箱 `confine` 重新验证 enforcement=full。
- 安装：`dist/dsh-pactflow-0.2.1.tgz` SHA-256 `0f4cb2ac0927fd65ccc34d0fe6575215b0bfb07b9f39554a5cea450aa2afa6b5`；remove+add 重装后 `lib/index.js` md5 与 tarball 一致（`a93389e7…`）。宿主按防竞争流程重启（旧进程 310 → 新进程 83628），带 `DSH_REPO` fork 与 `NODE_EXTRA_CA_CERTS`。浏览器核验：零脉项目配置、会话工作台三视图（进展/执行记录/验收交付）、需求选择、长文折叠正常渲染；两份保留失败现场完整（「保留现场 · 2」），业务会话历史可读。工作台页面已保留在用户浏览器中。
- 覆盖边界：两份真实失败候选的业务恢复未执行（按设计由零脉正式派发在修正后的环境进行，恢复入口与漂移拒绝已由合同测试覆盖）；共享 `~/.m2` 授权仍待宿主具备附加可写目录能力后接入；宿主操作系统级崩溃整链未验证。代码未提交/推送，规格未归档。
- **用户授权提交/归档与正式恢复后的追加事实（2026-09-13）**：6 个 change 已按实现/OpenSpec/文档三笔本地提交（`1594fa5`/`c2f9c24`/`fac0868`）并归档，归档后 `check` 94 文件 / 686 项全绿、`validate --all --strict` 48/48。用户授权的正式恢复派发在真实会话 `session-1c0b238c…`（data-governance）推进到原生方案批准后被**宿主生产者声明冲突阻断**：`Error: session … has a conflicting declaration for external producer "dsh-pactflow"`。源码级定位——宿主会话核心（fork `packages/core/session/src/external-event-producers.ts:236-259`）要求同一会话内同一 producer 的持久声明与写入句柄**完全一致**（producer+version+eventTypes），该会话在升级前已持久化 0.5.0 声明，0.6.0 句柄写入必被拒；宿主与插件均无声明升级/迁移通道。**推论：所有 0.6.0 升级前创建的会话被永久写冻结**——方案确认、节点创建、派发、挂机、恢复等一切状态变更操作均不可用，只读操作不受影响；新会话从首次写入即声明 0.6.0，不受影响（`test:real-worker` 已证）。恢复机制本身已在真实端到端验证可用，被阻断的是老会话这一载体。会话内模型推测的「重启会话/插件清除声明」不成立（声明在会话日志中持久化）。解法需用户裁决：上游 change 增加会话生产者声明升级通道 / 人工落地候选（平台外提交任务分支）/ 放弃候选在新会话重做。**用户已裁决走上游 change**：提案已按上游惯例撰写作双语 Agent Note 并提交至 fork（`deepseek-harness-pactflow-upstream-pr` 分支 `codex/external-producer-declaration-upgrade`，提交 `e75d9a3da6`，`proposed/architecture/2026-09-13-external-producer-declaration-upgrade`）——同 producer 声明序列化（严格升版+词汇超集+经新版本 handle 同步追加声明），读取按段准入、逐声明要求精确注册；上游核心实施并通过验收后，老会话即可解冻并正式恢复两份候选，插件侧无需改动（0.1.0–0.5.0 只读注册已具备）。
- **上游核心已实施并经验收（用户裁决「1+3 实施，2 不做」）**：fork 提交 `06d3202146`（core/session 声明序列化+严格 semver 比较、session-persistence 按段准入；core/session 81 项、persistence/JSONL/SQLite 372 项、oxlint 0 错、doc-graphs/persistence-catalog 门禁通过；Agent Note 转 implemented）。开发宿主已重启至该实现（进程 49633）。**老会话解冻并完成正式恢复**：原冻结会话首笔 0.6.0 写入自动追加升级声明，方案确认→`retry_node`→`isolated-clone` 恢复派发全链通过；Worker 复核候选改动后真实验证（mvn 98 测试 0 失败为 Worker 自述、编排器只读核对提交内容并如实区分）并提交推送任务分支 `pactflow/quality-issue-rerun-guide/rerun-guide-delivery/4130eb83-16b` @ `90c1dfdf`（Gitea ls-remote 核验）；工作台节点终态「已成功」，两份保留现场按 retain 保留（是否释放待用户决定）。后续 verification 确认与 code_review/closing（受保护 PR 合并）属用户人工决策，未代行。
- **verification/closing 推进与两处真实缺口（用户裁决「1 同意，2 释放」之后）**：verification/requirement/design 审批已经原生批准卡逐一记录。**缺口一（保留现场释放）**：`retryCleanup` 对两条无提交的失败现场按合同拒绝（"task cleanup requires a verified expected commit"，attempt 9，fail-closed 正确）；磁盘已由所有者批准的运维手工释放（两工作树 remove --force+prune、两本地分支删除，均停在基线 7676ee2 无独有提交；成功运行 run-4130eb83 工作树保留；远端无这两分支）；账本两条记录保持 failed/retain=true 至 retainUntil（约 2026-09-26），"已手工释放的无提交失败任务"缺所有者释放入口属平台待改进项。**缺口二（绑定迁移后无法收口）**：Gitea provider=gitea（gitea.k3s.ty.com 与 192.168.31.7 同实例已实测）；项目绑定切换 https-token 成功，但 `close_git_need` 拒绝 "Git authentication does not match the project binding"——运行产生于 SSH 绑定时代，收口完整性校验比对运行认证与项目绑定，无所有者重新确认的对齐入口；反向"SSH 远端+仅 Gitea API token 子绑定"也被实测排除（bind_git 把 credential_ref 用作 Git 取送认证，token 强制 HTTPS 远端）。当前 need 停在 closing/rev 9，任务分支与提交完整、未合并未部署；三条候选路径（平台合同扩展所有者重确认入口 / 新绑定下重跑交付 / 所有者在 Gitea 网页手工建 PR 合并）待用户裁决。
- **用户裁决 B 后的实现转折与收口完成（2026-09-13）**：实现前根因复核发现这不是合同缺口而是**宿主缺陷**——`closeGitNeed` 用 `taskRuns[0].git`（首个运行的 SSH 时代规格，auth 为空）解析收口凭据，而收口全部 Git 操作都作用于当前绑定的远端；凭据来源与作用远端错配，取"任意首个运行"在多运行下也不成立。按 change `close-with-binding-auth` 修复：`resolveGitAuth(binding)`（收口与合并后任务清理同源），spec `git-closing-integrity` 新增 Requirement 钉死认证来源。失败优先测试先复现生产错误原文再转绿（新增 14 号模式 `binding-auth-source`）；`check` **94 文件 / 687 项**全绿、`validate --all --strict` 49/49、Agent 无新事件与生产者版本变更。打包 `dist/dsh-pactflow-0.2.1.tgz`（SHA-256 `30eb38fc…`，安装包 md5 一致）并重启宿主（进程 91113）。**真实收口完成**：原会话重试 `close_git_need` 通过——受保护 PR #2 合并入 main（发布提交 `f64cb9ff`，ls-remote 独立核验；任务分支 90c1dfdf 保留），Need 走完 需求→设计→计划→执行（含恢复）→验证→code_review→closing→deployed 全流程，平台"deployed"仅为合并后发布记录语义，无实际部署。origin 保持 SSH（用户本机 git 工作流）与平台 https-token 绑定并行为确认终态。合并后新增 1 条任务分支清理失败（运行记录为 SSH 时代 remoteUrl，与现绑定 URL 不一致被合同拒绝，同属待改进的账本对齐项）与两条历史保留现场同策略等待 retainUntil（约 2026-09-26）。

## 2026-09-13 会话工作台对齐 DSH（change `align-session-workbench-with-dsh`，已验证、未归档）

当前阶段：原生界面、按需求视图与既有控制链整合完成，最终包已安装到本地 `127.0.0.1:3080` 并通过实际会话核验：首屏显示阶段、失败节点、折叠原文及两份保留现场，展开可读全文；Escape 关闭后焦点回到“打开零脉”。最终工作台已在用户浏览器中打开。最后已验证提交基线仍为 `71826df`；本轮与前序改动均未提交。需求和方案由本 change 持有。

- 验证：构建通过；最终浏览器回归 **15 项通过**（原生明暗主题、键盘/焦点、草稿、窄屏、长文折叠、配置定位、错需求预览拒绝、交互自动到期）；最终定向回归 **3 文件 / 21 项通过**。全量回归 **91 文件 / 660 项中 659 通过**，`git-cancellation.spec.ts` 的进程标记等待曾失败，单独复跑通过且未修改该例的超时或断言；不将这次全量运行记为全绿。首次旧文案断言已更新为当前诊断语义并复验。
- 分发校验：`pnpm run pack:check` 验证 19 个必要入口及打包模块依赖；`openspec validate --all --strict` **47 项通过**，本 change 严格校验通过。明暗、窄屏截图已人工核验；实际宿主长需求和运行原文造成首屏拥挤后，补充了完整原文折叠及浏览器展开验证。
- 真实远程回归：`PACTFLOW_RELAY_IMAGE=<清单 acceptanceImage> pnpm run test:worker-interactions` **1 项通过，111.13 秒**。三条原生审批/选择记录均收讫，真实连接进程断线重连、浏览器重载和取消后迟到批准拒绝通过。任务运行 `run-b62dba7c-d278-4399-b05b-6de2c73c81fa`，验收仓库任务分支提交 `1569dc3055cfd1795220709a47fddf622f19a2ec`。后续仅改长文本折叠与执行池显示名称，已重新构建并通过上述最终定向和浏览器回归；未重复消耗远端模型。初次真实回归发现需求选择框缺少明确无障碍名称，补齐后完整复跑通过。
- 安装：`dist/dsh-pactflow-0.2.1-workbench-a247ec32.tgz`；SHA-256 `a247ec32cae928f5b42782cb4d0dc460c3423f2bc24ad26137d18b4f00a2aa8f`。安装后全部打包运行脚本、配置及分片与包内容逐字节一致，宿主进程 **310**。更新前无活动执行/会话及未发送草稿；已有两份标记保留的失败现场继续保留，本轮没有卸载或清理。首次更新前的可恢复实体包为 `/var/folders/dv/bpn_bzgx0hx8jzky8_tgs1vc0000gn/T/pactflow-panel-recovery-nk1acjow/previous-package.tgz`（已核验含 160 个实体文件）；最终文本修订前一版另存于 `pactflow-panel-recovery-lp5jivuu/previous-package.tgz`。
- 覆盖边界：仅改变会话工作台与配置跳转的界面行为，不修改后端权限、事件、执行器镜像或业务仓库。已有业务任务的本地沙箱提交失败和保留容量超限是运行记录，未由本轮界面更新解决。一次进程时序测试失败保留如实记录；未作全量无障碍审计。代码未提交/推送，规格未归档；官方发行版兼容边界沿用既有结论。

## 2026-09-13 远程 DSH 审批与提问（change `relay-dsh-worker-interactions`，已验证、未归档）

当前阶段：实现与集群交互验收完成，已安装到本地 `127.0.0.1:3080` 宿主并核验页面；最后已验证提交基线仍为 `71826df`，本轮及前序工作区改动均未提交。需求、设计和里程碑由本 change 持有；用户明确区分官方宿主插件和可定制执行器镜像，项目规则已同步该边界。

- 验证：`pnpm run build` 通过；`pnpm test` **90 文件 / 650 项通过**；面板 `pactflow-overlay.e2e.spec.ts` **11 项通过**；交互新增定向测试 **23 项通过**；`pnpm run pack:check` **19 个必要入口及全部打包 JavaScript 相对依赖存在**。分发镜像确认不含测试钩子。
- 真实集群命令：`PACTFLOW_RELAY_IMAGE=<镜像清单的 acceptanceImage> pnpm run test:worker-interactions`，**1 项通过；最后按最终宿主代码复跑为 120.26 秒**。真实 DSH 原生审批批准、业务单选、第二审批拒绝，共 3 条记录均有执行器收讫；强制终止精确连接进程后，新连接继续同一问题；浏览器重载不丢状态；第二任务停止后迟到批准被拒绝。最终运行 `run-fd2e4709-8827-4783-99af-662166cb8360`，验收仓库 `tianyue/zeromai-demo` 的真实任务分支提交 `90acb97593c6eef15f4dd888db74150cef918068`；先前同链提交 `3ae6e2b40eb10c068eda8f7fb54050cfd045dce2` 也通过。验收以任务分支提交为终点，未要求默认分支合并。
- 本地容器检查：`node scripts/build-worker-interaction-image.mjs --acceptance` 与 `pnpm run test:worker-container`。后者关闭容器网络，通过真实 DSH 服务完成批准、选择、拒绝并验证文件，不调用联网模型。初次真实容器失败定位到默认函数导出遗漏依赖声明；改为命名导出后通过。另修复事件词汇排序、socket 自动清理后的重复删除、断线计时与迟到回调、暂停后期限限制、敏感字段脱敏及包内共享分片遗漏。未放松断言或用超时结束冒充通过。
- 独立复核：权限、签名、期限、断线和敏感字段整改通过。签名私钥由宿主凭证服务保存，Pod 只有只读公钥；答案绑定运行、容器、进程、请求摘要和期限，先持久化后发送，收讫单独记账。
- 分发：`worker/dsh/release-manifest.json` 保存镜像映射。DSH 版本 `0.1.1-rc.2`、适配版本 `1.0.0`、协议 `dsh-worker-interactions/v1`；分发镜像摘要 `sha256:ac78fe1f549a0520816d79e3ef7e93451bc349df2dbf4a0e1a009b9ac9ce646c`。未自动更换用户项目模板；启用需要选择该镜像并勾选远程交互。
- 安装：`dist/dsh-pactflow-0.2.1-relay-146959b7.tgz`，文件摘要 `146959b750434bf463609d29048445d4f158a2868861880a304b3a10e705c64a`；安装前活动运行和待清理责任为零，安装后全部打包运行脚本/配置/共享分片与包内内容逐字节一致。旧包保留在 `/var/folders/dv/bpn_bzgx0hx8jzky8_tgs1vc0000gn/T/pactflow-panel-recovery-0fko0bi5/previous-package.tgz`。新宿主进程 98388，页面显示“执行代理待确认 / 无待确认事项”，原历史会话可读取；设置页已验证 DSH 模板有“启用远程审批与提问”开关且原配置默认关闭，检查后取消编辑。未启动客户业务任务，也未替换其模板。
- 覆盖边界：较新 DSH 事件式提问适配路径未做对应镜像验收；宿主冷恢复测试为真实会话落盘与新 Context 重放，未测试操作系统级宿主崩溃整链；不覆盖任意终端提示、销毁容器的调用栈恢复或生产发布。新增 0.5.0 事件不能由旧插件直接读取。代码未提交/推送，规格未归档。
- 范围外相关发现：查询旧 `pactflow-git-harness-check` 凭证资源的元数据时，工具意外返回含密钥副本的历史注解；已停止输出此类注解，未复制其内容。相关测试密钥应由基础设施凭证维护方单独轮换；本轮未擅自变更原密钥或其它使用方。

## 2026-09-12 按需求挂机到代码交付（change `need-autopilot-code-delivery`，已验证、未归档）

当前阶段：功能及真实交付验收完成，最终包已安装到 `127.0.0.1:3080` 本地开发宿主并核验页面。基于最后已验证提交 `71826df` 的工作区改动尚未提交；本 change 的需求、方案和里程碑由 OpenSpec 持有。默认建议 4 小时、60 次编排模型调用、10 次执行、并发 1；普通人工模式保留原生方案选择。

- 验证命令：`pnpm run build` 通过；最终宿主源码 `pnpm test` **87 文件 / 627 项通过**；面板 `pactflow-overlay.e2e.spec.ts` **11 项通过**；`pnpm run test:autopilot` **1 项真实模型与界面交付通过**；`pnpm run test:real-approval` **3 项通过**，包含进度查询零立项/零派发及小任务完整单节点推荐；`pnpm run pack:check` 通过；`openspec validate --all --strict` **45 项通过**；`git diff --check` 通过。
- 真实交付证据：界面开启、暂停、恢复后关闭浏览器，宿主持续驱动真实本地执行代理、Git（版本控制）和 Gitea（代码托管），完成验收仓库 `tianyue/pactflow-acceptance` 的实际合并。提交 `23d3cf94b4caa51e154b71f50176611e080f20d7`；文件 `autopilot-proof-f5b1ae56.txt` 内容按精确断言验证；**1 个节点、21 次编排调用、1 次宿主唤醒**，用例耗时 **84.47 秒**。全部评审来自预授权策略，没有伪造原生人工批准；终态由真实合并记录判定。此前同链未加暂停/恢复的真实验收也通过。
- 定向验证覆盖授权摘要变化、跨需求拒绝、空验证拒绝、并发与调用预算、人工接管、暂停/恢复、终态不可复活、真实日志落盘和重放、重复唤醒、无进展阻塞、落盘失败不调用模型。真实 Git 子进程测试证明长验证可取消、未推送身份可精确恢复；集群取消隔离测试证明取消失败不伪造终态、继续取消同需求其它作业、不触碰另一需求。
- 独立静态复核覆盖收口写入前授权、持久身份、取消信号及集群异步派发窗口，问题修复后通过。补充复核指出先中止恢复观察器会误记集群取消，已改为先确认精确集群取消、聚合失败再报告，复核通过。恢复时可选字段含未定义值导致日志写入失败的问题已由先失败后通过的暂停/恢复回归修复。
- 安装验证：`dist/dsh-pactflow-0.2.1-autopilot-67ecd5a9.tgz`，SHA-256（文件摘要）`67ecd5a9ea331f491769198a7aa987bc31ae189ed68e3e4a831e402849e9022d`；六份宿主/客户端/远程入口/预设/工具产物逐字节核验一致。更新前两次排空检查均为零活动运行、零待清理责任。旧包保留在 `/var/folders/dv/bpn_bzgx0hx8jzky8_tgs1vc0000gn/T/pactflow-panel-recovery-wo_jldj4/previous-package.tgz`；新宿主进程 523 监听本机 3080。重新打开的页面已显示按需求挂机控制及 4/60/10/1 默认预算，原历史会话可读取，无历史加载错误；当前会话无正式需求，准备按钮正确禁用，未启动业务执行。最后仅将客户端建议调用数调整到 60，已重新构建并通过含默认值断言的 11 项面板测试及包校验；真实交付本就使用 60 次预算。
- 覆盖边界：真实交付使用本地执行代理；本轮未重跑“挂机 + K3s（容器集群）+ 宿主进程冷重启”的完整真实链。冷恢复的控制记录重放、既有恢复回归与新取消分支已验证。本地执行器冷重启须重新授权；关闭浏览器可续跑，宿主仍须运行。编排次数不含远端执行器内部模型调用，不是费用上限；已发往远端的写入不能承诺撤回，未知结果保留恢复责任。未执行客户需求、真实部署或生产发布；新增 0.4.0 事件写入后不能直接降级旧插件读取这些会话。代码未提交/推送，规格未归档。

## 2026-09-12 原生执行方案选择（change `confirm-execution-granularity`，已验证、未归档）

当前阶段：已实现、已安装到 `127.0.0.1:3080` 本地开发宿主并验证页面；基于提交 `71826df` 的工作区改动尚未提交。需求、设计、差异规格与三个完成里程碑由该 change 持有，README 补充了开发记录入口。实现采用原生提问与审批扩展点，不修改 DSH 源码。

- 验证命令：`pnpm run build` 通过；最终串行 `pnpm test` **85 文件 / 613 项全部通过**；面板 `pactflow-overlay.e2e.spec.ts` **11 项通过**；`pnpm run test:real-approval` **3 项真实模型与原生交互通过**，最后一轮 112.16 秒；`pnpm run pack:check` 通过；`openspec validate --all --strict` **44 项通过**；`git diff --check` 通过。
- 授权边界定向测试 **13 项通过**：等待期间零新节点与零批准、单/多节点选择、拒绝/取消/自定义/伪造标识/多选、图变更、路由解析与未注册资源、同名提供器替换、阶段推进与原范围重试。原生真实模型用例：查询进度零立项/零派发/零审批；小型修复含测试与说明时选择完整单节点；提交选择前没有节点、提交后恰一节点与一次计划批准，未重复弹通用审批。
- 独立静态风险复核提出并修复了选项身份、默认路由解析、派发异步窗口与本地提供器替换问题；最终针对这些问题复核通过。宿主保存规范化执行路由与批准计划；本地提供器热替换或重启后新派发需要重新确认，旧运行恢复和清理不被阻断。
- 如实保留验证过程：首次扩展全量回归遇到工具名预期未更新，已按新增工具更新；一次并行负载下全量回归的三项既有 closing 测试超时（610 通过 / 3 超时）。三项在同代码、原超时与原断言下单独通过，随后完整串行 613 项通过；未增加超时、削弱断言或跳过失败项。负载相关是合理推断，不作为确定根因。
- 安装核对：包 `dist/dsh-pactflow-0.2.1-choice-7e61b400.tgz`，SHA-256 `7e61b4000c7d795d589c4c91767c7da37d9559f82206c1967b2ba9ec59c040bf`；宿主/客户端/远程生成产物/预设/代理工具共六份文件逐字节一致。更新前活动运行与待清理责任均为零。旧包位于 `/var/folders/dv/bpn_bzgx0hx8jzky8_tgs1vc0000gn/T/pactflow-panel-recovery-x49sdlot/previous-package.tgz`。当前宿主进程 93455，仍监听本机 3080。
- 现场页面已显示“已配置的执行规格”“1 个规格 · 最大并发 5”“按任务启动，空闲时不预留执行实例”，旧“合计 5 个 Worker”已消失。
- 覆盖边界：未执行客户业务修改、未启动新的真实 K3s 任务或重跑完整 Gitea/K3s 发布验收；本次证明原生交互、宿主授权、既有回归和本地部署，不构成官方发行版兼容或生产发布声明。规格未归档、代码未提交/推送；无当前冻结修复阻塞项。

## 2026-09-12 项目面板按需加载（change `speed-up-project-panel-loading`，已验证、未归档）

当前阶段：用户批准的加载修复已实现，并安装到 `127.0.0.1:3080` 的本地开发宿主；基于提交 `71826df` 的本次工作区改动尚未提交。行为合同由该 change 持有。

- 验证：`pnpm run build` 通过；`pnpm test` **84 文件 / 600 项通过**；`pnpm exec vitest run --config vitest.e2e.config.ts packages/dsh-pactflow/e2e/pactflow-overlay.e2e.spec.ts` **11 项通过、零跳过**；`pnpm run pack:check` 通过；`openspec validate speed-up-project-panel-loading --strict` 通过。
- 回归证明：新宿主边界测试先失败后通过，覆盖列表零会话发现、单仓库真实 Git、真实落盘会话候选、未知工作区及读取失败；浏览器以延迟真实响应和传输失败覆盖导航独立就绪、迟到响应、关闭重开、四层失败重试及既有保存/草稿/移动布局。故障注入仅用于隔离测试，未注入用户宿主。
- 本地实测：旧聚合接口 **24.17 秒**；更新后首开列表 **295 毫秒**、选中详情 **1074 毫秒**，再次打开列表 **5 毫秒**、详情 **122 毫秒**。分别为浏览器请求至响应的耗时，非全应用启动时间；首开详情在列表后请求，再次打开两者可并行。两次均未请求旧聚合接口或迁移候选。
- 安装验证：同版本同路径首次安装命中旧缓存，被逐文件比较拦截，未停止旧宿主；改用 `dist/dsh-pactflow-0.2.1-panel-ba2c164f.tgz` 安装后，宿主、客户端及远程生成产物逐字节相符，重启前活动运行与待清理责任均为零。包 SHA-256：`ba2c164f0fd8ecfa746edbe2f3d2163791afaf295d61acf94b84f248e691c765`。旧包恢复载体保留在 `/var/folders/dv/bpn_bzgx0hx8jzky8_tgs1vc0000gn/T/pactflow-panel-recovery-ej3p5q0n/previous-package.tgz`。
- 边界：单个大型仓库详情及主动查询大量历史会话仍可能耗时，但不再阻塞导航；旧聚合接口保持兼容。未作官方发行版/生产验收，未归档、提交或推送；无当前修复阻塞项。

## 2026-09-12 Anthropic 探针路径推导与运行时对齐（change `model-probe-path-convention`，已归档）

紧接上一变更实机验收时暴露的**插件内在不一致**：探针把 `/messages` 直接拼 baseUrl，而运行时把 baseUrl 原样注入 `ANTHROPIC_BASE_URL`、由 Anthropic SDK 自拼 `/v1/messages`——baseUrl 不带 `/v1` 探针 404（Ark 实测 `/api/coding/messages` 不存在），带 `/v1` 则运行时路径翻倍，同一值无法两侧兼容。修复：探针 anthropic 分支 baseUrl 不以 `/v1` 结尾时拼 `v1/messages`、已含则不重复（官方 Anthropic、GLM Anthropic 兼容端点同受惠）。测试 `model-probe-path.spec.ts`（3 场景先红后绿：补全/不翻倍/与认证回退叠加同路径）。**验证**：`pnpm run check` 83 文件 / **597** 测试全绿；`openspec validate --all --strict` 43/43；tarball 内容核对（v1/messages 在包内）后重装重启。

## 2026-09-12 Anthropic 探针 401 自动 Bearer 重试（change `model-probe-auth-fallback`，已归档）

真实部署（火山方舟 Coding 套餐 key）实测暴露的矛盾：模型连接卡「测试」对 anthropic 协议固定发 `x-api-key`，而 Ark 只认 Bearer——探针必红，但 Worker 实跑（K3s 注入 `ANTHROPIC_AUTH_TOKEN`）本就 Bearer 可通。本次按用户裁决把探针改为双风格兼容：

- `probeModelConnection` anthropic 分支：首发 `x-api-key`（官方语义不变）；**仅 401** 时以同 URL/请求体、`Authorization: Bearer` 重试**恰一次**（替换头、不同时发送）；非 401 不重试；错误消息只含状态码。
- 测试 `model-probe-auth-fallback.spec.ts`（4 场景，stub 全局 fetch，先红后绿）：401→Bearer 成功（含头互斥/同 URL/恰两次断言）、401→401 如实失败、403 不重试（恰一次请求）、官方风格首试即过。Mimosa 拦截过一版「断言中的凭据字面量」，改为拼装值+键值分离写法。
- 同批实测钉死的 Ark 事实：Anthropic 入口 base 为 `https://ark.cn-beijing.volces.com/api/coding`（Claude Code 自拼 `/v1/messages`），Coding 套餐可用模型 `doubao-seed-code-250615` / `kimi-k2-250711-preview`（其余报不支持 coding plan）。

**验证**：`pnpm run check` 82 文件 / **594** 测试全绿（含 egress-url-origin 零出网守卫无回归）；`openspec validate --all --strict` 42/42；archive 后 Purpose 已补真。

## 2026-09-12 探针读当前已保存配置 + 测试日志收敛（change `harden-saved-probe-freshness`，已归档）

真实部署中三类同因误报（K3s 集群、Harbor、Gitea 先后「卡片内测试通过、外层可用性测试失败」）定性为同一类缺陷：外层探针/只读发现读取**宿主启动时冻结的配置快照**，保存动作发生在启动之后即必然失败。本次按类修复并合同化（新 capability `infrastructure-probe-freshness`）：

- **数据源分离**：`probeInfrastructure`（无 draft）、`listImagePullSecrets`、`listHarborArtifacts`、`listK3sGitSecrets`、`infrastructureDeletionImpact`（无 draft）改读**探针时刻已持久化的设置文档**（settings scope 访问器 + 一次性只读视图，快照仅作未挂载回退）；运行时 Worker/池/K3s client/定时器仍由 `applies: 'restart'` 合同管辖，保存后重启前派发行为不变（测试钉住 `listWorkerPools` 不变）。
- **日志收敛**：已保存探针成功路径曾永久残留「进行中」标记（无后续异步步骤收敛它），已修复并写入同一合同（3 项回归，先红后绿）。
- **文案如实**：start 阶段「测试重启后生效的配置」→「读取当前已保存的配置」；运维手册 §3 补生效时机说明。

**验证**：`pnpm run check` 80 文件 / **589** 测试全绿；`openspec validate --all --strict` 41/41；实机验证：启动后保存的 Gitea 不重启外层测试即「联通」（`gitea.k3s.ty.com` 私有 CA 经 `NODE_EXTRA_CA_CERTS` 环境侧信任，Gitea 设置无 tlsVerify 字段属既有合同）。

## 2026-09-11 A03-d 评审可见验证清单 + A12-c 移交入口 + A05 保留现场 UI（change `surface-review-and-readonly-entries`，已归档）

用户裁决「A03-d + A12-c + A05 UI」后实施；接线探查中**发现并修复一个真实缺陷**：

- **缺陷（A03-d 前置）**：`gitResultSchema`（zod）未声明 `validationSensitiveChanges`，事件折叠时该字段被**剥除**——实测 `snapshot().runs.byId[*].gitResult.validationSensitiveChanges` 恒为 `undefined`，而文档曾称「经 snapshot() 可读」（又一例「声称与事实不符且无机制发现」）。修复：schema 增可选字段（向后兼容），并加**先红后绿**的投影存活测试。A05 的 `sizeBytes`/`retainUntil` 已在 schema 内，不受影响（已核对）。
- **A03-d**：`pactflow_record_review` 的审批理由恒含一行「验证敏感文件改动：清单（或 无）」——清单取该 Need 全部运行的去重并集、排序、截断 6 条 + 等N项。评审者在原生审批弹窗即见「本次交付改了测试/构建/CI 配置」；`review-surface.spec.ts`（3）覆盖存活/有清单/显式「无」。
- **A12-c**：浮层新增「导出移交摘要」只读入口（调既有 `projectHandover`，JSON 呈现 + 复制），含 `packageVersion`/`eventProducerVersion`。
- **A05 UI**：浮层新增「保留现场」只读区（总数/保留体积/是否全度量/是否超预算/逾期清单），数据经既有只读 `retentionStatus` 并随运行时刷新。

**验证**：`pnpm run check` 72 文件 / **561** 测试 / 13 包产物全绿；`test:web` overlay 9/9 通过（首轮外层 3 项失败经多次复跑确认是**冷启动 sidebar 指针拦截偶发**，且其中一个失败会把对话框留在打开态而级联影响后续用例——非本改动回归）；`openspec validate --all --strict` 37/37；archive 归并（无新 capability，无占位 Purpose）。

## 2026-09-11 完整 Mimosa 深度扫描 + SSRF 族处置（change `harden-egress-url-origin`，已归档）

补齐此前 `git commit`/`push` 时多次 `scanner_enobufs` 的缺口：完成一次**密封深度扫描**（`scan-2026-09-11T06-24-14.686Z-93cb38201725`，seal `sha256:732c2a60…`；收据与三族处置结论见 `docs/security-scan-20260911.md`）。扫描覆盖 `partial`（调用图动态派发缺口）→ 结论 `inconclusive`，**不得**作全项目安全声明。

50 条 finding 的人工核实与处置：

- **SSRF 入口 19 条 high → 已处置**：核实「Agent 面工具只收注册 id、无端点参数；操作员表单探测按设计接受草稿端点；Gitea 携凭据出网由 F01 合同约束」后，把该分层落为新合同 `egress-url-origin` + 守卫测试 `tests/egress-url-origin.spec.ts`（4 项：schema 无端点参数含信封形状断言、Agent 面无探测工具、未注册模型连接零出网、草稿凭据未配置零出网）。**对抗验证**：临时注入假想 `base_url` 参数工具时守卫精确点名（非空转）；守卫首版曾因未识别 `schemas()` 的 JSON-Schema 信封而险些空转——由「断言信封形状 + 含 `gitea_provider_id`」修正。
- **mongo-sort-injection 23 条 medium → 规则错配**：全仓无 MongoDB（零命中）；sink 实为 JS 数组排序。不改代码。
- **硬编码凭据 3 条 high（CWE-798）→ 误报**：仅环境变量名（K8s Secret 注入、容器内运行时读取），无字面量。不改代码。

零运行时改动（纯新增测试与文档）。**验证**：`pnpm run check` 72 文件 / **558** 测试 / 13 包产物全绿；`openspec validate --all --strict` 37/37；依赖 56 包离线 advisory 匹配 0。

## 2026-09-12 四项新目标全部交付（用户裁决「1-4 都做」；四个 change 各自归档）

按序完成 A03-b → A03-c → A11 → A8，各自完整 OpenSpec 周期：

1. **`harden-minimum-validation-policy`**（A03-b）：`validationPolicy` 组（人写、宿主强制）；`closeGitNeed` 在外部调用前核对每交付构件的 profile 成功证据（按注册 command+args 匹配，修订漂移由既有断言排除），缺失逐项指名；`saveValidationPolicy`（引用校验）+ 删除被引用 profile 拒绝；Agent 面零接口（测试断言）；客户端「收口必跑」勾选。
2. **`harden-host-owned-baseline`**（A03-c）：`prepareClosing` 在候选提交上**先于任务验证**执行宿主基线（复用 runValidation，失败抛「blocks closing」并指名命令）；证据带 `source='host-baseline'` 持久于收口记录（closing schema 扩展）；交接未完成责任附执行数；`saveHostBaseline`（边界校验）+ 客户端 JSON 编辑区。
3. **`harden-budget-pause-state`**（A11）：`PactFlowNodeState` 增 `paused`；预算耗尽 → 落 paused（不再每次重抛异常）；claim/retry 对 paused 指名「等待人工恢复」；`resumeNode` 显式恢复留痕；`STATE_COPY`/浮层恢复区呈现。既有预算测试按新合同更新。
4. **`harden-card-draft-isolation`**（A8）：`card-drafts.ts` 按键草稿 store（Map + useSyncExternalStore）；验证编辑器草稿按工作区键并存（切换保留、保存/撤销清本键）；面板关闭两步确认不静默丢弃；移动视口资源卡覆盖沿用既有 e2e 断言。

**真实缺陷（第 4 项，e2e 级联暴露）**：编辑器挂载曾**无条件**向草稿 store 写入 → 面板一打开即被标记「有未保存草稿」→ 关闭第一击只进入确认态、面板残留 → 模态拦截后续用例的侧栏点击（表现为「负载偶发」假象）。修复：仅 dirty 时写入。**教训**：新增「未保存」类状态时，挂载即写 = 把干净状态标脏；级联失败的根因要先查「前一用例残留的模态/状态」。前两次同类失败（4a88388 前）确为冷启动侧栏偶发，本次则不是——同形不同因，必须逐次核实。

**验证**：`pnpm run check` 75 文件 / **584** 测试 / 13 包产物全绿；`test:web` 9 通过（负载偶发经冷却复跑确认）；`openspec validate --all --strict` 40/40（39 spec + 1 活跃）→ 归档后 40 spec。

## 2026-09-12 用户裁决：跨主机双客户端部署 = 非目标形态（11 号待办正式关闭）

用户质疑跨主机场景的前提并阐明真实部署模型：**单实例多客户端**（一台服务器一个 DSH、监听端口供浏览器访问；两台机器即两个独立 DSH、两个独立 home）——跨主机双客户端共享 DSH home **不属于**产品部署形态，与 2026-09-06「远程企业平台=永久非目标」裁决同族。据此：

- 待办 11 **关闭**（✅）：依赖链矩阵、同机跨进程互斥、跨主机语义防御性合同化均已完成；**真实 NFS 双客户端验证不再排期**。
- 已交付的防御合同（异宿主锁失败关闭+绝不夺取）保留：正常单实例部署下该分支永不触发，属零成本保险；runbook 留存运维手册 §6.1，供未来主动选择该形态时使用。
- 运维手册措辞由「未运行」改为「不排期（用户裁决）」，绑定测试同步更新——文档必须持续说"未验证"，但不再暗示"待办"。

## 2026-09-11 跨主机文件锁语义（11 号待办收尾；change `harden-cross-host-lock-semantics`，已归档）

用户指定 11 号待办（多宿主并发的剩余边界：跨主机文件锁语义）。接线定性：锁以**目录 rename 原子抢占**（共享盘上由 NFS 服务端 RENAME 原子性保证）；`recoverDeadOwner` 对**异宿主** owner 记录**故意不恢复**（无法探测异主机进程死活，夺取可能偷活主）——该安全设计此前无合同无测试。

- **合同**：`multiprocess-workspace-lock` 扩展两条——异宿主遗留锁**失败关闭且不得被改动**（竞争者超时错误指名持有 host/pid）；共享 FS 依据与验证边界文档化（由测试绑定）。
- **运行时小改**：超时错误 best-effort 读取 owner 文件拼入 `held by host "X", pid Y`（前缀逐字不变；Mimosa 对 `.exec(` 的误报以等价 `String.match` 规避）。
- **测试**：`workspace-lock-cross-host.spec.ts`（4 项，真实子进程）：异宿主锁→超时+指名 host/pid+锁目录逐字节不变；异宿主 pending 工件→清扫后原样保留；同宿主死主→正常恢复获锁（回归守卫）；手册绑定。伪主机名先断言 ≠ 本机 hostname（防空转）。
- **文档**：运维手册 §6.1「跨主机/共享盘上的工作区配置锁」：语义声明、人工恢复两步、**真实 NFS 双客户端验证 runbook**（精确命令）并**如实标注未运行**。
- **边界（诚实）**：真实 NFS 双客户端互斥验证**未运行**——集群仅 local-path（无 RWX）、本机挂载需 sudo；已由文档绑定测试钉住，不得宣称已验证。

**验证**：`pnpm run check` 73 文件 / **565** 测试全绿；`openspec validate --all --strict` 全过（38 项 = 37 spec + 本 change）。

## 2026-09-11 A03-a 零验证界面标注 + A12-a/b drain 检查与版本可追溯（change `harden-drain-and-verification-visibility`，已归档）

用户授权后实现 P2-6 的最小可测切片。三项均在**无合同依据**处新建/扩展合同（先行 `openspec validate` 再实施）：

- **A03-a（零验证一等只读信号贯通到界面）**：新增客户端纯函数 `pactFlowVerificationLabel(count)`——`count===0` 返回显式「无自动验证」语义键，而非计数 `0`；`overlay.tsx` 运行行改用它；新增中英本地化键。这样「没有自动验证」不再被读成「验证通过、数量为零」。测试 `verification-label.spec.ts`（3，含 NaN/负数 fail-closed）。
- **A12-a（卸载前只读 drain 检查）**：新增 `@Remote('drainStatus')`，跨全部 PactFlow 会话（**含冷会话**——正是卸载时的常见态）汇总非终态 Run 与未成功清理责任，返回派生布尔 `safeToUninstall`；**只读、绝不自动清理、不创建 live 会话**（冷读用 `restore`）。手册 §7 卸载步骤加入 drain 前置与处置说明。测试 `drain-status.spec.ts`（5：无责任/活跃 Run/未完成清理含保留标记/**冷会话可读且可重复无副作用**/文档名绑定 Host 实际 Remote 名）。
- **A12-b（版本可追溯）**：移交摘要新增 `packageVersion` 与 `eventProducerVersion`（取自构建常量与已注册事件生产者，非调用方输入），使旧日志的兼容 reader 版本可从摘要直接读出。`project-handover.spec.ts` 3 → 5。

**验证**：`pnpm run check` 71 文件 / **554** 测试 / 13 包产物全绿；`test:web` 8 通过（overlay 场景无回归——首轮曾报 3 项失败，经 stash 对照与多次复跑确认是**冷启动 sidebar 指针拦截偶发**，与本改动无关，复跑 4 次全绿）；`openspec validate --all --strict` 36/36；archive 后补写新 capability 的真实 Purpose（占位 Purpose 再次触发 validate 失败，已按既有守卫处置）。

## 2026-09-11 真实人工审批（P1-4）落地 + 发布门禁不可满足性修复（P3-15）

**P1-4：`e2e/pactflow-real-approval.e2e.spec.ts` 从骨架改为可运行半自动形态。**

- 形态：真实 Web scaffold（本包 `cordis.patch.yml` + preset 根）→ **真实模型回合**（`DSH_SNAPSHOT=record`，用凭据库里的 `DEEPSEEK_API_KEY`）→ `pactflow_record_review` 触发原生审批接管 → 真实浏览器 `[data-approval-key]` 弹窗 → `Allow once` → 断言落账。
- 新增专用运行器 `scripts/run-real-approval-e2e.mjs`（`pnpm run test:real-approval`）；`run-real-suite.mjs` 中的 keyless `approval` 条目已移除（会静默跳过），并入 `real-suite-inventory` 的 IMPLEMENTED 桶（`REQUIRED_NOT_RUN` 现为空）。
- 真实运行结论（连续 3 次通过，测试体约 11–13s）：实测 `deepseek-official/deepseek-v4-flash` 真实 token 驱动工具链 `pactflow_view → initialize → create_need → transition_need → record_review → view → transition_need`。
- **关键断言（不可绕过性）**：弹窗出现后、点击前，`approval/asked`（`toolName=pactflow_record_review`）恰 1 条，而 `approval/decided` 与 `pactflow/review-recorded` 均 0 条 → **决定未作出前无任何落账**。点击后三者一一对应，`review.source='dsh-approval'`、`approvalRequestId`/`evidenceDigest` 与 asked 一致，门禁 `discussion→confirmed` 真实推进。
- 证据：`docs/b-class-k3s-acceptance-20260911.md` §8；运行手册 `docs/installation-operations-安装运维.md` §9.1。

**P3-15：发布门禁「结构上不可满足」已修好并真实验证（change `harden-release-gate-armability`，已归档）。**

- 原判：`check:release` 与 `real-web-gate` 的通过条件是「网页零跳过」，而武装集漏了两个门控套件的开关（`DSH_REAL_CRASH`、`DSH_REAL_APPROVAL`）→ 该门禁**永远不可能通过**（与 `verify-profile` TDZ 同类的「门禁自身缺陷」）。
- **真实运行又暴露第二缺陷**：首次真实运行显示，即便武装集补全，门禁**只检查凭据存在于库中却不注入子进程 env** → record 模式套件在 `beforeAll` 抛 `requires DEEPSEEK_API_KEY` / `requires PACTFLOW_GITEA_API_TOKEN`，被 vitest **计为跳过**（`numPendingTests=10`）→ 门禁仍不可能通过。这是「让失败自我报告」再次奏效：真实报告比推断更可信。
- 修复：① 新增单一凭据读取器 `scripts/credential-refs.mjs`（三处脚本共用，消除重复与行为差异）；② `run-real-web-gate.mjs` 抽出单一武装集 `realWebGateEnvironment()`（补齐两开关）并**注入解析后的凭据**；③ `check-release.mjs` 复用同一武装集与前置检查，先以可诊断缺失清单失败关闭。
- 守卫：`tests/real-web-gate-prerequisites.spec.ts` 新增**从 e2e 套件源码反推必需开关**与**凭据注入意图**两条——任何未来新门控套件未纳入武装集、或退回「只查不注入」，离线测试立即失败（防复发）。
- **真实验证（关键）**：修复后 `node scripts/run-real-web-gate.mjs`（`DSH_SNAPSHOT=record`）**真实全绿**：**20 套件 / 21 测试，0 跳过 0 失败**，退出码 0（含真实 K3s、Gitea 保护 PR、模型、浏览器、人工审批）。报告留证于 `~/.pactflow-reports/real-web-gate-*.json`。
- 上游前置仍在：`check:release` 首个真实步骤 `verify:profile` 需已安装官方 CLI，而官方 `0.1.5-rc.1/rc.2` 均缺 `externalEventProducers` 能力（本轮已实证，见下）。

## 2026-09-11 打包产物与源码一致性核对（发布产物不漂移）

`presets/pactflow/plugin/index.js` 是**构建产物**（gitignore 第 10 行），也是发布 tarball 的一部分——若它与源码漂移，用户运行的就不是当前代码。核对结果：

- **构建确定性**：先取产物 SHA256，`pnpm run build` 后再取，两次**完全相同**（`1e57c80b…`）→ 产物即「当前源码的构建结果」，不存在陈旧。
- **修复确在产物内**：本会话的编排器守卫修复在产物中可见——`if (agent.session.header.origin === "subagent") return;`。
- **测试跑的是产物而非 src**：`tests/domain.spec.ts` 与 `tests/review-authorization.spec.ts` 均 `import … from '../presets/pactflow/plugin/index.js'`，故编排器守卫等断言实际验证的是**发布产物**（比只测 src 更强）。
- 结论：发布产物与源码一致，且该一致性由「构建确定性 + 测试导入产物 + `pnpm run check` 先构建」共同保证。

## 2026-09-11 核对计划的两条完成条件（静态可验部分）

`docs/development-plan-开发计划.md` §1 列出「才能声称完成」的硬条件。对其**静态可验**的两条做了核对：

- **「官方 DSH 源码工作树对 PactFlow 为零差异」**：本仓为唯一源码 owner；已核实 `src/` 无任何指向相邻 DSH 开发仓的导入（`deepseek-harness-pactflow-p0`、`../../`、`packages/*/src` 检索均为 0 命中）。
- **「Web 控制台使用 DSH Client Module/Slot/Store/Locale/Theme/Typert Remote，不存在 iframe、第二层 Web 壳或私有 DSH 源码导入」**：已核实无 `iframe`/`webview`/`createRoot`/`ReactDOM.render`；客户端只导入官方 Client 原语（`dsh-client-ui-slots`、`dsh-client-ui-primitives`、`dsh-client-store`、`dsh-client-locale`、`dsh-client-ui-*`、`dsh-api-remotes`、`dsh-typert-protocol` 等）。
- 结论：上述两条**成立**（有源码级证据）。其余条件（安装/升级/卸载全通过、真实多 Harness 支线、安全验收等）依赖真实环境或用户操作，见 CURRENT_STATUS 与待办清单。
- 说明：本次为**静态核对**，不替代 `verify:profile` 的真实安装/启动证据（后者 release 通道仍阻断，dev 通道已跑通）。

## 2026-09-11 修复不可运行的发布门禁 verify-profile（TDZ；change harden-verify-profile-tdz，已归档）

- **发现**：`scripts/verify-profile.mjs` 从第一次调用即抛 `ReferenceError: Cannot access 'COMMAND_TIMEOUT_MS' before initialization`——常量声明在顶层 `try`（首个 `runDsh` 调用处）**之后**，属暂时性死区。
- **影响面**：`pnpm run verify:profile` 与 `verify:profile:dev` **从未真正运行过**；`check:release` 的首个真实步骤即 `verify:profile`，故该发布门禁同样从未跨过此点。比「缺门禁」更糟：它以与验证对象无关的原因报错。
- **修复**：两常量上移至顶层 `try` 之前。此后 `verify:profile:dev` **真实跑通**：`install → boot → upgrade → remove → clean boot passed`；release 通道不再 TDZ 崩溃，而给出设计好的明确错误（`Set DSH_CLI_ENTRY …`）。
- **守卫**：`tests/script-hygiene.spec.ts` 新增 2 项——逐个 `node --check` 全部 `scripts/*.mjs`；断言 `COMMAND_TIMEOUT_MS` 声明早于首个顶层 `try {`。
- **`check:release` 的实际阻断点（已实跑确认）**：运行 `pnpm run check:release` 在其第 9 行 `resolveProfileRuntime` 处失败，错误为本机未设 `DSH_CLI_ENTRY`（需已安装的官方 JavaScript CLI，禁止源码回落）。这是**设计好的上游前置**，与上面 TDZ 那类「脚本自身缺陷」性质不同——前者是「条件未满足」，后者是「脚本根本不可运行」。两者外观相似（都立即抛错），须区分。
- 验证：`pnpm run check` 65 文件 / 528 测试；`openspec validate --all --strict` 30/30。
- 未推送。

## 2026-09-11 本批提交后的真实环境回归验证（22 提交后）

- 目的：本批提交改动了真实路径代码（`k3s-worker.ts` 的代码输入折入与清理、`host/dispatch.ts`、`project-handover.ts` 等），需确认**无回归**。
- 真实集群复跑 `pnpm run test:real-k3s`（真实模型 + 真实 Job/Pod）：**3 个套件 6/6 全通过**——k3s-harness-tasks 3/3（claude/codex/opencode）、harness-probes 2/2、k3s-worker 1/1。
- 残留核对：`pactflow` namespace 无本轮 Job/Pod；验收远程 `pactflow/need/node/*` 分支数**未增加**（仍为 7 个历史残留），即本轮未产生新的分支泄漏。
- 结论：本批改动在真实路径上行为正确、无回归。
- **追加：全部真实套件的提交后复跑（29 提交后）**——`test:real-k3s` **6/6**、`test:real-gitea` **1/1**（受保护 PR 合并，临时 ref 清理）、`test:real-crash-restart` **1/1** 且远程任务分支数 **7→7 未增加**（清理修复持续生效）、`test:real-worker` **1/1**、`test:real-probe-ledger` **2/2**、`verify:profile:dev` install→boot→upgrade→remove→clean boot。`pactflow` namespace 无残留。
- 即：本批 29 个提交在**全部真实路径**上均已复验无回归，而非仅单元测试通过。

## 2026-09-11 证据管线端到端验证（补：收敛重构的真实执行验证）

- 背景：上一项「收敛证据读取/校验为唯一路径」（change `harden-consolidate-evidence-validation`）改动了会被真实命令使用的 `acceptance-gate.mjs` 与 `evidence-collect.mjs`，但当时**只有单测**覆盖。
- 本轮以真实命令端到端验证（非单测）：
  - 构造含 7 个 target + zero-proof 的完整批次 → `pnpm run evidence:verify batch-smoke` **通过**（`acceptance gate: 7 targets verified`）；`node scripts/evidence-collect.mjs batch-smoke` **7/7 collected**。
  - 反例一（未知 conclusion）：`evidence:verify` **失败关闭**并给出 `conclusion must be one of verified-fact|working-assumption|unknown`。
  - 反例二（未知字段 `sneaky`）：`evidence:verify` 报 `unexpected fields sneaky`；`evidence:collect` **同样失败关闭**——证明收敛后**仍在真实校验**，未因重构而跳过校验（若跳过，正向用例也会通过，具误导性）。
- 结论：收敛重构在真实命令路径上行为等价且校验未削弱；临时批次目录已清理。

## 2026-09-11 修复真实崩溃重启套件的远程分支泄漏（change harden-real-suite-cleanup，已归档）

- 真实运行发现：验收远程累积 `pactflow/need/node/*` 分支，而 `test:real-crash-restart` **一直报告通过**——静默泄漏 + 假绿。
- 根因：清理函数用 `names()`（Kubernetes 对象名校验器，禁止 `/`）去校验 **git 分支名** `pactflow/need/node/<id>`，立即抛 `unsafe object name`；外层 `catch { /* may never have pushed */ }` 静默吞掉，因此**从不删除**。
- 修复：新增 `refName()`（允许 `/`，拒绝 `..`/结尾 `.`/结尾 `/`/`.lock`）；清理改为**可验证**（删除后确认引用消失并复核，防被 SIGKILL 的 Worker 迟到 push 重建），失败则显式 `WARNING`；分支未清理时 `verdict.ok=false` 使套件失败（不再假绿）；删除 Job 后先等待再删分支。
- 真实复跑：`test:real-crash-restart` **1/1 通过且无新增残留**；已手动删除本会话产生的 4 个残留分支；历史残留（本 change 之前、含其它前缀）未擅自删除，已记录。
- 同类排查：`test:real-todo`、`test:real-k3s`（harness-tasks）的清理路径**无该校验器误用**，但同样**删除后不复核**——已记为已知边界，未扩范围。
- 验证：`pnpm run check` 62 文件 / 515 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 25/25。
- 未推送。

## 2026-09-11 接线 Harness 能力声明查询 + 未接线助手排查（change harden-harness-capability-query，已归档）

- **排查方法**：逐模块统计「每个导出符号在自身文件之外的引用数」，找「导出且被单测引用、但生产未接线」的助手（对照基线：本轮早前发现的死代码 `maxOutputBytes`）。
- **发现真实缺口**：`harnessCapabilityProfile` 零生产引用，而 `harness-capability-levels` 的场景以「**查询**任一受支持 Harness 的能力声明」表述——声明无法查询，测试在死代码上通过。
- 修复：新增 `PactFlowHarnessCapabilityView`（可序列化）与 `@Remote('harnessCapabilities') listHarnessCapabilities()`（按模板 id 去重，上限取可证级别）；`harness-capabilities.spec.ts` 新增断言（claude `native` / codex `text` / `maxLevel===harnessProbeMaxLevel()`）。
- **非缺口判定（诚实）**：`validationExecutedCount` 与 `retentionRemainingMs` 同为未接线，但经核对**不构成缺口**——契约要求的「运行结果」与「保留清单」已由 `snapshot()`（含 `gitResult.validations`）与 `retentionStatus()`（含 `retainUntil`）提供，计数/剩余时间可据数据得出；属薄包装，**刻意不加线也不删**（加线冗字段、删线破坏既有单测），已在 change 内记录理由。
- 验证：`pnpm run check` 62 文件 / 515 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 24/24。
- 未推送。

## 2026-09-11 修复真实 worker 支线（本仓缺陷；OpenSpec change harden-worker-tool-scope，已归档）

- 现象：`test:real-worker` 长期稳定失败于 `PactFlow Worker produced no commit`；子会话 `stopReason=completed`、工作树零改动。
- **先补可诊断性**（本轮关键突破）：Git 侧结算被拒时把 Worker 自身有界 outcome 折入失败原因。真实运行随即给出 Worker 原话：`every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem.`
- **真因（本仓缺陷）**：`src/agent/index.ts` 的 `agent/session-start` 钩子对**所有** Agent 施加「编排器只读守卫」（deny `bash`/`pwsh`/`write`/`edit`），未区分被委派的 **Worker 子会话**，于是 Worker 的修改类工具在到达文件系统前被拒。
- 更正此前错误结论：早前记录的「宿主沙箱/批准策略」经机制核实不成立（base bundle 默认 `workspace-write`，边界取会话 cwd，子会话 cwd 即任务工作树），已在 `6518f37` 更正。
- 修复：守卫在 `agent.session.header.origin === 'subagent'` 时直接返回；编排器自身只读语义不变。保留 `PACTFLOW_WORKER_PERSONA`（解决独立的只读 persona 文本叠加因素）。
- 对抗性验证：把 origin 判定改为 `false &&` → 回归断言失败（`write` 返回 `isError: true`）；已还原。
- 真实复跑：`pnpm run test:real-worker` **1/1 通过（exit 0）**，此前稳定失败。
- 验证：`pnpm run check` 62 文件 / 514 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 24/24。
- 未推送。

## 2026-09-11 真实 K3s 全批次 + 跨进程锁验证（P3-11/12 推进）

- **P3-12 完整 `test:real-k3s-batch` 真实集群运行**：`suites` 阶段 3 套件 **6/6 通过**（k3s-worker 1/1、harness-probes 2/2、harness-tasks 3/3：claude/codex/opencode）→ `ttl` 阶段观测到 `ttl-after-finished` 回收（`pf-ttl-probe-mtvxhcnk`）→ `zero-proof` 阶段 `{"zero":true,"remaining":[]}`。全程真实模型 + 真实 Job/Pod。
- **P3-11 跨进程锁互斥（新增能力 verified）**：OpenSpec change `harden-multiprocess-lock-verification`（已归档）。发现 `src/workspace-lock.ts` 的 `withWorkspaceFileLock`（跨进程互斥的**唯一**实现）**此前零测试**。新增 `tests/workspace-lock-multiprocess.spec.ts`：**真实 4 个子进程** × 15 次迭代经锁递增共享计数 → 精确 **60**；并配**无锁对照**必须 **<60**，证明断言非空转。
  - 过程缺陷（测试自身）：首版用 `execFileSync`（子进程**顺序**执行），对照用例失败 `expected 60 to be less than 60` → 暴露测试根本不并发；改为 `spawn` + `Promise.all` 后通过。连续 3 次运行稳定 2/2。
  - 归档时 `openspec archive` 写入占位 `## Purpose`（TBD）导致 `validate --all` 失败；已直接改写主 spec 的 Purpose 修复。
- 验证：`pnpm run check` 62 文件 / 514 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` **23/23**。
- 已知边界：**跨主机**（NFS/共享盘）锁语义未验证；`check:release` 仍阻断于上游（需已安装官方 DSH CLI）。
- 未推送。

## 2026-09-11 OpenSpec change harden-harness-capability-honesty（A10 有界增量：能力级别诚实性，已归档）

- 修复两处诚实性缺口：① 级别推导在 `k3s-worker.ts` 有一份本地镜像，与 `harness-capabilities.ts` 并列维护（存在漂移风险）；② `tool-invocation`/`verification` 无探针证据，此前仅靠「无对应分支」隐式不虚报，无常量/测试守护。
- 已实现：新增 `PACTFLOW_HOST_ATTESTABLE_LEVELS`（connection/protocol/artifact/cancellation）、`PACTFLOW_PROBE_STAGE_LEVEL`（阶段→级别）、`harnessProbeMaxLevel()`；`harnessAchievedLevel` 改为按显式映射取最高成功阶段、未知阶段（含 `tool-invocation`/`verification`/未来名）**忽略而非推断**；`k3s-worker.ts` 删除本地重复推导并委托共享函数；镜像探针与 API 探针补报 `achievedLevel`/`maxLevel`；`PactFlowApiProbeResult` 补字段。
- 对抗性验证：把 `verification` 加回映射 → 诚实性测试失败（2 failed / 6 passed）；已还原。
- 验证：`pnpm run check` 61 文件 / 511 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：未为 `tool-invocation`/`verification` 增设证据来源（属新能力）。
- 真实集群复跑：`DSH_K3S_E2E=1` 跑 `pactflow-harness-probes.e2e.spec.ts`（真实模型 + 真实 Job/Pod，claude/codex/opencode/dsh 四模板）**2/2 通过**，级别断言（探针 `achievedLevel='cancellation'`、API 探针阶段不含 `cli-response`）在真实路径成立。
- 未提交、未推送。

## 2026-09-11 真实 dogfood 发现并修复 K3s 代码输入断链（OpenSpec change harden-k3s-code-input-baseline，已归档）

- 用真实小网页项目（`zeromai-demo`）跑**两节点依赖链** dogfood（`test:real-todo`：真实模型 + 真实 K3s + 真实 Git + 真实浏览器），发现真实缺陷：`dependency-code-inputs` 的「代码输入成为后序基线」**只在本地 Git 路径实现**，K3s 远端容器从不取回/合并代码输入。
- 真实表现：B 的 `node test-todo-smoke.js` 因 `todo.html` 缺失 exit 1；B 工作树文件列表无前序成果。
- 已修复：`WORKER_SCRIPT` 容器内按精确提交 `fetch --no-tags origin <commit>` + `merge --no-ff --no-edit <commit>`（失败关闭），并以折叠后的 `BASELINE_COMMIT` 衡量 Worker 自身改动；`spec.json` 与 `pactFlowK3sSpecDigest` 纳入 `codeInputs`；K3s 派发的 `materialize` 传 `{ foldCodeInputs: false }` 以保留本地精确 fast-forward。
- 验证：真实两节点链**复跑通过**（B 继承 A 的 `todo.html`；宿主验证 `node test-todo-smoke.js` exitCode 0）；`pnpm run check` 61 文件 / 507 测试 / 13 包产物；`openspec validate --all --strict` 22/22。
- 证据：`docs/b-class-k3s-acceptance-20260911.md` §7。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-output-budget-authority（A11 有界增量：输出上限归预算，已归档）

- 修复一处**名义存在、实际未接线**的预算：`run-budget.ts` 有 `maxOutputBytes` 与测试，但 `boundedOutcome` 用的是硬编码 4096，预算字段从未生效。
- 已实现：`boundedOutcome` 改用 `boundOutputToBudget(redacted, this.runBudget.maxOutputBytes)`（保留先脱敏后截断 + 默认回退）；默认 `maxOutputBytes` 调为 4096（不放大存量）。
- 先失败后通过（观测）：把上限硬编码回 4096 → 新增测试失败（1 failed / 5 passed）；还原后转绿。
- 验证：`pnpm run check` 61 文件 / 505 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：token/用量统计与 paused 状态**未做**（前者 Harness 无 token 字段、后者属领域状态机变更，均需先确认目标/上游能力）。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-retention-capacity（A05 扩展：保留现场磁盘容量，已归档）

- 补 J13（来源 FULL:A05）的容量维度：保留现场可计量、有界、只读呈现，绝不自动删除。
- 已实现：`retention-policy.ts` 新增 `summarizeRetentionCapacity`（未测量场景不贡献字节并令 `measured=false`；`overBudget` 仅在完整测量且达预算时为真）、`measureRetainedSceneBytes`（有界遍历：条目/字节上限即停，缺失根 0 不抛错，返回 `{bytes, capped}`）；`sizeBytes` 入 `types.ts`/`domain.ts`（schema + `cleanupIdentity` 排除集）；`retainLocalFailure` 测量写入；`retentionStatus` 返回容量字段。
- 对抗性验证：将 `measured` 硬改为 `true` → 容量测试失败（1 failed / 9 passed），已还原。
- 验证：`pnpm run check` 61 文件 / 504 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 已知边界：保留现场 UI 入口未做；体积为有界下界（默认 512MB / 20000 条目上限）；不引入自动清理。
- 未提交、未推送。

## 2026-09-11 OpenSpec change harden-host-narrow-ports-dispatch-recovery（R12 剩余：派发/恢复宿主窄端口，已归档）

- 完成上一 change `harden-host-narrow-ports` 遗留的 `DispatchHost` / `RecoveryHost` 的 `ctx` 剥离。
- 已实现：`DispatchHost` 移除 `ctx`，改 `agents()` / `subagents()`（`localExecutionImpl`）；`RecoveryHost` 移除 `ctx`，改 `logger` / `liveSession()`（`recovery.ts` 6 处日志 + 1 处会话读取）；`index.ts` 两工厂提供窄端口，`logger` 为惰性 getter 以保留 `recovery-retry` 纯助手契约。
- 先失败后通过（观测）：收窄接口但工厂 `logger` 仍急切读取 `this.ctx` 时，`recovery-retry.spec.ts` 13 项在**不含 `ctx`** 的宿主替身上全部失败 `Cannot read properties of undefined (reading 'logger')`；改惰性后转绿。`dispatch` 侧为先失败同机制推理（已诚实标注）。
- 验证：`pnpm run check` 61 文件 / 500 测试 / 13 包产物；`pnpm run typecheck`；`git diff --check`；`openspec validate --all --strict` 22/22。
- 归档产物：`host-narrow-ports` spec 新增「派发与恢复宿主不得依赖整个上下文」+3 场景。
- 已知边界：仅剥离整 `ctx` 依赖，端口方法面仍较多（既定「成员回路由实例方法」模式）；跨进程锁/时钟/环境可注入端口未做。
- 未提交、未推送。

## 2026-09-11 真实 Gitea 收口复跑（F05 之后，待办优先级 P1-3）

- 命令：`pnpm run test:real-gitea`（真实受保护仓库 `tianyue/pactflow-acceptance`）。**1/1 通过**（8.7s）。
- F05 契约真实验证：真实保护分支 PR 合并后断言 `pull.merge_commit_sha === closed.release.commit`（release 绑定精确 merge SHA），被合并提交含任务产物，`closeGitNeed` 走隔离复验路径；`cleanupFailures` 为空，派发/PR head 分支真实删除。
- 区别于 2026-09-10 首跑（F05/F06 落地之前）：本次是**行为已改后的真实复跑**。
- 证据：`docs/b-class-k3s-acceptance-20260911.md` §6（该文件已扩为「真实环境 B 类验收证据」，同时覆盖 K3s 与 Gitea）。
- 未提交、未推送。

## 2026-09-11 P0 文档卫生与死骨架清理（待办优先级 P0-1/P0-2）

- P0-1：`CURRENT_STATUS` 中两项 D（`deployed` 枚举语义、强隔离承诺）与「F03 触发前置」标注为**已裁决：保持现状 2026-09-11**，不再列「待裁决」；删除重复的 A04 行。
- P0-2：删除冗余骨架 `e2e/pactflow-k3s-ttl.e2e.spec.ts`（TTL 存在性由 `tests/k3s-cleanup.spec.ts` 断言、真实回收由 `run-real-k3s-batch ttlStage` 验证）；`tests/real-suite-inventory.spec.ts` 守卫重写为显式三分桶（REQUIRED_NOT_RUN / IMPLEMENTED / COVERED_ELSEWHERE），防止骨架被静默清空或误删。
- 验证：`pnpm run check` 61 文件 / 498 测试 / 13 包产物全绿；`git diff --check` 通过。测试数较上批 -1（删除的 TTL 骨架中 1 项被守卫取代）。
- 未提交、未推送。

## 2026-09-11 真实 K3s 验收（用户授权，B 类）

- 用户 2026-09-11 授权真实 K3s 验收；两个 D 类项（`deployed` 枚举语义、强隔离承诺）裁决为**保持现状**。
- **TTL 真实回收**：`PACTFLOW_K3S_TTL_PROBE=1` 跑 `ttlStage`，真实集群观测到 `ttl-after-finished` 回收（两次：`pf-ttl-probe-mtvsd0h1`、`pf-ttl-probe-mtvseqra`），脚本 `finally` 清理探针。
- **零残留归零**：真实 ConfigMap 两态验证——存在时 `zeroProofStage` 判非零并列出精确 UID，删除后判归零。
- **真实运行发现并修复 3 处脚本缺陷**：① `ttlStage` 的 `kubectl wait/get` 缺 `-n pactflow`（首跑失败）；② `kubectlSucceeds` 把任何 `get` 失败当「已消失」→ 假阳性风险，改为只认真正 `NotFound` 的 `observeJobAbsence`；③ `kubectl` stderr 噪音，收紧 `stdio`。修复后在真实集群**复跑通过**。
- 归零自证：`pactflow` namespace 仅剩 7 天前既有 `pf-clone-diag` 与既有 ConfigMap/Secret，无本轮残留。
- 证据：`docs/b-class-k3s-acceptance-20260911.md`。
- 追加（探针账本真实对账）：实现并运行 `pactflow-real-probe-ledger.e2e.spec.ts`（真实 Kubernetes API，无替身）——真实 Job 的 intent→confirmed(UID)→`cleanupProbeIdentity` 按 UID 前置删除→Job 真实消失→重复对账 404 幂等→cleaned 移除；以及「无确认 UID 时失败关闭、不按名删除、责任保留」。**2/2 通过**，集群归零。
- 追加（完整真实 K3s 套件 `test:real-k3s`）：首跑 5/6（负载偶发）、立即复跑 **6/6 通过**（k3s-worker 1/1、harness-probes 2/2、k3s-harness-tasks 3/3）；两次不一致属负载偶发，非本轮改动引入的确定性回归。
- 追加（真实跨进程崩溃重启）：新建多进程验收基建——`scripts/crash-restart-driver.mjs`（独立进程组合真实插件 + JSONL 持久化到共享磁盘根；start 派发真实 K3s Job 后等待被 SIGKILL，resume 在全新进程从磁盘加载）+ `scripts/crash-restart-runner.mjs`（编排 boot→SIGKILL→离线观测→同 DSH_HOME 重启→断言→清理）+ 瘦 e2e spec。**两次稳定通过**：hostKilled、jobObservableAfterCrash、projectPresent、recovered、jobName/branch 精确匹配均为真。修复 2 处真实缺陷：resume 读取恢复会话需用投影而非 live Remote；清理需按 label 补删崩溃遗留 Pod。


## 2026-09-11 OpenSpec change harden-retention-policy（A05 扩展：保留窗口与陈旧标记，已归档）

- A05 已实现「保留失败现场、绝不自动删除」；本 change 补上「有界窗口 + 陈旧标记 + 只读查询」，避免保留成为无界沉默残留，同时仍不自动删除。
- 已实现：新增 `src/retention-policy.ts`（默认 14 天窗口、`retentionRemainingMs`、`isRetentionOverdue`、`summarizeRetainedScenes`）；`CleanupRecord.retainUntil?`（类型+schema）；`retainUntil` 加入 `cleanupIdentity` 可变字段排除集；`retainLocalFailure` 写窗口；只读 Remote `retentionStatus`。
- 过程修正：初版函数名 `retentionAgeMs` 与「剩余窗口」语义不符，被自身测试暴露后改名 `retentionRemainingMs`。
- 验证：`pnpm run check` 61 文件 / 499 测试 / 13 包产物；`git diff --check` 通过。
- 归档产物：`failure-scene-retention-policy` spec。
- 已知边界：未实现自动到期清理与 UI 入口；窗口为固定默认值；未统计保留占用体积。

## 2026-09-11 OpenSpec change harden-k3s-batch-stages（R04 K3s 批次收尾阶段，已归档）

- 覆盖 GPT 评审 R04：`run-real-k3s-batch.mjs` 的 `ttlStage`/`zeroProofStage` 原为 `throw not implemented` 占位。
- 已实现：新增 `scripts/k3s-batch-stages.mjs`（`buildTtlProbeJob` / `evaluateTtlRecycle` / `evaluateZeroProof`）；两个 stage 由占位改为真实实现（TTL：apply 探针 Job→等完成→轮询回收→finally 清理；归零：按 UID 核对并输出结构化 ZeroProof）；未显式武装时失败关闭，不假装已验证。
- 先失败后通过：`tests/k3s-batch-stages.spec.ts` 5 项（UID 替换分支做了 fail-first）；手工验证未武装时两 stage 均以「B-class operation」报错。
- 验证：`pnpm run check` 60 文件 / 493 测试 / 13 包产物；`git diff --check` 通过。
- 归档产物：`k3s-batch-finalization` spec。
- 已知边界：真实集群运行属 B 类未执行；追踪资源清单由调用方提供，未自动收集；「未解释残留」仅接受传入列表。

## 2026-09-11 OpenSpec change harden-host-narrow-ports（R12/J9 宿主窄端口，已归档）

- 覆盖 GPT 评审 R12：宿主拆文件但仍传整个 Cordis Context，职责未真正解耦。
- 已实现：`CleanupHost` 与 `ProbeRecoveryHost` 移除 `ctx: Context`，改窄端口（`logger`；cleanup 另加 `delivery(session)`）；两个模块内 `host.ctx.*` 调用点与 `index.ts` 宿主工厂同步改造。
- 先失败后通过：`tests/host-narrow-ports.spec.ts` 用**不含 `ctx`** 的宿主替身驱动清理对账（先报 `Cannot read properties of undefined (reading 'sessionProjections')`），并更新既有 `cleanup-retention-guard` 替身。
- 验证：`pnpm run check` 59 文件 / 488 测试 / 13 包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
- 归档产物：`host-narrow-ports` spec。
- 已知边界：仅收窄 cleanup/probe-recovery 两个模块；`DispatchHost`/`RecoveryHost` 仍为较大宿主对象（收窄风险高，未做）；纯 reducer（`domain.ts`）已核实无 I/O。

## 2026-09-11 OpenSpec change harden-input-staleness（F03 增强：代码输入过期追踪，已归档）

- 新增纯模块 `src/input-staleness.ts`（`staleCodeInputs`：按依赖比对后序实际消费的提交 vs 依赖最新成功提交）；`codeInputs` 增加可选 `dependency`（含 schema）；只读 Remote `staleCodeInputs(sessionId, nodeId)` 报告过期输入、不修改状态。
- 测试：`input-staleness.spec.ts` 4 项纯函数；`input-staleness-e2e.spec.ts` 1 项可达性边界。
- **Review 关键发现（诚实）**：当前生命周期下「前序成功后再成功重跑」不可达（`retryNode` 仅允许 failed/cancelled，`settleRun` 拒绝二次结算终态），故该触发器在真实路径上不会发生；检测原语与记录已就位，待「已成功节点重跑」能力落地后生效。**未伪造不可达绿灯**。
- 验证：`pnpm run check` 58 文件 / 486 测试 / 13 包产物。
- 归档产物：`code-input-staleness` spec。
- 已知边界：触发路径不可达；未实现自动重跑/自动失效批准。

## 2026-09-11 OpenSpec change harden-run-budgets / harness-capabilities / project-handover（A11/A10/A12，已归档）

- `harden-run-budgets`（A11）：新增 `src/run-budget.ts`（尝试次数上限、输出字节上限，越界显式说明原因）；`retryNode` 超预算即拒绝。测试 `run-budgets.spec.ts` 5 项（含 `retryNode` 强制路径 fail-first）。
- `harden-harness-capabilities`（A10）：新增 `src/harness-capabilities.ts`（六级能力：connection→protocol→tool-invocation→artifact→verification→cancellation；按 stages 推导实际级别，cleanup 失败不得声称 cancellation）；Harness 探针结果新增 `achievedLevel`/`maxLevel`。测试 5 项。
- `harden-project-handover`（A12）：新增 `src/project-handover.ts`（只读移交摘要：阶段、精确 Git 产物、未完成责任含保留现场）与只读 Remote `projectHandover`（在线/冷会话一致）。测试 3 项；过程中修正 Remote 边界类型必须定义在公开类型子路径（Typert 约束）。
- 验证：`pnpm run check` 56 文件 / 481 测试 / 13 包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
- 归档产物：`run-budgets`、`harness-capability-levels`、`project-handover` 三个 spec。
- 已知边界：A11 未含 token/模型调用数用量与「预算耗尽进入 paused」；A10 未含 tool-invocation/verification 的专门探针阶段与真实六级实证；A12 未含卸载前 drain 与 UI 入口。

## 2026-09-11 OpenSpec change harden-local-failure-retention（A05 本地失败保留，已归档）

- 覆盖 GPT 评审附录 A05：本地失败结算不登记清理责任，失败 worktree/分支成为沉默残留；但不应该一律删除（可能含未提交代码）。
- 已实现：`PactFlowCleanupRecord.retain?` 保留标记；`retainLocalFailure` 在本地四处失败结算登记固定 id（`git:<branch>`）责任并去重；`reconcileCleanupsImpl` 跳过 `retain === true` 记录（不重试、不删除）；保留现场默认不删除。
- 过程发现并修正弱验证：集成用例只断言「非 succeeded」时，禁用保留守卫仍通过（清理尝试失败而非成功）；补确定性守卫测试 `cleanup-retention-guard.spec.ts` 直接断言 `retryCleanup` 对 retain 记录零调用。
- 验证：`pnpm run check` 53 文件 / 468 测试 / 13 包产物。
- 归档产物：`openspec/specs/local-failure-retention/spec.md`（2 需求 / 5 场景）。
- 已知边界：未实现保留期限/磁盘体积策略与用户提示；与 K3s 的「失败即清理」刻意不对称；无 UI 展示入口。

## 2026-09-11 OpenSpec change harden-validation-integrity（A03 验证完整性信号，已归档）

- 覆盖 GPT 评审附录 A03 的可实施部分：命令被批准不等于测试实现不可被改弱；空验证配置可能被当成已验证。
- 已实现：新增纯模块 `src/validation-integrity.ts`（`validationSensitiveChanges` 识别任务改动验证敏感文件，确定性/去重/排序；`validationExecutedCount` 报告实际执行数）；`validateResult` 记录该提交的验证敏感改动（**仅上报不阻断**），经 `PactFlowGitResult.validationSensitiveChanges?` 传播。
- 先失败后通过：`tests/validation-integrity.spec.ts` 5 项。
- 验证：`pnpm run check` 51 文件 / 464 测试 / 13 包产物。
- 归档产物：`openspec/specs/validation-integrity-signals/spec.md`（2 需求 / 5 场景）。
- 已知边界：只做可见性，不阻断、不自动判定「测试被弱化」；评审建议的宿主侧独立验收基线与按任务类型的最小验证策略未实现；敏感文件清单为启发式。

## 2026-09-11 OpenSpec change harden-run-time-contracts（A02 时间合同，已归档）

- 覆盖 GPT 评审附录 A02：`activeDeadlineSeconds` 由 `leaseDurationMs` 推导，而 Host 续租只延长所有权——健康长任务会在首个租约间隔被 K3s 终止。
- 已实现：新增 `jobMaxWallClockSeconds`（默认 3600、下限 60）；`plan()` 的墙钟预算不再由租约推导；`leaseDurationMs` 保留为所有权租约并注释说明。
- 先失败后通过：`tests/run-time-contracts.spec.ts` 3 项（先报 `expected 5 to be greater than 60`）；并修正既有 `k3s-worker.spec.ts` 中固化缺陷行为的 `activeDeadlineSeconds: 60` 断言为 3600。
- 验证：`pnpm run check` 50 文件 / 459 测试 / 13 包产物。
- 归档产物：`openspec/specs/run-time-contracts/spec.md`（1 需求 / 3 场景）。
- 已知边界：只分离租约与墙钟预算；心跳停滞与清理时限的显式上限未引入（API 超时已由既有 `withRequestDeadline` 覆盖）。

## 2026-09-10/11 OpenSpec change harden-cluster-identity（A07 集群身份，已归档）

- 覆盖 GPT 评审附录 A07：kubeconfig 路径不是集群不可变身份，同路径换集群后指纹不变。
- 已实现：`connectionFingerprint` 改为摘要 **namespace + 解析出的集群身份（server + 证书颁发机构）**；构造时从 KubeConfig 取当前集群 server 与 CA（`caData`，或 `caFile` 内容摘要）。
- 先失败后通过：`tests/cluster-identity.spec.ts` 3 项（同路径换集群改变、仅 CA 不同改变、同集群稳定）。
- 验证：`pnpm run check` 49 文件 / 456 测试 / 13 包产物。
- 归档产物：`openspec/specs/cluster-connection-identity/spec.md`（1 需求 / 3 场景）。
- 已知边界：以 server+CA 而非集群侧 UID（K8s 无通用全局集群 UID）；指纹变化使历史账本保留责任、不误删，但未实现显式「暂停自动清理并提示复核」流程。

## 2026-09-10 OpenSpec change harden-approval-subject（F04 批准绑定交付对象，已归档）

- 覆盖 GPT 评审 FULL:F04（复现 R08）：批准摘要只绑文本，`createNode` 不推进 Need 修订，故批准后可悄悄扩大交付集合。
- 已实现：新增纯函数 `pactFlowDeliverySubjectDigest`（排序后 (remoteRef, commit) 集合 → SHA-256）；`PactFlowReview.subjectDigest?`（可选，兼容旧事件）；`recordReview` 对 verification 写入摘要；`closeGitNeed` 要求最新 verification 批准摘要等于当前交付对象摘要，缺失或不符即拒绝。
- fail-first 两次：纯函数 4 项先红；收口校验用 `if (false && …)` 禁用后 `subject-drift` 用例收口成功（证明旧批准放行了更大的集合），恢复后转绿。
- Review 修复：`latestVerificationSubject` 改为显式接收 `needRevision`，与 `latestReviewApproved` 基准一致，消除漂移风险。
- 验证：`pnpm run check` 46 文件 / 449 测试 / 13 包产物；`typecheck` 通过。
- 归档产物：`openspec/specs/review-subject-binding/spec.md`（2 需求 / 6 场景）。
- 已知边界：「成功提交变化」的收口级端到端用例未单独构造（由摘要函数单测 + 收口比对同一函数覆盖）；历史无摘要批准失败关闭，需重新确认。

## 2026-09-10 OpenSpec change harden-local-admission（F07 本地派发准入，已归档）
