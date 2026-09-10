# DSH PactFlow Development Rules

- 中文交流；结论必须区分已验证事实、工作假设和未知项。
- **OpenSpec 是本仓库开发管理的第一入口**：新增、修改或删除长期行为合同（含跨 Host、Agent、Client、Remote、Session Event 和 Worker Provider 的改动），一律走 `openspec/changes/<change>` 的 propose → apply → verify → archive 流程；`openspec/specs/` 与 change artifacts 是计划与行为合同的唯一正文 owner。
- 本仓库是 DSH 零脉插件的唯一源码 owner；禁止导入、调用、共享或理解 Hermes 零脉的源码、数据库、协议和运行时。
- 生产安装必须运行在未修改的官方 DSH 上。需要 DSH 新通用能力时，只能在独立上游 change 中实现并等待它进入支持的 DSH 发行版；禁止私有 patch 回落。
- `docs/implementation-status-实施状态.md` 只记录当前阶段、最后已验证提交、验证命令和 blocker。
- 所有 Cordis 注册都归属 `ctx.effect()`、`ctx.on()` 或显式 disposer；禁止不可卸载的模块级副作用。
- 原始凭证不得进入 Session Log、Remote payload、Tool result、Git、argv、截图或持久日志。
- Mock 只用于边界清晰的隔离测试；安装、Bundle 卸载、Typert、Client Module、Session 冷恢复、Git、Gitea、Harbor 和 K3s 验收需要真实路径。
- 禁止使用 `reset --hard`、无范围 `restore/clean`、强制推送或提交与当前里程碑无关的文件。
