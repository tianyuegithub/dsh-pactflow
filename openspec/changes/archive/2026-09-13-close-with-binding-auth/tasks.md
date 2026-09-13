## 1. 交付里程碑
- [x] 1.1 完成失败优先合同测试：旧绑定运行 + 现带认证绑定，收口以绑定凭据继续并以测试伪 Gitea 核验使用绑定凭据。
- [x] 1.2 实现 `closeGitNeed` 改为 `resolveGitAuth(binding)` 并保持全部既有拒绝语义。
- [x] 1.3 全量 `pnpm run check` 与 `openspec validate --all --strict` 通过。
- [x] 1.4 打包、部署开发宿主并在真实会话重试 `close_git_need`，记录实际结果（含受保护分支审批门禁的后续人工步骤）。
