# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 发现残留 | ✅ | 真实运行后 `git ls-remote --heads <acceptance-repo>` 累积 8 个 `pactflow/need/node/*`，另有 `pactflow/t_*`、`wt/*`、`release/*` |
| 根因 | ✅ | `gitDeleteBranch` 内 `names(branch)`：`names` 是 K8s 对象名校验器（`OBJECT_NAME` 不允许 `/`），分支名 `pactflow/need/node/<id>` 必然抛 `unsafe object name`；外层 `catch { /* may never have pushed */ }` 静默吞掉 → **从不删除** |
| 修复 | ✅ | 新增 `refName()`（允许 `/`、拒绝 `..`/结尾 `.`/结尾 `/`/`.lock`）；`gitDeleteBranch` 使用它 |
| 可验证清理 | ✅ | 删除后 `ls-remote` 确认消失 + 等待复核；失败重试后 `log(WARNING: could not delete remote branch ...)` |
| 失败可见（防假绿） | ✅ | 分支未清理 → `verdict.ok=false` + `error: 'remote task branch was not cleaned up'`；曾真实触发（旧代码会静默通过） |
| 真实复跑 | ✅ | 修复后 `test:real-crash-restart` **1/1 通过**且无新增残留 |
| 环境清理 | ✅ | 手动删除本会话产生的 4 个残留分支（`6115ae47-6d8`、`2f87a06a-4f3`、`cbe1cc88-07e`、`e84c983d-184`） |

## 关键判断（诚实）

- 该缺陷是**静默泄漏 + 假绿**：清理抛错被吞，套件始终报通过。与 A11 的死代码 `maxOutputBytes` 同属「约束/清理失效不可见」这一类。
- 修复过程中我的第一版断言过严（要求运行结束后立即不存在），被**真实竞态**触发：被 SIGKILL 的 Worker 仍可能迟到 push，删除后又出现。最终方案是「删除 Job（foreground）→ 等待 → 删除并复核引用消失 → 失败则失败/告警」，既真正清理，也不把可恢复的瞬时状态误判为失败。
- 残留中另有 4 个分支（`0c2c350f`、`1419fea4`、`1dac64ac`、`87d1b900`、`ba4c3c83`、`efe422e1`、`f3826acd`）及 `pactflow/t_*`、`wt/*`、`release/*` 属**本会话之前**的历史残留，**不在本 change 范围**，未擅自删除（删除他人/历史资源需授权；且不属本仓产生的资源）。已在文档中记录。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 运行后不残留远程分支 | `test:real-crash-restart`（清理复核）+ 手动 `ls-remote` 前后对比 |
| 清理失败使套件失败 | 修复前真实触发 `AssertionError: remote task branch was not cleaned up` |
| 迟到的 push 不使删除失效 | 重试 + 复核逻辑（修复过程中被真实竞态验证过） |

## 已知边界（诚实）

- 「迟到 push」的等待窗口为固定 5s + 最多 6 次重试；极端慢的容器可能仍越过窗口（届时套件**失败并告警**，不会静默）。
- 历史残留（本 change 之前产生、含非本仓前缀的分支）未清理，见上。
- 未对其它真实套件（`test:real-todo`、`test:real-k3s`）做同类的「远程分支清理复核」改造；它们各自的清理路径是否也有静默吞错**尚未排查**（已知 `test:real-todo` 的清理为逐条 `push --delete` + `catch { best effort }`）。

## 验证

`pnpm run check` 通过：62 个测试文件、515 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过；`pnpm run test:real-crash-restart` 真实通过且无残留。
