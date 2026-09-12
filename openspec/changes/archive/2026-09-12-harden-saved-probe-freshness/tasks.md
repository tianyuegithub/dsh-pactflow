# Tasks: harden-saved-probe-freshness

## 1. 宿主侧

- [ ] 1.1 `index.ts`：settings 注册闭包保存 `savedInfrastructureAccessor`；新增 `infrastructureForSavedProbe()`（访问器优先、快照回退）。验证：build
- [ ] 1.2 五个无 draft 入口切换数据源：`probeInfrastructure`、`listImagePullSecrets`、`listHarborArtifacts`、`listK3sGitSecrets`、`infrastructureDeletionImpact`。验证：单测
- [ ] 1.3 start 阶段文案 `testing the currently saved settings`；`settings-model.ts` 映射锚点与中文同步。验证：单测

## 2. 测试

- [ ] 2.1 新增 `saved-probe-freshness.spec.ts`：启动后保存的 worker-pool 已保存探针立即可测（先红后绿）；`listWorkerPools` 重启前保持 `[]` 钉住只读边界。验证：单测
- [ ] 2.2 既有 settings/k3s-probe/客户端日志收敛测试全绿。验证：`pnpm run check`

## 3. 文档与收口

- [ ] 3.1 运维手册 §3 生效时机说明更新（探针/发现/删除影响即时读已保存配置；运行时资源重启生效）。验证：review
- [ ] 3.2 `pnpm run check` 全绿 + `openspec validate --all --strict` + archive + 实机验证（保存后不重启，外层测试通过）
