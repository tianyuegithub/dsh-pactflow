## ADDED Requirements

### Requirement: 分发清单声明的宿主事件生产者版本必须绑定代码事实

随包分发的 worker 兼容性清单（`worker/dsh/release-manifest.json`）中声明的 `hostEventProducerVersion` SHALL 与宿主代码中的事件生产者版本常量一致，并 MUST 由测试绑定二者：任一侧变更而另一侧未同步时测试失败并指名两侧的具体取值。该守卫 SHALL 与运维文档事件计数守卫属同一纪律，MUST NOT 依赖人工核对。

#### Scenario: 清单与代码版本不一致时失败

- **WHEN** 清单声明的 `hostEventProducerVersion` 与宿主代码的生产者版本常量不一致
- **THEN** 守卫测试失败并指名两侧的具体取值

#### Scenario: 代码升版而清单未同步时失败

- **WHEN** 宿主代码的生产者版本常量升级而清单未更新
- **THEN** 守卫测试失败，升版不得在清单漂移的状态下合入
