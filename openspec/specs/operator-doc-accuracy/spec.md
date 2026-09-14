# operator-doc-accuracy Specification

## Purpose
确保面向用户的运维文档中与代码事实绑定的关键数字（如各发行版写入/读取的外部事件词汇量）与代码定义一致，并随默认门禁校验：错误的兼容性数字会误导「旧日志能否读取 / 重装是否匹配词汇」的判断，且文档不经校验时无人会发现。

## Requirements

### Requirement: 运维文档中与代码绑定的数字必须与代码一致

面向用户的运维文档中，凡与代码事实绑定的关键数字（例如某发行版写入/读取的外部事件词汇量），SHALL 与代码中的对应定义一致，并 SHALL 随默认门禁（`pnpm run check`）校验。文档数字 MUST NOT 与代码实际不符而无任何机制发现。

#### Scenario: 当前发行版写入数与元组长度一致

- **WHEN** 手册声明某发行版「当前写入 N 类外部事件」
- **THEN** N 等于代码中该发行版所对应的词汇元组长度（0.2.1 → `PACTFLOW_EVENT_TYPES_V0_3`，17 项）

#### Scenario: 历史只读词汇量与元组一致

- **WHEN** 手册声明以 read-only 方式读取旧发行版的词汇量
- **THEN** 该数量等于对应历史元组长度（0.1.0 → 12、0.2.0 → 13）

#### Scenario: 历史词汇仍是当前词汇的子集

- **WHEN** 校验兼容性契约
- **THEN** 每个历史元组的每个事件类型都出现在当前元组中（旧日志仍可读）

#### Scenario: 数字漂移使门禁失败

- **WHEN** 有人改动代码元组或文档数字而使二者不符
- **THEN** 门禁失败并指出不一致，而不是让错误数字静默留存

### Requirement: 分发清单声明的宿主版本号必须绑定代码事实

随包分发的 worker 兼容性清单（`worker/dsh/release-manifest.json`）中**每个镜像其余部分之外、与本仓代码事实一一对应的版本字段** SHALL 与其代码来源一致，并 MUST 由测试绑定：任一侧变更而另一侧未同步时测试失败并指名两侧的具体取值。当前适用字段为 `hostEventProducerVersion`（对应宿主事件生产者版本常量）与 `hostPluginVersion`（对应插件包版本）。

该守卫 SHALL 与运维文档事件计数守卫属同一纪律，MUST NOT 依赖人工核对。镜像自身的标识字段（`image` / `acceptanceImage` digest、`adapterVersion`、`dshVersion`、`protocol`）不在本 Requirement 范围内——它们由构建与钉版流程产生，不存在「代码里的另一份」可供比对。

#### Scenario: 清单与代码生产者版本不一致时失败

- **WHEN** 清单声明的 `hostEventProducerVersion` 与宿主代码的生产者版本常量不一致
- **THEN** 守卫测试失败并指名两侧的具体取值

#### Scenario: 代码升版而清单未同步时失败

- **WHEN** 宿主代码的生产者版本常量升级而清单未更新
- **THEN** 守卫测试失败，升版不得在清单漂移的状态下合入

#### Scenario: 清单与包版本不一致时失败

- **WHEN** 清单声明的 `hostPluginVersion` 与插件包 `package.json` 的版本不一致
- **THEN** 守卫测试失败并指名两侧的具体取值
