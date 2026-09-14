# manifest-producer-version-guard

## Why

`packages/dsh-pactflow/worker/dsh/release-manifest.json` 声明 `"hostEventProducerVersion": "0.5.0"`，而 `src/index.ts:228` 的 `EVENT_PRODUCER_VERSION` 是 `'0.6.0'`。

该字段自引入提交 `1594fa5` 起就是旧值——同一提交把常量从 `0.3.0` 改为 `0.6.0`，清单却写了 `0.5.0`；`3146903` 更新镜像摘要与 `adapterVersion` 时也未连带更新。**全仓库仅该 JSON 自身出现该键，没有任何测试或脚本校验它。**

这是分发清单里一个与代码事实绑定的关键数字发生了漂移——和 `operator-doc-accuracy` 当初为运维文档事件计数设守卫时修的那个缺陷（0.2.1 行写 13 而代码写 17）是同一类。运维文档侧已有守卫，分发清单侧没有。

不影响运行时（无消费者读该字段），影响的是任何人拿清单核对镜像与宿主兼容性时得到错误答案。修复是半小时的事，不该等任何需要重建镜像的 change。

## What Changes

- **补守卫**：新增测试把清单 `hostEventProducerVersion` 与宿主代码生产者版本常量绑定，任一侧变更而另一侧未同步即失败并指名两侧取值。按「先失败后通过」——当前状态下该测试先红。
- **修正数字**：把清单值改为与代码一致。这一步的证据基础：清单写入与常量改值同属提交 `1594fa5`，当前镜像推送于其后的 `3146903`，两处代码都已是 `0.6.0`——即当前 digest 的镜像**就是**在宿主 `0.6.0` 下构建并验收的（`test:worker-container` 与集群内 Pod 验收均在其后），改数字不是新的证据主张，是纠正记录错误。
- **扩展 `operator-doc-accuracy` 的适用面**：从「面向用户的运维文档」扩展到「随包分发的兼容性清单」，使这类数字进入同一守卫纪律。
- **非目标**：不动镜像、不动 `adapterVersion`、不动 `dshVersion`、不动其它清单字段。

## Capabilities

### Modified Capabilities

- `operator-doc-accuracy`：新增「随包分发的兼容性清单中与代码事实绑定的版本号必须由测试绑定」Requirement，并把清单纳入该 capability 的适用面。

## Impact

- **Host**：无代码改动。
- **Worker 分发清单**：`worker/dsh/release-manifest.json` 一个字段值。
- **测试**：新增一个守卫（可并入 `ops-doc-event-count.spec.ts` 同族文件或独立文件）。
- **Client / Agent / Remote / Session Event / Worker Provider**：不涉及。
- **与 `dsh-harness-telemetry` 的关系**：该 change 升 `adapterVersion` 重新钉版前以本 change 归档为前置；钉版后该字段由本守卫钉住。
- **架构对应**：架构 §7「不存在既无证据又无合同的隐性未完成」——一个无守卫的关键数字正是隐性漂移的温床。
