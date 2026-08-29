# dsh-pactflow

零脉 · PactFlow 的 DSH 外部 Bundle。它通过官方 Profile 机制交付 Host Service、外部 Session 事件生产者、Typert Remote、完整编码 Agent Preset 和原生 Web Client Module；项目状态来自可冷恢复的 Session Event/Projection，Worker 可通过 DSH Subagent Provider 在 Host 分配的 Git worktree 中执行，也可在 K3s digest 镜像中提交任务分支并由 Host 拉回验证。

正式使用要求精确匹配的 DSH 版本，并在安装、更新或移除后重启对应 Profile。此包不修改 DSH 源码，也不运行第二个 daemon。0.2.0 写入新的项目配置事件，同时以只读注册保留 0.1.0 事件词汇的冷恢复能力。
