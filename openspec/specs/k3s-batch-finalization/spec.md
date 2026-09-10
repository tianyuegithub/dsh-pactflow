# k3s-batch-finalization Specification

## Purpose
约束真实 K3s 批次的收尾证明：TTL 回收必须与主动清理分开证明（TTL 仅当 Job 完成且随后消失才成立，手工删除不算）；归零仅当每个被追踪资源都按 UID 确认不存在且无未解释残留才成立；未显式武装的批处理阶段必须失败关闭，不得静默通过。

## Requirements

### Requirement: TTL 回收必须独立证明且不能由手工删除冒充

批次收尾 SHALL 用独立探针 Job 观察 ttl-after-finished：探针 Job 必须能完成（`restartPolicy: Never`、`backoffLimit: 0`），只有在其完成后被集群回收（对象消失）才可判定回收成立。未完成的 Job MUST NOT 被判为已回收。手工删除 Job 后观察到为空 MUST NOT 作为 TTL 生效的证据。探针 Job MUST 在观察结束后被清理。

#### Scenario: 完成且消失才算回收

- **WHEN** 探针 Job 已完成并随后从集群消失
- **THEN** 判定为已按 ttl-after-finished 回收

#### Scenario: 未完成不算回收

- **WHEN** 探针 Job 尚未完成
- **THEN** 判定为未回收（原因：未完成）

#### Scenario: 仍在则未回收

- **WHEN** 探针 Job 已完成但对象仍存在
- **THEN** 判定为未回收

### Requirement: 归零必须按 UID 确认且解释所有残留

归零判断 SHALL 逐项按 UID 核对被追踪资源：只有当每个被追踪资源都确认不存在（按 UID）且没有未解释残留时，才可判定本批归零。同名但不同 UID 的对象 SHALL 被视为替代对象并单列，MUST NOT 被当作被追踪资源仍存在。存在任何被追踪资源仍存在或有未解释残留时，MUST 判定为非归零并列出原因。

#### Scenario: 全部按 UID 消失才算归零

- **WHEN** 每个被追踪资源都按 UID 确认不存在且无未解释残留
- **THEN** 判定为本批归零

#### Scenario: 仍有被追踪资源则非归零

- **WHEN** 存在同名同 UID 的被追踪资源
- **THEN** 判定为非归零并列出该资源

#### Scenario: 同名不同 UID 视为替代对象

- **WHEN** 某被追踪名称下存在不同 UID 的对象
- **THEN** 我们的责任视为已消失（计入归零），该替代对象单列报告

### Requirement: 未武装的批处理阶段必须失败关闭

当真实集群收尾阶段未被显式启用时，脚本 SHALL 失败关闭并说明这是需授权的真实环境操作，MUST NOT 静默通过或假装已验证。

#### Scenario: 未武装时失败关闭

- **WHEN** 未设置启用标记就调用 TTL 或归零阶段
- **THEN** 阶段以明确错误失败，指出这是需授权的真实环境操作
