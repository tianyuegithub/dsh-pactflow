# run-time-contracts Specification

## Purpose
区分并各自约束 K3s 任务的时间合同：**所有权租约**（Host 续租间隔，只延长所有权）与 **Job 墙钟预算**（Kubernetes `activeDeadlineSeconds`）必须相互独立；墙钟预算不得由租约推导，且必须有下限，避免健康的长时间任务在首个租约间隔被终止。

## Requirements

### Requirement: 所有权租约与 Job 墙钟预算必须独立

Host 为 K3s 任务设置的 `activeDeadlineSeconds` SHALL 来自独立的墙钟预算配置，MUST NOT 由所有权租约时长推导。租约续租延长所有权，MUST NOT 被当作延长任务墙钟预算的手段。墙钟预算 MUST 有下限，使极小配置不会立即终止任务。

#### Scenario: 短租约不缩短任务墙钟预算

- **WHEN** 以很短的租约（例如 5 秒）派发任务且未配置墙钟预算
- **THEN** Job 的 `activeDeadlineSeconds` 取默认值（不随租约缩小），不会在数秒内被终止

#### Scenario: 显式墙钟预算被采用

- **WHEN** 配置了明确的墙钟预算
- **THEN** Job 的 `activeDeadlineSeconds` 等于该值

#### Scenario: 极小墙钟预算被抬到下限

- **WHEN** 配置的墙钟预算低于下限
- **THEN** Job 的 `activeDeadlineSeconds` 取下限值
