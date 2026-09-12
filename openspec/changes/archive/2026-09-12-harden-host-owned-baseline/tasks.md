## 1. 数据与执行

- [x] 1.1 types.ts：`PactFlowValidationEvidence.source?`、`PactFlowClosingGit.baselineValidations?`、配置 `hostBaselineCommands?`、`PactFlowSaveHostBaselineRequest`；domain schema 同步（evidence source、closing.baselineValidations）。验证：build 通过
- [x] 1.2 `prepareClosing` 增基线参数：候选提交上先于任务验证执行，失败抛「host baseline … blocks closing」，成功证据带 source。验证：git fixture 单测三态
- [x] 1.3 `closeGitNeed` 取 workspace 配置一次，策略与基线共用；`prepareClosing` 传入基线命令。验证：build + 既有 closing 测试全绿

## 2. 配置与呈现

- [x] 2.1 `saveHostBaseline` Remote（CAS + 命令边界校验，空数组清除）。验证：单测
- [x] 2.2 项目面板「宿主基线」JSON 编辑区（owner-only 高级配置）+ index.tsx 接线；交接摘要未完成责任附 `baselineValidationsExecuted`。验证：build + 交接单测

## 3. 收口

- [x] 3.1 `pnpm run check` 全绿 + `openspec validate --all --strict` + archive
