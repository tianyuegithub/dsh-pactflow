# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 可诊断性 | ✅ | `settle` 的 Git 侧拒绝分支折入 `Worker reported: <报告>`；`domain.spec.ts` 断言 `produced no commit — Worker reported: done` |
| 真因定位 | ✅ | 真实运行输出：`Worker reported: I could not complete this task: every mutating tool in my scope is blocked by the orchestrator guard before it reaches the filesystem.` |
| 修复 | ✅ | `src/agent/index.ts`：`agent/session-start` 对 `origin='subagent'` 直接返回（编排器仍被拒） |
| 回归测试 | ✅ | `domain.spec.ts` → `makes the PactFlow orchestrator read-only while preserving ordinary and Worker tools`：Worker 子会话保留 `bash/write/edit` 且 `write` 执行成功；编排器仍被移除且 `bash` 被拒 |
| 对抗性验证 | ✅ | 把 origin 判定改为 `false &&` → 该用例失败（`isError: true` 而非 `false`），证明断言有效；已还原 |
| 真实复跑 | ✅ | `pnpm run test:real-worker`：**1/1 通过（exit 0）**，此前稳定失败 |

## 根因（真实证据链）

1. 现象：Worker 子会话 `stopReason=completed`、工作树零改动、结算报 `produced no commit`。
2. 先前的错误结论（已更正）：归因「宿主沙箱/批准策略」——经机制核实不成立（默认 `workspace-write`，边界取会话 cwd，子会话 cwd 即工作树）。
3. 突破口：把 Worker 自身报告折入失败原因后，**Worker 直接说出了原因**——编排器守卫拦截了它的全部修改类工具。
4. 代码定位：`src/agent/index.ts` 的 `agent/session-start` 钩子对**所有** Agent 施加编排器只读守卫，未区分被委派的子会话。
5. 修复后真实路径通过。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| Worker 子会话保留修改类工具且可执行 | `domain.spec.ts#readonly-orchestrator`（worker 分支：`write` 执行成功） |
| 编排器仍被拒绝 | 同用例编排器分支（`bash` 被拒 + 指引文案） |
| 失败原因包含 Worker 报告 | `domain.spec.ts` 的 `missingCommit` 断言（含 `— Worker reported:`） |

## 已知边界（诚实）

- 「Worker 子会话不得被守卫」以**会话头 `origin='subagent'`** 判别；若未来出现不经该标记的其它委派形态，需一并纳入判定。
- persona 遮蔽（`PACTFLOW_WORKER_PERSONA`）仍保留：它解决的是「只读 persona 文本」这一独立叠加因素，与守卫拦截是两个原因，二者都已处理。
- 真实 worker 验收依赖本机 DSH 开发仓 scaffold；该套件此前不在 `check` 内（需 `DSH_SNAPSHOT=record` + 真实模型），故回归保护由 `domain.spec.ts` 的单测承担。

## 验证

`pnpm run check` 通过：62 个测试文件、514 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过；真实 `pnpm run test:real-worker` 通过。
