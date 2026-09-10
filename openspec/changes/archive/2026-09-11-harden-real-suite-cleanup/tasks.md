## 1. 修复真实套件的分支清理

- [x] 1.1 真实运行发现残留：验收远程累积 `pactflow/need/node/*` 分支，而套件一直报告通过
- [x] 1.2 定位根因：清理用 `names()`（K8s 对象名校验器）校验**含 `/` 的 git 分支名** → 立即抛错，被 `catch {}` 静默吞掉
- [x] 1.3 修复：新增 `refName()`（允许 `/` 的引用名校验），`gitDeleteBranch` 改用它
- [x] 1.4 清理可验证：删除后确认引用消失并复核，防迟到 push 重建；失败则显式 `WARNING`
- [x] 1.5 失败可见：分支未清理时 `verdict.ok=false`（套件失败），不再假绿
- [x] 1.6 真实复跑：套件通过且无残留；手动清理本会话产生的 4 个残留分支

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [ ] 2.2 运行 `openspec validate harden-real-suite-cleanup --strict`，验证：通过
- [ ] 2.3 记录 spec 场景到测试的映射与已知未覆盖
