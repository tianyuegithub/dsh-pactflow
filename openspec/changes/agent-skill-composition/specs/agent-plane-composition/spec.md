## ADDED Requirements

### Requirement: 零脉 Skill 必须随包分发并按需加载

零脉 SHALL 以 Package-owned 形式随 preset 分发其 skill 目录，经 DSH 原生 skill 注册表与文件系统提供方贡献，并由原生 skill 消费方向模型暴露。模型 SHALL 只在会话目录中看到 skill 名称与简短描述，完整指令 MUST 按需加载，MUST NOT 常驻系统提示。加载的 skill 正文 SHALL 以原生 skill 机制的来源标记进入模型上下文，MUST NOT 被呈现为人的指令。

Skill 内容 MUST NOT 承载任何权限判定——它是指令与知识，宿主门禁 SHALL 继续是唯一的权限边界。

#### Scenario: Skill 目录随包分发且进产物清单

- **WHEN** 校验发布 tarball 的必需产物
- **THEN** 零脉 skill 目录在必需产物清单中，缺失时 `pack:check` 失败

#### Scenario: 完整指令不常驻系统提示

- **WHEN** 会话尚未加载任何 skill
- **THEN** 系统提示中不含任何 skill 的完整指令正文，只有目录条目的名称与简短描述

#### Scenario: Skill 不承载权限

- **WHEN** 某个 skill 的指令文本要求执行超出既有工具权限的动作
- **THEN** 该动作仍被宿主门禁按既有合同拒绝，skill 文本不构成授权

### Requirement: Persona 收缩后红线必须完整保留

Persona SHALL 只保留任何场景都必须成立的红线约束，至少包含：只读编排器身份、不得自行授予或伪造人工批准、不得直接修改共享工作区、任何执行代理调度前必须经原生方案确认、Worker 职责与边界。场景化内容迁入 skill 后，上述红线 MUST 仍在 persona 内。

守卫测试 SHALL 以结构化红线清单逐条检查 persona 是否含各红线的关键约束要素，MUST NOT 退化为整串比对，也 MUST NOT 松到只要文本非空即通过。

#### Scenario: 迁移后红线仍在 persona

- **WHEN** persona 文本被收缩并将场景化内容迁入 skill
- **THEN** 守卫测试断言五条红线逐条仍可在 persona 中识别；删除其中任一条使测试失败

#### Scenario: 红线不得改由 skill 承载

- **WHEN** 试图把某条红线从 persona 移入按需加载的 skill
- **THEN** 守卫测试失败——红线 MUST NOT 依赖模型主动加载才生效

### Requirement: Persona 收缩必须以真实模型套件证明行为不退化

Persona 收缩 SHALL 以 `test:real-worker`、`test:autopilot`、`test:worker-interactions` 三个真实模型套件在收缩后重跑并通过为合入条件。任一未通过或未运行时，收缩 MUST NOT 合入；系统提示字节数的收缩收益 MUST 实测记录，MUST NOT 以估计宣称。

#### Scenario: 真实套件未通过则收缩不合入

- **WHEN** persona 收缩后 `test:real-worker` 失败
- **THEN** 收缩不得合入，须修正后重跑

#### Scenario: 收益实测

- **WHEN** 收缩完成
- **THEN** 实施状态记录收缩前后系统提示字节数的实测对比

### Requirement: Skill 与业务逻辑文档必须单一来源

来自 `docs/business-logic-业务逻辑.md` 的 skill 内容 SHALL 只有一份正文：skill 目录为正文，文档对应章节改为指向 skill。MUST NOT 同时维护两份可独立编辑的正文。

#### Scenario: 文档章节指向 skill 而非复制

- **WHEN** 查看业务逻辑文档中已迁入 skill 的章节
- **THEN** 该章节为指向 skill 的引用，不含与 skill 重复的正文

### Requirement: Skill 不可用时必须显式失败

Skill 注册表、提供方或消费方不可用，或某个被加载的 skill 解析失败时，模型 SHALL 收到显式的不可用告知，MUST NOT 得到静默的空指令。系统 MUST NOT 以「skill 缺失」为由放宽任何既有门禁或工具约束。

#### Scenario: Skill 解析失败时显式告知

- **WHEN** 模型加载一个内容损坏或缺失的 skill
- **THEN** 返回显式的不可用说明，而非空字符串或静默成功

#### Scenario: Skill 缺失不放宽门禁

- **WHEN** 全部 skill 不可用
- **THEN** 既有工具权限、方案确认与人工门禁行为完全不变

### Requirement: 新增注册必须可卸载

本 change 新增的全部 Cordis 注册 SHALL 归属 `ctx.effect()`、`ctx.on()` 或显式 disposer。Bundle remove 后重启，skill 目录条目与相关注册 MUST 全部退出，MUST NOT 残留入口。

#### Scenario: remove 后无残留

- **WHEN** 卸载零脉 Bundle 并重启 Profile
- **THEN** skill 目录中不再出现零脉条目，无任何零脉注册残留
