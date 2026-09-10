## Purpose

为 K3s 运行与探针在执行期间创建的所有 Kubernetes 持久资源建立可核验的身份链：创建前先持久化授权意图，创建后以服务端返回的 UID 确认归属；只有已确认归属的对象才可被删除；身份未知或创建结果不明时保留责任并失败关闭，绝不按可重用名称猜测删除。

## ADDED Requirements

### Requirement: 创建外部资源前必须先持久化授权意图

在创建任何 Kubernetes 资源之前，Host SHALL 先持久化本次操作的授权意图，至少包含：操作编号、Provider/集群身份、namespace 身份、资源种类、选定的临时名称或受控分配规则、数量上限、允许动作、用途与清理范围。意图写入失败时 Host MUST 拒绝创建外部资源，MUST NOT 先创建再补写。

#### Scenario: 意图落盘失败则不产生孤儿资源

- **WHEN** 清理账本/意图存储写入失败
- **THEN** Host 不创建任何 Kubernetes 资源，并返回明确失败

#### Scenario: 新建意图不含虚构 UID

- **WHEN** 创建前写入意图记录
- **THEN** 该记录不含任何 UID 字段，创建后由回执补充精确 UID

### Requirement: 创建回执必须以服务端 UID 确认归属

创建请求成功返回后，Host SHALL 立即持久化服务端返回的精确 UID 与相关版本，并将其纳入本次操作的已确认资源集合。只有进入该集合的对象才被视为本轮拥有。

#### Scenario: 成功创建后纳入 owned 集合

- **WHEN** 创建 Secret/ConfigMap/Job 并收到含 UID 的成功响应
- **THEN** Host 持久化该 UID 并将对象标记为本轮已确认归属

#### Scenario: 无 UID 的成功响应不得当作可删除依据

- **WHEN** 创建响应缺少有效 UID
- **THEN** Host 不将该对象纳入 owned 集合，并按身份未确认处理

### Requirement: 只有已确认归属的对象可被删除

Host SHALL 仅对 owned 集合中具有精确 UID 的对象执行删除，并使用 UID 前置条件；删除不要求对象预先具备 Job ownerReference。创建返回 409（AlreadyExists）的对象从未属于本轮，Host MUST NOT 因本次创建失败而删除同名对象。当读到同名但 UID 不同的对象时，Host MUST NOT 删除该替代对象。

#### Scenario: 创建冲突不删除既有对象

- **WHEN** ConfigMap 创建返回 409，现场存在同名但非本轮的既有对象
- **THEN** Host 对该既有对象发出的删除请求数为 0，并明确报告创建冲突失败

#### Scenario: 同名替换不被删除

- **WHEN** 归属校验后、删除前，同名对象的 UID 已变为另一个值
- **THEN** Host 不删除该替代对象，并记录原 UID 已不在该名称上的事实

#### Scenario: 已确认归属的孤儿可被精确回收

- **WHEN** 本轮创建的对象已持久化 UID，且该对象是唯一残留
- **THEN** Host 以 UID 前置条件删除该对象，404 视为幂等成功

### Requirement: 创建结果不明必须保留责任且失败关闭

当创建请求超时或响应丢失时，Host SHALL 将该资源记录为 `create-outcome-unknown`，MUST NOT 假定未创建，MUST NOT 仅凭名称或标签自动认领或删除。若在结果未定时暂时读到 404，Host MUST NOT 据此单次读取清除创建意图，MUST 覆盖迟到创建窗口或保持显式 unknown。

#### Scenario: 创建超时保留 unknown 责任

- **WHEN** 创建请求超时且无法确认服务端结果
- **THEN** Host 记录 unknown 责任并保留对账入口，不对该名称发起兜底删除

#### Scenario: 迟到创建不被一次 404 抹除

- **WHEN** 结果未定的资源先读到 404，随后该资源实际出现
- **THEN** Host 在观察窗口内仍保留创建意图，不将其判定为不存在

### Requirement: 删除受理不等于删除完成

Host SHALL 区分「删除请求被接受」与「指定 UID 对象已消失」。删除返回 202 或对象处于 terminating（受 finalizer 约束）时，MUST 记录为 `delete-requested` 或 pending，MUST NOT 计为清理完成。删除超时、403 或连接错误 MUST 保留责任、原因与下次对账条件，MUST NOT 当作 404。

#### Scenario: finalizer 延迟不冒充已清理

- **WHEN** 删除请求返回 accepted，但对象因 finalizer 仍存在
- **THEN** Host 将该清理记录保持 pending，不报告零残留

#### Scenario: 删除失败保留责任

- **WHEN** 删除请求超时或返回 403
- **THEN** Host 保留该清理责任并登记重试条件，不将其记为成功

### Requirement: 失败路径必须释放本运行的内存秘密引用

运行/探针准备阶段暂存的内存秘密引用（`pendingRuntimeSecrets` 等）SHALL 在成功、失败、取消、超时与准备对象丢弃的每条终态路径上被释放。释放 MUST NOT 通过删除身份不明的外部资源来实现。释放内存引用 MUST NOT 被表述为已撤销远端令牌；两者分别验收。

#### Scenario: 创建失败后不残留本运行秘密

- **WHEN** 创建流程在绑定完成之前失败
- **THEN** 本运行对应的内存秘密表项回到基线，且不触发任何按名称的外部删除

#### Scenario: 取消与丢弃路径同样释放

- **WHEN** 准备完成后请求被取消或准备对象被丢弃
- **THEN** 对应的内存秘密引用被释放，且未确认身份的外部资源不被删除
