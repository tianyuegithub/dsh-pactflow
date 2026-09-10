## Purpose

把「人工批准」从对一段文本的批准，升级为对一份**精确交付对象**的批准：verification 批准必须绑定其批准的任务集合与各任务成功提交；当交付对象在收口前发生变化时，旧批准不得继续生效，必须重新确认。

## ADDED Requirements

### Requirement: verification 批准必须绑定交付对象摘要

记录 `verification` 批准时，Host SHALL 计算并持久化该 Need 当前交付对象的确定性摘要，其内容至少包含任务集合与各任务的成功提交。该摘要 MUST 由内容确定性导出（相同集合与提交得到相同摘要，顺序无关）。

#### Scenario: 记录批准时绑定当前交付对象

- **WHEN** 一个 Need 的全部任务均已成功，用户记录 verification 批准
- **THEN** 该批准记录携带由这些任务编号与其成功提交计算出的摘要

#### Scenario: 摘要与顺序无关

- **WHEN** 同一组任务与其成功提交以不同输入顺序计算摘要
- **THEN** 得到相同的摘要值

### Requirement: 交付对象变化必须使旧批准失效

Host 在收口前 SHALL 重新计算当前交付对象摘要，并要求它与最新 verification 批准记录的摘要一致。若不一致（新增任务、替换成功提交、改变任务集合），Host MUST 拒绝自动收口。若最新 verification 批准缺少摘要（历史记录），Host MUST 拒绝并提示需要重新确认，MUST NOT 默认放行。

#### Scenario: 批准后新增任务导致拒绝收口

- **WHEN** verification 批准之后该 Need 新增了一个任务节点（即使 Need 修订未变）
- **THEN** 收口被拒绝，要求重新确认交付对象

#### Scenario: 批准后成功提交变化导致拒绝收口

- **WHEN** verification 批准之后某任务的成功提交被替换为另一个提交
- **THEN** 收口被拒绝

#### Scenario: 交付对象未变时正常收口

- **WHEN** 收口时任务集合与成功提交与批准时完全一致
- **THEN** 收口继续执行

#### Scenario: 缺少摘要的历史批准不放行

- **WHEN** 最新的 verification 批准没有对象摘要（历史记录）
- **THEN** 收口被拒绝并提示重新确认，不默认通过
