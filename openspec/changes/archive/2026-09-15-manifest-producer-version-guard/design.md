# design — manifest-producer-version-guard

## 为什么单独立项

评审对 `dsh-harness-telemetry` 的意见：清单修复捎带在一个要重建镜像、上真实集群的 change 里，等于让一个已知错误再挂几周。改数字 + 补守卫是半小时的事，独立出来立刻能做。

## 改数字是不是证据主张

`dsh-harness-telemetry` 首版 design 认为「修正数字等于声称该镜像已按 0.6.0 验证」，因此把它排在镜像重建之后。复核 Git 历史后这个顾虑不成立：

- `1594fa5`：常量 `0.3.0 → 0.6.0`，同一提交引入清单并写 `0.5.0`——清单从第一天起就是错的，不是「曾经对过后来漂了」。
- `3146903`：当前镜像推送并钉版，代码仍是 `0.6.0`；其后的 `test:worker-container` 与集群内 Pod 验收都在 `0.6.0` 宿主下完成。

所以当前 digest 的镜像**就是**在 `0.6.0` 下构建并验收的。改数字是纠正记录错误，不是新的证据主张。这一判断记入实施状态，作为改数字的依据。

## 守卫落点

与 `ops-doc-event-count.spec.ts` 同族——它已经把运维文档的事件计数绑定到 `PACTFLOW_EVENT_TYPES_V0_x` 元组。新守卫读清单 JSON、读 `EVENT_PRODUCER_VERSION`（需从 `src/index.ts` 导出或迁到可导入位置——注意单测**不以模块方式 import `src/index.ts`**，因此该常量须迁到 `src/domain.ts` 或同类无装饰器模块），断言相等。

「先失败后通过」在这里有天然形态：当前状态下测试就是红的。

## 不做什么

不动镜像、不动 `adapterVersion` / `dshVersion` / 协议版本、不动其它字段。那些归 `dsh-harness-telemetry`。
