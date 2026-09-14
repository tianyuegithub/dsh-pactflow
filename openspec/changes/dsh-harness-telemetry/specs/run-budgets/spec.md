## ADDED Requirements

### Requirement: token 与调用数用量在可得时纳入预算、不可得时显式标注

运行预算 SHALL 在执行器回报 token 与模型调用数用量时，把该用量纳入运行的呈现与预算判定。用量不可得时，运行记录与界面 SHALL 显式标注「不可得」，**MUST NOT 以 0、空值或任何估算值冒充实际用量**，MUST NOT 据此做出预算判定。

既有的 attempts、时长与 `maxOutputBytes` 三项 SHALL 继续各自作为其维度的单一权威；用量是新增维度，MUST NOT 替代或覆盖既有三项。

#### Scenario: 用量可得时纳入呈现与判定

- **WHEN** `dsh` 执行器回报了 token 与调用数用量
- **THEN** 运行记录持久该用量，界面呈现之，且用量参与预算判定

#### Scenario: 用量不可得时显式标注而非记为零

- **WHEN** 第三方 Harness 的结果文档不含用量字段
- **THEN** 运行记录与界面显式标注「不可得」，用量不被记为 0，也不参与任何预算判定

#### Scenario: 用量维度不覆盖既有权威

- **WHEN** 用量可得且同时存在输出字节上限判定
- **THEN** 输出上限仍由 `maxOutputBytes` 单独决定，用量维度不改变其结论
