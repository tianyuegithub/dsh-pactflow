# tasks — gitea-review-gate-closure

## 1. 等待态与持久化

- [x] 1.1 `src/domain.ts`：等待态经既有事件 payload 的**可选结构化字段**表达（PR 编号、head 提交、base 分支、`closingInputDigest`、最近复查结果）；Delivery 投影升 `stateVersion`；**不新增事件类型、不升生产者版本**。验证：单测断言旧读端解析含等待态的日志不失败、生产者声明与既有会话保持可写
- [x] 1.2 `src/index.ts` `closeGitNeed`：`requiredApprovals > 0 || statusChecks.length > 0` 分支由抛错改为创建/复用 PR 并落等待态。**先失败后通过**——先用测试复现当前生产错误原文 `PactFlow closing cannot auto-merge while Gitea approvals or status checks are required`，再转绿。验证：单测
- [x] 1.3 同一 `closingInputDigest` 下复用既有 PR，不创建第二个。验证：单测
- [x] 1.4 重启后从持久事实恢复等待态：等待态随收口清理记录持久，**恢复即投影重放**，无需改 `recovery.ts`。`review-gate-persistence.spec.ts` 用真实服务与真实 fold 验证字段完整存活、从零重放结果一致；并修正 `cleanupIdentity`——`reviewGate` 是随复查推进的可变观测注解，与 `retainUntil`/`sizeBytes` 同类，不属资源身份（既有守卫如实拦截后才发现）

## 2. 复查与回填

- [x] 2.1 `src/gitea.ts`：读取 PR 当前批准数与各 status check 名称与状态（未开始/进行中/成功/失败）。验证：单测
- [x] 2.2 显式复查 `@Remote()`：回填**具体缺口**（尚缺几个批准、哪个检查什么状态），不得笼统报「未就绪」。验证：单测断言缺口明细字段齐备
- [x] 2.3 有界后台复查：**立项时「取既有 `run-time-contracts` 合同」的前提有误**——该合同管的是 K3s 租约与 Job 墙钟，不含复查节奏。改为自有的有界合同 `PACTFLOW_REVIEW_GATE_RECHECK_INTERVAL_MS=30s` × `MAX_RECHECKS=40`（约 20 分钟无人值守，匹配 CI 时长且不刷 Gitea API）；次数耗尽保留等待态并指名原因，不自动合并、不重建 PR。验证：单测断言间隔、耗尽与窗口量级
- [x] 2.4 取消贯通：新增 `@Remote('cancelReviewGate')` 撤销等待态并落账；**PR 不被自动关闭**（它是他人可见的外部对象），编号仍可从日志查到；清理记录本身保留。验证：单测 3 项

## 3. 合并与核验（关键：不得分叉）

- [x] 3.1 前置齐备后由宿主合并：**复查在门齐备后直接重新调用 `closeGitNeed`**（收口幂等，复用既有 closing/PR/release），因此「核验实现唯一」是结构性的而非靠约束。守卫断言 `mergePullRequest` 与 `revalidateMergeCommit` 各只有一处调用，且 `recheckReviewGate` 体内不含合并与复验
- [x] 3.2 失败关闭五条：head 漂移 / base 变更 / `closingInputDigest` 漂移 / 任务集合不符 / 检查由成功转失败——逐条先失败后通过，均拒绝合并且保留等待态。验证：单测（5 条独立用例）
- [ ] 3.3 外部手工合并的**宿主级**三条（后台只标记 / 显式通过 / 显式核验失败拒绝）：纯判定层已覆盖（`review-gate.spec` 两条 externally-merged）、挂机层已覆盖（`autopilot-review-gate.spec` 阻塞而非完成），但**贯通 `recheckReviewGate` 与 `closeGitNeed` 的宿主级用例需 closing.spec 的本地 Gitea 桩夹具**，尚未编写；如实未勾
- [x] 3.4 复核并收敛 `gitea.ts` 现有 `mergePullRequest` 对 "not in mergeable state" 的重试逻辑：受保护分支场景下不可合并即拒绝，MUST NOT 演变为绕过保护的循环。验证：单测

## 4. 权限边界守卫

- [x] 4.1 对抗性守卫：检查宿主在等待态期间对 Gitea 发起的全部请求，断言其中**不含**任何 approve/review 提交、分支保护修改、管理员强制合并或 CI 触发调用。验证：单测
- [x] 4.2 Agent 面只读：**未向 Agent 工具面暴露任何评审门入口**（比「只能复查」更强）；守卫断言 `agent/index.ts` 不含 `recheckReviewGate`/`cancelReviewGate`

## 4a. 挂机交互（need-autopilot 修改面）

- [x] 4a.1 `src/host/autopilot-driver.ts` 识别等待态：不计入「连续无有效进展」、不唤醒模型、不调 `pactflow_block_autopilot`；按有界复查合同推进复查。先失败后通过——先证明当前实现会把等待态计为无效进展或空转。验证：`autopilot.spec.ts` 新增用例
- [x] 4a.2 齐备后宿主合并并按既有「真正完成」条件标记挂机完成。验证：单测
- [x] 4a.3 复查耗尽：保持授权与等待态、持久报告「自动复查已耗尽」、不撤销授权、不合并；人手动复查后齐备则挂机继续。验证：单测
- [x] 4a.4 外部手工合并不触发挂机自动完成。验证：单测
- [x] 4a.5 **跨 change 复核**：若 `node-rerun-authorization` 已实施，复核其「已合并入默认分支 → 拒绝重跑」场景在本 change 的外部合并标记下仍成立。验证：对应单测全绿

## 5. 界面

- [x] 5.1 工作台「验收交付」与项目面板呈现等待态、PR 引用与缺口明细，提供显式「复查」按钮。验证：client 单测 + overlay e2e
- [x] 5.2 词条与文案：讲清「在等什么、还缺什么、你可以做什么」，不使用笼统状态词。验证：client 单测

## 6. 终验

- [ ] 6.1 **真实受保护仓库端到端**：真实配置 required approvals 与至少一个 status check；真人在网页点批准；真实 CI 产生检查结果；断言等待态可恢复、缺口回填准确、齐备后宿主合并并完成全部核验、merge commit 与发布提交精确一致。**无 mock 冒充**
- [ ] 6.2 失败路径真实验证：真实制造 head 漂移与检查失败各一次，断言拒绝合并且等待态保留
- [ ] 6.3 真实挂机验证：挂机授权下走到等待态，断言不空转、不唤醒模型；真人点批准后挂机自动完成收口
- [x] 6.4 **事件版本复核**：若 `need-comment-threads` / `need-attachments` 已先实施（生产者已升版），本 change 的「老会话可写」断言在当前版本号上重跑。验证：单测
- [x] 6.5 回归：`pnpm run check` 全绿、`openspec validate --all --strict` 全绿；真实验收证据记入 `docs/implementation-status-实施状态.md`
