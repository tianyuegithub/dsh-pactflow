# agent-skill-composition

## Why

开发计划 §7 把零脉 Preset 的 Agent-plane 组合定义为「零脉 Persona、稳定 System Prompt Section、**产品 Skill**、有界模型工具和 Workflow Consumer」。

实际 `presets/pactflow/agent.cordis.yml` 只有六项：`persona`、`agent-instructions`、`tool-bash`/`tool-pwsh`、`tool-fs`、`tool-fs-search`、`pactflow-tools`。**Skill 零注册。**

后果是具体的：

1. **约八段长指令常驻系统提示，每轮都付费**。当前 persona 里塞着：只读编排器红线、单节点优先的拆分判据、执行方案确认的完整协议、本地恢复候选的比对规则、挂机授权的边界与阻断语义、Worker 职责、共享工作区禁令、工作目录约定。其中大部分**只在特定场景才需要**——一个「看看进度」的只读问答，同样要付本地恢复候选比对规则的 token。
2. **该按需取用的知识没有载体**。DSH 的 skill 组正是为此设计：提供方贡献可复用指令，消费方发布为会话目录，模型看到排序后的名称与简短描述并按需加载完整指令，用户也可以 `/name` 直接调用。零脉有大量符合这个形态的内容（收口三层门禁怎么读、保留现场怎么处置、七类资源怎么登记、异常速查），现在它们要么挤在 persona 里，要么只存在于 `docs/business-logic-业务逻辑.md` 里、模型根本读不到。

Preset 已经拥有 Package-owned root（`pactflowPresetRoot`，`cordis.patch.yml` 注入），随包分发 skill 目录是现成的路径，不需要新的分发机制。

## 为什么不做 Workflow Consumer（评审后砍掉）

首版方案同时立了 Workflow Consumer，评审否决，理由记录如下以免日后重提：

计划说「确认方案 → 建节点 → 派发 → 等待 → 回填」是固定骨架，该固化成 workflow。逐项对：建节点——`pactflow_confirm_execution_plan` 已由**宿主**创建；派发——逐节点工具调用，模型本来就能并行；等待——宿主管 Run；回填——宿主 fold。**脚本能做的只剩「多发几次 dispatch」**，而模型并行调工具就能做到。

更根本的冲突：项目已经有一个编排器——`need-autopilot`，**宿主拥有、持久、重启可恢复**。Workflow 是模型写的脚本、跑在 worker thread、随会话消亡，且 DSH 自己声明它「只是隔离，不是安全边界」。这是在一个「宿主持久推进」哲学的系统里放进第二个非持久编排器。收益不清、新增一个自带免责声明的面。

**结论：Workflow Consumer 等有具体用例再立项。** 计划 §7 的那一项据此标为「有意不做」而非「未做」。

## What Changes

- **新增零脉 Skill 集**：以 Package-owned 形式随 preset 分发，经 `@deepseek-ai/dsh-skill` 注册表 + `@deepseek-ai/dsh-skill-filesystem` 提供方贡献，`@deepseek-ai/dsh-tool-skill` 作为消费方向模型暴露按需加载。首批 skill 按场景切分（执行方案拆分判据、本地恢复候选比对、挂机授权边界、收口三层门禁、七类资源登记、异常速查）。
- **Persona 收缩为稳定红线**：只保留**任何场景都必须成立**的约束——只读编排器身份、不得自批准、不得直接改共享工作区、不得以任意方式绕过方案确认、Worker 边界。场景化内容迁入 skill。
- **红线不得随迁移丢失**：迁移后 persona MUST 仍包含全部红线条款，由守卫测试断言关键约束的存在。Skill 加载失败 MUST NOT 静默降级为空指令。
- **Skill 与业务逻辑文档单一来源**：后三个 skill 的内容来自 `docs/business-logic-业务逻辑.md`。复制即漂移，因此**skill 目录成为该三段内容的唯一正文，文档对应章节改为指向 skill**。文档 owner 分工不变（业务逻辑文档仍是派生视图），只是这三段的正文位置迁移。
- **Skill 正文进入模型上下文时的标记**：skill 是新的「进入模型上下文的文本源」，加载时 MUST 以 DSH 原生 skill 机制的来源标记呈现，MUST NOT 被当作人的指令。零脉不另造标记，复用原生。
- **真实模型套件是验收的一部分**：persona 收缩改变模型行为，`test:real-worker`、`test:autopilot`、`test:worker-interactions` 的通过都依赖当前 persona。三者 MUST 在收缩后重跑并通过，否则收缩不得合入。
- **可卸载**：新增注册全部归属 `ctx.effect()` / `ctx.on()` 或显式 disposer，remove 后无残留。
- **非目标**：不做 Workflow Consumer（见上）；不做 skill 的远程服务提供方；不做用户自定义 skill 的管理界面；不做 `ralph` 迭代循环工具的注册；不改变任何现有工具的语义与权限。

## Capabilities

### New Capabilities

- `agent-plane-composition`: 零脉 Agent-plane 组合的完整行为合同——Package-owned skill 的分发与按需加载、persona 红线的最小充分集与迁移不丢失、skill 不可用时的显式失败、skill 与业务逻辑文档的单一来源、真实模型套件作为收缩的验收门、全部注册可卸载。

## Impact

- **Agent**：`presets/pactflow/agent.cordis.yml` 新增 skill 注册表 / 提供方 / 消费方；persona 文本收缩。
- **Preset 包内容**：新增随包分发的 skill 目录（进 `pack:check` 必需产物清单）。
- **文档**：`docs/business-logic-业务逻辑.md` §6 / §2.1 / §9 三段正文迁入 skill，原位改为指向。
- **Host / Client / Remote / Session Event / Worker Provider**：不涉及。
- **依赖**：新增对 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-skill` 的 peer 依赖。当前证据来自 fork 工作树，**属工作假设**。官方发行版目前连 `externalEventProducers` 都没有，「对官方发行版核实」今天无法执行——任务 0 改为「对目标发行版核实，目标发行版出现前以 fork 为准并如实标注」。若目标发行版不含其中任一，本 change 转为上游阻断项，MUST NOT 私有 patch 回落。
- **架构对应**：§3 终局能力 10 的同族要求——Agent 面同样必须使用 DSH 原生机制；§4 不变量「Remote 与 Agent 工具不能自行授予批准」「所有 Cordis 注册可卸载」被本 change 显式覆盖，不放宽。
- **验证路径**：Skill 按需加载需在真实 Preset 组合中验证（干净 `DSH_HOME` + 真实会话）；红线守卫与可卸载性走单测；行为不退化由三个真实模型套件证明。
