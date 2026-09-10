# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现不一致 | ✅ | 手册 §7 称「0.2.1 当前写入 13 类外部事件」；代码 `PACTFLOW_EVENT_TYPES_V0_3` 有 **17** 项，且 `PACTFLOW_EVENT_TYPES = PACTFLOW_EVENT_TYPES_V0_3` |
| 精确核算 | ✅ | 以代码逐元组计数：0.1.0=`V0_1` **12**（手册正确）、0.2.0=`V0_2` **13**（手册正确）、0.2.1=`V0_3` **17**（手册错误） |
| 更正 | ✅ | 手册该处改为「**17** 类外部事件（`PACTFLOW_EVENT_TYPES_V0_3`）」 |
| 守卫测试 | ✅ | `tests/ops-doc-event-count.spec.ts` 3 项：当前写入数==V0_3 长度、历史只读数==各自长度、历史词汇为当前词汇子集 |
| 对抗性验证 | ✅ | 把手册改回 13 → 守卫失败并打印实际文本（含「13 类外部事件」）；已还原为 17 后 3/3 通过 |
| 验证 | ✅ | `pnpm run check` 65 文件 / **525** 测试；`openspec validate --all --strict` 28/28 |

## 为什么这条数字值得当缺陷处理

它是**兼容性合同**：运维据此判断「旧日志能否被当前版本读取」「重装是否匹配词汇」。手册偏小 4 项会造成两种误判——低估当前写入面，或据此推断某些事件「不该存在」。文档不经门禁校验，正是本会话反复出现的「声称与事实不符且无人察觉」形态。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 当前写入数与元组长度一致 | `documents the current writer count matching the shipped tuple`（断言含「当前写入 **17** 类外部事件」） |
| 历史只读词汇量与元组一致 | `documents the read-only legacy reader counts matching their tuples`（12 / 13） |
| 历史词汇仍是当前词汇子集 | `keeps all documented event counts mutually consistent with the tuples` |
| 数字漂移使门禁失败 | 同首项（对抗性验证中改回 13 即失败） |

## 已知边界（诚实）

- 守卫只覆盖**已绑定的这一处**数字（外部事件词汇量）。手册中其它与代码相关的表述（如安装命令、包名、版本号）**未**逐条绑定；本 change 未做全量文档-代码一致性校验。
- 断言采用「文本包含预期计数」形式：若有人改写该句措辞（而非改数字），断言会失败并要求同步更新措辞——这是有意为之（措辞变更即要求复核），但会让纯文字润色也需要改测试。
- 未核查 `docs/` 下其它文档（CURRENT_STATUS、开发计划等）中与代码绑定的数字；它们的时效性由各自内容维护。

## 验证

`pnpm run check` 通过：65 个测试文件、525 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过；`openspec validate --all --strict` 28/28。
