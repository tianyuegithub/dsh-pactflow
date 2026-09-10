# B 类真实验收证据（2026-09-10）

用户授权范围：**全部真实套件**。

## 环境

| 项 | 值 |
| --- | --- |
| kubectl context | `default` |
| K3s namespace | `pactflow`（可达） |
| Gitea | `http://192.168.31.7:30000`（API 403=需认证，可达） |
| 验收仓库 | `tianyue/pactflow-acceptance`（受保护 `main`） |
| 凭据来源 | DSH Credentials 文件（`PACTFLOW_GITEA_API_TOKEN` / `DEEPSEEK_API_KEY`），仅由 runner 注入子进程环境，未打印 |

## 结果

| 套件 | 命令 | 结果 | 与本 change 的关系 |
| --- | --- | --- | --- |
| 真实 K3s | `pnpm run test:real-k3s` | ✅ 3 文件 / 6 项通过（88.9s） | 直接验证 F02：真实 Pod 内施工/验证/结算；探针 Job 创建与清理 |
| 真实 Gitea | `pnpm run test:real-gitea` | ✅ 1 文件 / 1 项通过（6.1s） | 直接验证 F01：受保护分支只读前置 + 真实 PR 合并 + 临时 ref 清理 |
| 真实 worker 支线 | `pnpm run test:real-worker` | ❌ 1 项失败：`PactFlow Worker produced no commit`（94s） | **不在本 change 范围**（属 F03/F07/worker 角色，见 known-gaps §3）；失败与 2026-09-06 记录一致，归因子代理侧未在 worktree 产生提交；父侧 initialize/bind_git/create need/node/dispatch 全部成功 |
| 探针账本对账 | `pnpm run test:real-probe-ledger` | ❌ 骨架未实现（`skeleton: … task 4.1`） | 真实集群账本对账断言未实现；本 change 的账本逻辑由隔离测试覆盖 |
| 跨重启崩溃 | `pnpm run test:real-crash-restart` | ❌ 骨架未实现（`skeleton: … tasks 5.1/5.3`） | 真实跨进程崩溃未实现；本 change 的启动对账逻辑由隔离测试覆盖 |

## 清理归零证据（只读）

- K3s `pactflow` namespace 任务/容器组：**归零**（仅剩 2026-09-03 创建的既有 `pf-clone-diag` Job，非本轮产生）。
- Gitea `pactflow-acceptance`：无遗留 `pactflow/` 任务或集成分支（`git ls-remote` 无匹配）。

## 本轮顺带修复

真实 worker 套件的 `afterAll` 引用了从未声明的 `root`（提交于 HEAD，build 不编译 e2e 故未被发现），导致 teardown 抛 `ReferenceError: root is not defined`。已改为引用 `scaffold.workspaceCwd`，并让 `PACTFLOW_KEEP_ROOT=1` 走显式保留分支；**未改动任何断言**。重跑确认 teardown 不再崩溃，唯一失败仍为上述子代理侧 no-commit。

## 结论边界

本 change 的 spec（`git-credential-binding`、`k3s-resource-identity`）对应的真实环境验证（K3s 资源身份、Gitea 凭据与收口）**已通过**。真实 worker 支线失败与两个骨架套件未实现均**不属于本 change 的 spec 范围**，作为显式缺口保留（见 `known-gaps.md`），需后续 change 处理。**本记录不构成整体加固收口声明。**
