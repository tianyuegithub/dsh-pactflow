# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 失败测试 | ✅ | `tests/k3s-batch-stages.spec.ts` 5 项；对「UID 替换」分支做了 fail-first（临时忽略 UID 后该用例失败，恢复后转绿） |
| 纯判定模块 | ✅ | `scripts/k3s-batch-stages.mjs`：`buildTtlProbeJob` / `evaluateTtlRecycle` / `evaluateZeroProof` |
| TTL 阶段实现 | ✅ | `ttlStage`：apply 探针 Job → 等完成 → 轮询观察回收 → `finally` 清理；未武装时失败关闭 |
| 归零阶段实现 | ✅ | `zeroProofStage`：按 UID 核对追踪资源 → 结构化 ZeroProof；非归零即失败；未武装时失败关闭 |
| 失败关闭验证 | ✅ | 未设环境变量调用两 stage，均以「B-class operation」明确报错 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 完成且消失才算回收 | `treats a disappeared probe Job as recycled…` |
| 未完成不算回收 | 同上（`finished: false` → `reason: 'not-finished'`） |
| 仍在则未回收 | 同上（`exists: true` → `recycled: false`） |
| 全部按 UID 消失才算归零 | `is proven only when every tracked resource is confirmed absent` |
| 仍有被追踪资源则非归零 | `reports remaining tracked resources and unexplained leftovers` |
| 同名不同 UID 视为替代对象 | `does not treat a same-name different-UID object as the tracked one being present` |
| 未武装时失败关闭 | 手工调用两 stage（无环境变量）确认报错 |

## 已知边界（诚实）

- **真实集群运行未执行**（B 类）：本 change 交付的是**判定逻辑 + 阶段实现**，实际 apply/等待/观察回收属需授权的真实 K3s 操作，未运行。
- TTL 观察设计为「探针 Job 完成后消失」；`PACTFLOW_K3S_TRACKED` 的追踪资源清单由调用方提供，脚本未自动收集本批全部资源。
- 未实现「未解释残留」的自动发现，仅接受传入的 `unexplained` 列表。

## 验证

`pnpm run check` 通过：60 个测试文件、493 项测试、13 项包产物；`git diff --check` 通过。
