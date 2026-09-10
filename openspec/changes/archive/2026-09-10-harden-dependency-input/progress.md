# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 失败测试 | ✅ | `tests/dependency-input.spec.ts` 先因无 code-input 注入而失败（B 找不到前序文件） |
| 1.2/1.3 声明与校验 | ✅ | `PactFlowNode.codeInputs?`、请求字段、schema；`createNode` 要求 codeInputs ⊂ dependencies |
| 2.1/2.2 注入精确提交 | ✅ | `codeInputCommits` 取最新成功 Run 的精确 commit；`plan` 记录、`materialize` 按精确提交 fetch+merge；冲突/缺失失败关闭 |
| 2.3 dispatch 接线 | ✅ | 两处 `plan` 调用传入；端到端测试通过 |
| 3.1 收口失败测试 | ✅ | `closing.spec.ts` 新增 `code-input-chain`，先报 `PactFlow integration branch task-set digest changed after verification` |
| 3.2 依赖闭包不变量 | ✅ | `verifyTaskSet` 改写为：预期提交须为集成祖先；引入提交须属「预期提交祖先闭包 ∪ 首父合并提交」；首父合并额外父须为预期提交 |
| 3.3 对抗性验证 | ✅ | `tests/task-set-authorization.spec.ts`：未授权提交被拒、依赖链被接受、独立多任务被接受 |

## 两次 fail-first（都验到真实根因）

1. **代码输入**：禁用注入后 B 报 `B baseline is missing the predecessor file api.txt` —— 正是 F03 缺陷。
2. **收口不变量**：`code-input-chain` 在不改写 `verifyTaskSet` 时失败（`task-set digest changed`），证明「前序成果进入后序历史」确实打破旧的独立合并假定，必须联合修正。

## Review 的关键产出：收紧不变量不能削弱拒绝力

改写 `verifyTaskSet` 是安全关键改动。仅靠既有测试通过不算证明，故新增**对抗性**测试：构造「集成分支除预期任务外还合并了一个未预期提交」的真实 Git 场景，断言仍被拒绝；并以「任务仅有的集成」与「依赖链」作正常对照。两者均通过，说明放宽到「接受依赖链」的同时未产生越权接受。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 后序任务能看到前序成果 | `dependency-input.spec.ts`（B 检查 api.txt 存在且写出 consumer.txt） |
| 代码输入必须是已声明的依赖 | `createNode` 的 `codeInputs` 子集校验（非依赖即抛错） |
| 前序提交不可获取时失败关闭 | `materialize` 的 fetch/merge 失败分支 |
| 合法依赖链被接受 | `closing.spec.ts` `code-input-chain` + `task-set-authorization` 依赖链用例 |
| 未授权提交被拒绝 | `task-set-authorization.spec.ts` 未授权合并用例（先红后绿） |
| 独立多任务仍被接受 | 既有 11 项 closing 用例（各自独立任务）继续通过 |

## 已知边界（诚实）

- **未实现「A 重跑后 B 的旧输入过期」**：评审建议的 `predecessorRunIds` / `inputCommits` / `baselineCommit` 持久化与过期标记未做；本 change 只保证「派发时取最新成功提交」。
- **未区分 order-only / artifact-input**：仅新增 `codeInputs`；artifact/evidence 输入类型留待后续。
- 冲突在 `materialize` 阶段失败关闭（更早暴露），但未做「阻塞在输入准备、交集成任务处理」的更细流程。
- 真实集群下的依赖链任务矩阵未运行（属 B 类）。

## 验证

`pnpm run check` 通过：48 个测试文件、453 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
