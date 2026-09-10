# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 穷尽式排查 | ✅ | 扫描 `src` 全部 `.ts/.tsx` 的运行时导出（function/const/class），统计「定义文件之外的引用数」 |
| 方法修正（诚实） | ✅ | 首版扫描**遗漏 `.tsx`**，把整个 client 的消费者都判成孤儿（175 个假阳性）；修正后降为 28 个候选，再逐项归类 |
| 归类 | ✅ | 多数为模块内使用（`isValidationSensitivePath`、`schema.ts` 各 schema、`infrastructureFingerprint`、client 的 `nextId`/`credentialRefFor` 等），或仅为类型别名；**仅 `retentionRemainingMs` 连模块内都无调用** |
| 契约核对 | ✅ | `failure-scene-retention-policy` 只要求「保留总数 + 超期清单」；spec 内无「剩余时间」字样 → 该助手无契约 |
| 处置 | ✅ | 删除 `retentionRemainingMs` 与仅覆盖它的用例（不动有契约/有调用的能力） |
| 验证 | ✅ | `pnpm run check` 62 文件 / **514** 测试（原 515）；`pnpm run typecheck` 通过 |

## 判断依据（诚实）

- 与 `harnessCapabilityProfile` 的对比是本次判定的关键：后者**有契约场景要求可查询** → 正确处置是**接线**；本处的 `retentionRemainingMs` **无任何契约要求且无调用** → 正确处置是**删除**。二者同属「被声明却不生效」，但处置相反，取决于是否有契约需求。
- 保留的同类（`validationExecutedCount`）**未删**：它虽零调用，但 A03 提案（`docs/decisions-a03-a12-裁决提案.md`）建议把它接成一等「零验证」信号，删掉会与待裁决项冲突；已在该提案中记录，等裁决。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 查询面不含无契约字段 | 无新增测试：以「删除 + 全仓零引用」为证；`retention-policy.spec.ts` 其余用例继续覆盖查询面 |
| 已交付能力仍可用 | `retention-policy.spec.ts` 的窗口/超期/容量用例（删除后仍全绿） |

## 已知边界（诚实）

- 本次为**净删除**，未新增测试；「查询面不含无契约字段」这一场景由「该导出已不存在」直接成立，而非由断言守护。若希望此类回归可被测试捕获，需引入静态检查（属工具链改动，未做）。
- 扫描只覆盖 `src/`（不含 `scripts/`、`e2e/`）；这两处的未引用导出未排查。
- `validationExecutedCount` 按其裁决提案暂留（见上）。

## 验证

`pnpm run check` 通过：62 个测试文件、514 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
