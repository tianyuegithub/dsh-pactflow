# gitea-review-gate (delta)

## MODIFIED Requirements

### Requirement: 复查必须有界且结果如实回填

复查 SHALL 可由用户显式触发；若存在后台复查，其间隔与最大次数 SHALL 由本能力**自有的有界合同**给出，且该合同的取值与其定尺理由 MUST 写在实现处，MUST NOT 只以魔数存在。

> 本条此前写作「MUST 取既有运行时合同，MUST NOT 引入第二套硬编码上限」。该前提不成立：`run-time-contracts` 管的是 K3s 所有权租约与 Job 墙钟的关系，与「多久问一次 Gitea」是两个问题，没有可继承的合同。归档 change `gitea-review-gate-closure` 的 `tasks.md` 2.3 已记录这一点，本条是把该记录回写进正文。要求写下定尺理由，是为了保留原表述真正想防的东西——不加解释就多出一套上限。

每次复查 SHALL 如实回填当前缺口：尚缺的批准数，以及每个 status check 的名称与状态（未开始 / 进行中 / 成功 / 失败）。复查次数耗尽 SHALL 保留等待态并指名原因，MUST NOT 自动合并、MUST NOT 静默重建 PR。

#### Scenario: 复查回填具体缺口

- **WHEN** 要求两个批准而当前只有一个，且一个 status check 仍在进行中
- **THEN** 回填状态显示「尚缺 1 个批准」与该检查的进行中状态，而非笼统的「未就绪」

#### Scenario: 复查次数耗尽不自动合并

- **WHEN** 后台复查达到最大次数而前置仍未齐备
- **THEN** 等待态保留并指名「复查次数耗尽」，不发生合并，不重建 PR

#### Scenario: 复查节奏的取值可在实现处读到其理由

- **WHEN** 检查后台复查的间隔与最大次数
- **THEN** 二者是具名常量，其定尺理由（所等待对象的时间尺度、对外部 API 的调用频度）写在同处

### Requirement: 宿主永不代替人批准且不绕过分支保护

宿主 MUST NOT 调用 Gitea 的 approve 或 review 提交接口，MUST NOT 以任何身份提交批准，MUST NOT 修改或临时关闭分支保护规则，MUST NOT 使用管理员强制合并，MUST NOT 触发或重跑 CI。

**收口处于等待态期间**，Agent 面与 Worker 的请求 MUST NOT 触发合并，只能触发复查。

> 后半句此前写作无条件的「Agent 面与 Worker MUST NOT 触发合并」，比它自己的 Scenario 宽，也与设计不符：无分支保护时 `pactflow_close_git_need` 执行的正是正常收口，其前置是人给出的、与交付主体逐字节绑定的 verification 批准。那不是 Agent 代替人批准；无条件表述会把这条正当路径也写成违规。本条真正要防的是「等待期间被绕过」，范围据此与 Scenario 对齐。

#### Scenario: 不存在自动批准路径

- **WHEN** 检查宿主在等待态期间对 Gitea 发起的全部请求
- **THEN** 其中不含任何 approve/review 提交、分支保护修改或强制合并调用

#### Scenario: Agent 不能触发合并

- **WHEN** Agent 面请求推进处于等待态的收口
- **THEN** 请求只能触发复查，MUST NOT 触发合并；前置未齐备时状态不变
