## ADDED Requirements

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
