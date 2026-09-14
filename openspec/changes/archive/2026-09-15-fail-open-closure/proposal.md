# fail-open-closure

## Why

一次覆盖 `packages/dsh-pactflow` 全部现有代码的四路独立评审（安全与不变量、正确性与边界、测试套件强度、文档与合同一致性）交回一组共同形态的缺陷：**已经写在合同里的失败关闭，在实现里有一个放行的口子**；以及**宿主把自己的失败报告成别人的失败**。

这些不是新能力的缺口，是既有合同的执行缺口。逐条都已在本机复现：

1. **脱敏对多行字符串整体放行**。`redactUrlCredentials` 首行 `if (/[\r\n]/.test(value)) return value`，而 git / execFile 的 stderr 几乎总是多行、且常带 `https://user:token@host`。`boundedOutcome` 是宿主写入事实源的唯一错误文本通道，凭证因此永久落进 Session Event；同一条消息单行却会被正确打码。实测：真实模块直接调用，多行输入原样返回明文。

2. **向人工审批做出虚假的肯定陈述**。验证敏感文件清单的 diff 范围是 `commit~1..commit`（只看任务分支尖端一个提交），且任何计算失败被 catch 成空数组；审批文案随即打印「验证敏感文件改动：无」——把「我们没查出来」当成「没有改动」交给审批人。该处代码注释原本明写「`none` 是显式陈述，所以列表缺失不会被误认为没有改动」，这条保证被同一函数里的两行推翻。另外判定是整路径全等匹配，monorepo 里的子包 `package.json` 一律漏检（本仓自己就在盲区）。

3. **崩溃重启会销毁在途执行**。`phase: 'cleaned'` 在全仓只出现在探针路径，Run 路径一次都没有；`runLedger.remove` 的唯一调用点在启动对账内部、且在按 UID 删除之后。宿主崩溃重启时，集群里仍在运行的 Worker Job 被 `gracePeriodSeconds: 0` + Background 强删，并发的恢复路径随即观测到 `missing` 并把 Run 判失败。用户丢失在途模型执行与已产出提交。

4. **清理责任被静默删除**。三个持久账本：单条记录不合法走 `continue`，而 `persist()` 是全量覆盖——跳过即永久删除，日志里没有一行提示；升级新增必填字段足以让上个版本写的每条记录蒸发（`fingerprint` 当初就是这么加进来的）。`load()` 又用一次性缓存，两个宿主进程共用同一 `DSH_HOME` 时后写者抹掉前者的记录，且任何对账都发现不了——它读的就是同一份陈旧内存。跨进程锁在全仓只保护 `workspace-projects.json` 一个文件。

5. **模型可指名任意 Secret 与任意凭证**。`k3s_git_secret_name` 与 `credential_ref` 都是模型可调工具上的自由字符串，宿主只校验名称形状 / 只校验 `configured`。前者指向的 Secret 会被挂进一个 prompt 由同一模型撰写的 Pod；后者会经 `GIT_ASKPASS` 交给 Git 服务端。`pactflow-git-` 前缀此前只是列举端点的 UI 过滤，不是边界。

6. **凭证绑定的失败关闭被一个无关条件把门**。`git-credential-binding` 要求「组合无法与任何登记配置对应时 MUST 失败关闭」，实现写成 `gitProviders.length > 0` 才检查——空 registry 与 infrastructure 缺失是同一个事实，而这恰是升级后的常见初始态。

7. **宿主的算术错误被报成别人的故障**。输出预算按字节切割后解码，半个字符变成 3 字节 `U+FFFD`，结果越限（实测中文输入 200/200 全部越限），下游通道断言随即抛错、替换掉原始失败原因并使 Run 无法进入终态；`git rev-list` 与验证命令的 1 MiB 上限让中等规模仓库的收口报「任务集校验失败」、让通过的测试套件被报成失败；探针的 Harness 超时固定减 30 秒，15 秒预算得到 1 秒，用户看到「模型连接不可用」。

8. **拒绝结论被吞掉**。挂机驱动丢弃 `recheckReviewGate` 的 `refused`，而拒绝时保留的是旧的 gap：评审者强推改了 head 之后，挂机每 30 秒仍报「尚缺 N 个批准」，直到复查耗尽——真实原因永远不会到达用户。

9. **按名删除的潜伏分支**。`cancel()` 在 `jobUid` 未确认时按可重用名称删除三个子资源且吞掉删除超时，同时违反两条不变量。当前调用点都带 UID 使它不可达，正因如此它才能一直留着。

10. **日常内循环对最大的宿主文件完全空转**。50 个 spec 导入 `lib/` 产物，而 `pnpm test` 不构建、无任何新鲜度守卫。探针实测：在 `initialize()` 首行注入 `throw` 后，`domain.spec.ts` 19 例仍全绿。

## What Changes

- **脱敏逐行执行**：含换行的输入 MUST 按行脱敏后按原分隔符重组，MUST NOT 整体放行。
- **验证敏感改动的范围与未知态**：扫描范围 MUST 覆盖任务全程（基线到交付提交），MUST NOT 只看尖端提交；判定 MUST 按文件名而非整路径全等，使子目录中的同名文件可见；扫描失败 MUST 作为一等的「无法确定」表达，MUST NOT 降级为空清单，人工审批文案 MUST 区分「无」与「核查失败」。
- **对账不得销毁在途执行**：按已确认 UID 删除前 MUST 先确认该 Job 已非活动；活性读不到时 MUST 保留责任而非删除；正常清理完成后 MUST 落 `cleaned` 使账本收敛。
- **账本损坏一律失败关闭**：无法读取的单条记录 MUST 使整次加载失败，MUST NOT 跳过；读-改-写 MUST 在跨进程锁内进行且每次从磁盘重读；一次写失败 MUST NOT 使后续写入永久失效。创建意图 MUST 记录本轮计划的子资源名，且该清单 MUST NOT 被用作任何删除依据。
- **模型指名的 Secret 与凭证 MUST 有归属**：Git Secret 名 MUST 落在 PactFlow Git Secret 前缀内，该约束 MUST 在宿主入口强制而非仅在列举端点过滤；Git HTTPS 凭证 ref MUST NOT 是任何其它已登记资源的凭证。
- **凭证绑定的失败关闭不设前置条件**：登记表为空与设置缺失 MUST 与「对应不上」同等处理。
- **宿主预算不得产出越限或误导的结论**：文本截断 MUST 落在字符边界内且结果 MUST NOT 超过预算；子进程输出上限 MUST 容纳整段历史与整个测试套件的输出，溢出 MUST 与「命令失败」分开表达；Harness 墙钟预留 MUST 按预算比例，MUST NOT 使短预算退化为不可用值。
- **拒绝是结论**：评审门复查得出拒绝时，挂机 MUST 指名该拒绝并阻塞，MUST NOT 继续呈现上一次的缺口。
- **身份未确认即不得删除**：无确认 UID 的取消 MUST 失败关闭；按可重用名称删除的实现 MUST NOT 存在于代码中，即使当前不可达。
- **单元套件 MUST NOT 对陈旧产物取绿**：被测产物比其源码旧时，套件 MUST 失败。
- **非目标**：不改变任何能力的语义范围；不新增事件类型；不升生产者版本；不改变 Agent 工具面；不引入新的运行时依赖。

## Capabilities

### Modified Capabilities

六项均为在既有能力内**新增** Requirement，不替换、不放宽任何既有条款——本 change 关闭的是实现相对既有合同的执行缺口，不改变任何能力的语义范围。

- `credential-safe-display`：脱敏对多行文本同样生效
- `git-credential-binding`：失败关闭不以登记表非空为前置；模型指名的 Git Secret 与凭证必须有归属
- `k3s-resource-identity`：对账不得回收在途资源；正常清理使账本收敛；账本损坏失败关闭；读改写在跨进程锁内；意图记录计划名且不得用于删除；无确认身份的取消失败关闭；集群身份不得退化为路径
- `validation-integrity-signals`：扫描范围覆盖任务全程；按文件名判定；扫描失败是一等未知态
- `run-budgets`：截断不得超预算；子进程输出上限与用途相称；Harness 墙钟预留按比例
- `gitea-review-gate`：复查得出的拒绝必须到达用户

## Impact

- `packages/dsh-pactflow/src/`：`redaction.ts`、`git-workspace.ts`、`validation-integrity.ts`、`run-budget.ts`、`run-ledger.ts`、`probe-ledger.ts`、`infrastructure-health.ts`、`infrastructure.ts`、`k3s-worker.ts`、`index.ts`、`host/probe-recovery.ts`、`host/cleanup.ts`、`host/autopilot-driver.ts`
- 新增测试：`display-redaction`（多行）、`validation-sensitive-scan`、`git-secret-ownership`、`k3s-artifact-secret`、`ledger-durability`、`git-output-budget`、`k3s-budget-arithmetic`、`build-freshness`
- 行为可见变化：空 registry 下的历史 Gitea 绑定由「放行」变为「拒绝并要求重新确认 Provider」；不在 `pactflow-git-` 前缀内的 Git Secret 名由「接受」变为「拒绝」；被 monorepo 子包命中的验证敏感改动由「不报」变为「上报」
