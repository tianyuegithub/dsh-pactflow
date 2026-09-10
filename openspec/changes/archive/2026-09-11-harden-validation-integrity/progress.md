# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/validation-integrity.spec.ts` 先因模块不存在失败 |
| 纯模块 `validation-integrity.ts` | ✅ | `isValidationSensitivePath` / `validationSensitiveChanges`（确定性、去重、排序）/ `validationExecutedCount` |
| 接入 `validateResult` | ✅ | 提交通过验证后，用 `git diff --name-only <commit>~1..<commit>` 识别验证敏感改动，**仅上报不阻断**；经 `PactFlowGitCommitEvidence.validationSensitiveChanges?` 与 `PactFlowGitResult.validationSensitiveChanges?` 传播 |

## 过程中的两次 Mimosa 区块级误报

在 `git-workspace.ts` 内新增方法时，Mimosa 两次以「命令注入」拦截。核查发现命中的是文件中**既有的**正当代码（`try { parsed = new URL(rawBaseUrl) }` 与 askpass 包装器里的 `exec "$PACTFLOW_NODE"`），与改动无关，属插入位置把既有行推入检查窗口导致的区块级误报。为尊重该信号、不做无谓争辩，改为**新增独立模块 `src/validation-integrity.ts`** 承载纯逻辑，`git-workspace.ts` 只做最小接线。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 改动测试配置被记录 | `flags a commit that touches the project verification wiring` |
| 只改普通源码不被记录 | `does not flag ordinary source changes` |
| 记录与文件顺序无关 | `is order-independent and deduplicates` |
| 无验证配置的交付被识别为零验证 | `reports zero executed commands for a delivery with no automatic verification` |
| 执行了验证的交付计数为正 | 同上（非空 validations → 1） |

## 已知边界（诚实）

- 只做**可见性**：识别并上报「验证基础设施被改动」与「零自动验证」，**不阻断**、不自动判定「测试被弱化」。评审真正建议的更强者——宿主侧独立验收基线、按任务类型的最小验证策略、测试基础设施改动单独审查——属更大的设计，未实现。
- 空验证配置仍然合法（既有合同），本 change 只让它可被识别，未改为拒绝。
- 「验证敏感文件」清单是启发式列举，可能漏掉项目自定义的构建/测试入口。

## 验证

`pnpm run check` 通过：51 个测试文件、464 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
