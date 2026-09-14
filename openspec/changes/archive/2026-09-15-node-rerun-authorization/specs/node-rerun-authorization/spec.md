## ADDED Requirements

### Requirement: 已成功节点重跑必须经所有者显式授权且保留全部历史

已成功节点的重跑 SHALL 只在所有者显式授权下发生，并 MUST 以节点当前 revision 做 CAS。重跑 SHALL 保留该节点全部历史 Run 记录、claim、outcome 与 attempt，新 attempt MUST 为既有最大值加一，MUST NOT 覆盖、删除或改写任何历史 Run。重跑事件 SHALL 持久记录授权证据与发起时刻。

模型 MUST NOT 自行发起重跑——Agent 面可建议重跑，但实际重跑 MUST 经既有原生方案确认路径取得**人的**明确选择后由宿主执行。挂机的自动方案选择 MUST NOT 构成该授权（见 `need-autopilot` 的对应 Requirement）。

#### Scenario: 授权重跑保留历史并递增 attempt

- **WHEN** 所有者授权重跑一个已成功且有 2 次历史 Run 的节点
- **THEN** 节点回到 `ready`，两条历史 Run 记录原样保留，新 Run 的 attempt 为 3，节点 revision 加一

#### Scenario: revision 不符时拒绝

- **WHEN** 重跑请求携带的期望 revision 与节点当前 revision 不一致
- **THEN** 重跑被拒绝并指名 revision 冲突，节点状态不变

#### Scenario: Agent 不能自行发起重跑

- **WHEN** Agent 面直接请求重跑一个已成功节点
- **THEN** 请求被拒绝；重跑只能经人的明确方案选择后由宿主执行

### Requirement: 重跑前必须重解析代码输入基线

重跑 SHALL 在派发前重新解析该节点全部依赖的当前提交，MUST NOT 复用上次运行记录的历史基线。解析结果与上次记录不一致的依赖 SHALL 被判定为过期，并 MUST 在授权决策点如实呈现给人（至少含依赖标识、分支、上次记录的提交、当前提交）。

#### Scenario: 过期依赖在授权决策点可见

- **WHEN** 节点上次运行记录的依赖提交与该依赖当前提交不一致，所有者打开重跑授权
- **THEN** 授权界面呈现该依赖的标识、分支、上次提交与当前提交，供人据此决定

#### Scenario: 重跑使用当前基线而非历史基线

- **WHEN** 授权后重跑被派发
- **THEN** 派发使用重新解析的当前依赖提交，不使用上次运行记录的历史提交

### Requirement: 下游只标记不级联

重跑成功产生新提交后，以本节点为代码输入的下游已成功节点 SHALL 被标记为代码输入过期并对人可见；以本节点为代码输入、当前处于 `running` 的下游节点 SHALL 在其结果落账时立即被同样标记（它消费的是旧输入）。宿主 MUST NOT 自动重跑下游、MUST NOT 自动改变下游节点状态、MUST NOT 自动使下游的既有批准失效之外做任何状态变更。是否重跑下游 SHALL 是人的独立决定。

#### Scenario: 下游被标记但状态不变

- **WHEN** 上游节点重跑成功并产生新提交
- **THEN** 以其为代码输入的下游已成功节点被标记为输入过期，其节点状态仍为 `succeeded`，且未被派发

#### Scenario: 过期标记对人可见

- **WHEN** 查看含过期下游的 DAG
- **THEN** 过期标记在 DAG 与需求视图中可见，并指名是哪个上游依赖的哪次变更导致

#### Scenario: 运行中的下游在落账时被标记

- **WHEN** 上游重跑产生新提交时，某下游节点正以旧输入 `running`，随后该下游成功落账
- **THEN** 该下游落账后立即带有输入过期标记，与已成功下游的标记形式一致

### Requirement: 五类情形必须失败关闭

出现下列任一情形时，重跑 SHALL 被拒绝并指名原因，节点状态 MUST NOT 改变：

1. 该节点存在任何未过期的活跃 Run（`claimed` / `running` / `blocked`）；
2. 该节点的提交已合并入受保护默认分支（已进入交付终态）；
3. 节点处于 `archived`；
4. 节点处于 `paused`（须先经既有显式 resume）；
5. 所属需求处于 `closing` 或 `deployed` 阶段。

第 2 条的判定需要 Git 祖先链查询；查询不可得（远端不可达、引用缺失、超时）时 SHALL 同样拒绝并指名「无法判定是否已合并」，MUST NOT 以查不到当作未合并放行。

#### Scenario: 存在活跃 Run 时拒绝

- **WHEN** 节点仍拥有一个未过期的 `running` Run，重跑被请求
- **THEN** 重跑被拒绝并指名该活跃 Run，不发生并发重派

#### Scenario: 已合并入默认分支的节点拒绝重跑

- **WHEN** 该节点的提交已合并入受保护默认分支
- **THEN** 重跑被拒绝并指名「已进入交付终态」，MUST NOT 以重跑表达回滚

#### Scenario: 合并判定不可得时拒绝

- **WHEN** 判定「是否已合并入默认分支」所需的远端查询失败或超时
- **THEN** 重跑被拒绝并指名「无法判定是否已合并」，不放行

#### Scenario: 需求已进入收口阶段时拒绝

- **WHEN** 所属需求处于 `closing` 或 `deployed`
- **THEN** 重跑被拒绝并指名当前阶段

#### Scenario: 暂停节点须先显式恢复

- **WHEN** 节点因预算耗尽处于 `paused`，重跑被请求
- **THEN** 重跑被拒绝并指名需先显式 resume，不绕过既有暂停语义

### Requirement: 重跑必须使既有验证批准失效

重跑改变交付对象。已存在验证批准的需求发生节点重跑后，收口 SHALL 复用既有交付对象漂移检测拒绝继续，要求重新确认已评审的任务集合。重跑 MUST NOT 绕过该检测、MUST NOT 保留失效的批准作为有效证据。

#### Scenario: 重跑后收口要求重新确认

- **WHEN** 需求已取得验证批准，此后某节点被授权重跑并产生新提交，随后请求收口
- **THEN** 收口被既有漂移检测拒绝并要求重新确认已评审的任务集合

#### Scenario: 失效批准不计入证据

- **WHEN** 折叠重跑后需求的批准证据
- **THEN** 重跑前取得的验证批准不被计为对当前交付对象的有效批准

### Requirement: 重跑必须复用既有预算与暂停语义

重跑 SHALL 消耗运行预算并按既有 attempt 上限合同计数，MUST NOT 另设第二套上限。上限耗尽时 SHALL 进入既有的持久 `paused` 状态（落账、可见、派发指名拒绝），MUST NOT 以重复抛错表达。

#### Scenario: 重跑计入 attempt 上限

- **WHEN** 节点历史 attempt 已接近上限，重跑被授权
- **THEN** 新 attempt 计入同一上限判定，不另起计数

#### Scenario: 上限耗尽进入持久暂停

- **WHEN** 重跑使 attempt 超出上限
- **THEN** 节点进入持久 `paused` 并落账，后续派发被指名拒绝，直至显式 resume
