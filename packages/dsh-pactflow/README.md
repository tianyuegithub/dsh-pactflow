# dsh-pactflow

零脉 · PactFlow 的 DSH 外部 Bundle。当前里程碑验证一个预构建 Package 能通过官方 Profile 机制同时交付 Host Service、外部 Session 事件生产者、Typert Remote、Agent Preset Root 和原生 Web Client Module。

正式使用要求精确匹配的 DSH 版本，并在安装、更新或移除后重启对应 Profile。此包不修改 DSH 源码，也不运行第二个 daemon。
