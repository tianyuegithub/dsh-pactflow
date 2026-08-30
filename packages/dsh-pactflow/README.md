# dsh-pactflow

零脉 · PactFlow 的 DSH 外部 Bundle。它通过官方 Profile 机制交付 Host Service、外部 Session 事件生产者、Typert Remote、完整编码 Agent Preset 和原生 Web Client Module；项目状态来自可冷恢复的 Session Event/Projection，Worker 可通过 DSH Subagent Provider 在 Host 分配的 Git worktree 中执行，也可在 K3s digest 镜像中提交任务分支并由 Host 拉回验证。

正式使用要求精确匹配的 DSH 版本，并在安装、更新或移除后重启对应 Profile。此包不修改 DSH 源码，也不运行第二个 daemon。0.2.1 写入当前事件词汇，同时以只读注册保留 0.1.0 和 0.2.0 历史词汇的冷恢复能力。

安装到官方 DSH Profile：

```bash
dsh plugin --profile web add dsh-pactflow@0.2.1
```

0.2.1 是等待 DSH 上游通用能力的 Pre-release（预发布版），当前只面向使用已验证 fork 的开发者。Package 不使用隐式 `postinstall`；安装、更新和卸载完全由 DSH 官方 `plugin` 命令拥有。

也可直接安装公开 GitHub Release tarball：

```bash
dsh plugin --profile web add https://github.com/tianyuegithub/dsh-pactflow/releases/download/v0.2.1/dsh-pactflow-0.2.1.tgz
```
