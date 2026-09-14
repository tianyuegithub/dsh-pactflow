## ADDED Requirements

### Requirement: 受保护分支要求外部评审时收口必须进入持久等待态

当受保护默认分支存在 required approvals 或 status checks 时，宿主 SHALL 创建或复用对应 PR，并把 PR 编号、head 提交、base 分支与本次 `closingInputDigest` 落为**持久事实**，使需求停在 `closing` 阶段的「等待外部评审」子状态。宿主 MUST NOT 因存在评审要求而放弃收口，MUST NOT 把该情形表达为失败终态。该等待态 SHALL 在宿主进程重启后从持久事实恢复。

#### Scenario: 存在必需批准时进入等待而非失败

- **WHEN** 受保护默认分支要求至少一个批准，宿主执行收口
- **THEN** 宿主创建或复用 PR，落账等待态（含 PR 编号与 head 提交），需求停在 `closing`，且不产生失败终态

#### Scenario: 重启后等待态可恢复

- **WHEN** 宿主在等待态期间被终止并重启
- **THEN** 等待态从持久事实恢复，PR 编号、head 提交与 `closingInputDigest` 与终止前一致，复查可继续

#### Scenario: 复用既有 PR 而不重复创建

- **WHEN** 同一 `closingInputDigest` 下已存在登记的 PR，收口被再次请求
- **THEN** 宿主复用该 PR，MUST NOT 创建第二个 PR

### Requirement: 复查必须有界且结果如实回填

复查 SHALL 可由用户显式触发；若存在后台复查，其间隔与最大次数 MUST 取既有运行时合同，MUST NOT 引入第二套硬编码上限。每次复查 SHALL 如实回填当前缺口：尚缺的批准数，以及每个 status check 的名称与状态（未开始 / 进行中 / 成功 / 失败）。复查次数耗尽 SHALL 保留等待态并指名原因，MUST NOT 自动合并、MUST NOT 静默重建 PR。

#### Scenario: 复查回填具体缺口

- **WHEN** 要求两个批准而当前只有一个，且一个 status check 仍在进行中
- **THEN** 回填状态显示「尚缺 1 个批准」与该检查的进行中状态，而非笼统的「未就绪」

#### Scenario: 复查次数耗尽不自动合并

- **WHEN** 后台复查达到最大次数而前置仍未齐备
- **THEN** 等待态保留并指名「复查次数耗尽」，不发生合并，不重建 PR

### Requirement: 前置齐备后由宿主合并且复用同一段核验

批准数达标且全部 status checks 成功后，宿主 SHALL 执行合并，并继续执行与无保护分支路径**完全相同**的复验、祖先链核验与任务集合核验；清理责任 MUST 先于交付记录持久化。等待路径 MUST NOT 分叉出第二套收口核验实现。

#### Scenario: 齐备后合并并完成全部核验

- **WHEN** 批准数达标且全部检查成功，复查被触发
- **THEN** 宿主合并 PR，核验 merge commit 与发布提交精确一致、祖先链成立、任务集合精确对应本次基线，清理责任先于交付记录持久化

#### Scenario: 核验实现唯一

- **WHEN** 比较等待路径与直接合并路径的收口核验
- **THEN** 二者调用同一段核验实现，不存在各自内联的第二份

### Requirement: 身份漂移与检查回退必须失败关闭

出现下列任一情形时，宿主 SHALL 拒绝合并并保留等待态供人处置：PR 的 head 提交与登记提交不一致；base 分支与登记的默认分支不一致；`closingInputDigest` 与登记值不符；任务集合与本次基线不符；曾成功的 status check 转为失败。宿主 MUST NOT 在上述任一情形下合并，MUST NOT 以「稍后会好」为由继续等待而不指名原因。

#### Scenario: PR head 漂移时拒绝合并

- **WHEN** 等待期间有人向 PR 分支追加提交，使 head 与登记提交不一致
- **THEN** 合并被拒绝且错误指名 head 漂移，等待态保留，不发生合并

#### Scenario: 检查由成功转为失败时拒绝合并

- **WHEN** 某个此前成功的 status check 在复查时变为失败
- **THEN** 合并被拒绝且错误指名该检查，不发生合并

#### Scenario: 收口输入摘要漂移时拒绝

- **WHEN** 等待期间需求 revision 或任务集合变化，导致 `closingInputDigest` 与登记值不符
- **THEN** 合并被拒绝并要求显式重新确认，不发生合并

### Requirement: 宿主永不代替人批准且不绕过分支保护

宿主 MUST NOT 调用 Gitea 的 approve 或 review 提交接口，MUST NOT 以任何身份提交批准，MUST NOT 修改或临时关闭分支保护规则，MUST NOT 使用管理员强制合并，MUST NOT 触发或重跑 CI。Agent 面与 Worker MUST NOT 触发合并。

#### Scenario: 不存在自动批准路径

- **WHEN** 检查宿主在等待态期间对 Gitea 发起的全部请求
- **THEN** 其中不含任何 approve/review 提交、分支保护修改或强制合并调用

#### Scenario: Agent 不能触发合并

- **WHEN** Agent 面请求推进处于等待态的收口
- **THEN** 请求只能触发复查，MUST NOT 触发合并；前置未齐备时状态不变

### Requirement: 等待态必须对人可见且取消可贯通

客户端 SHALL 呈现等待态、PR 引用与当前缺口明细，并提供显式复查入口。用户取消收口时，等待态与在途复查 SHALL 被撤销并如实记录；已创建的 PR MUST NOT 被自动关闭，其存在与编号 SHALL 保留在记录中。

#### Scenario: 缺口明细可见

- **WHEN** 需求处于等待态
- **THEN** 工作台显示 PR 引用、尚缺批准数与每个检查的名称与状态

#### Scenario: 取消撤销等待态但保留 PR 记录

- **WHEN** 用户取消处于等待态的收口
- **THEN** 等待态与在途复查被撤销并落账，PR 不被自动关闭，其编号仍可从记录中查到
