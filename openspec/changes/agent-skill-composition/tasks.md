# tasks — agent-skill-composition

## 0. 前置核实

- [ ] 0.1 核实目标 DSH 发行版随附 `@deepseek-ai/dsh-skill`、`@deepseek-ai/dsh-skill-filesystem`、`@deepseek-ai/dsh-tool-skill` 三个包。目标发行版出现前以 fork 为准并在实施状态标注「工作假设」；出现后若缺任一 → 本 change 转上游阻断项，**MUST NOT 私有 patch 回落**

## 1. Skill 分发与注册

- [ ] 1.1 新增随包分发的 skill 目录（Package-owned，走既有 `pactflowPresetRoot` 路径）；纳入 `pack:check` 必需产物清单。验证：`release-artifact.spec.ts` 断言缺失即失败
- [ ] 1.2 `presets/pactflow/agent.cordis.yml` 注册 skill 注册表 + 文件系统提供方 + 消费方；注册归属 `ctx.effect()` / 显式 disposer。验证：单测 + 干净 `DSH_HOME` 真实组合中可见目录条目
- [ ] 1.3 首批六个 skill 落地：执行方案拆分判据、本地恢复候选比对、挂机授权边界、收口三层门禁、七类资源登记、异常速查
- [ ] 1.4 **单一来源**：`docs/business-logic-业务逻辑.md` §6 / §2.1 / §9 正文迁入对应 skill，原位改为指向；不保留重复正文。验证：文档守卫断言该三节无重复正文
- [ ] 1.5 **完整指令不常驻系统提示**：未加载任何 skill 时系统提示不含任何 skill 正文。验证：单测断言

## 2. Persona 收缩与红线守卫（关键）

- [ ] 2.1 先列表：把当前 persona 逐段划分为「红线（留）/ 场景化（迁）」，交人确认后再动。验证：划分表记入实施状态
- [ ] 2.2 persona 收缩为五条红线：只读编排器身份 / 不得自批准或伪造人工批准 / 不得直接改共享工作区 / 任何执行代理调度前必经原生方案确认 / Worker 职责与边界
- [ ] 2.3 **红线守卫**：结构化红线清单 + 逐条关键约束要素检查；删除任一条使测试失败。MUST NOT 整串比对，MUST NOT 非空即过。**先失败后通过**——先删一条证明守卫有效。验证：单测
- [ ] 2.4 **红线不得改由 skill 承载**：把任一红线从 persona 移入 skill 时守卫失败。验证：单测（对抗性）
- [ ] 2.5 收缩前后系统提示字节数**实测**对比，记入实施状态

## 3. 真实模型套件（收缩的合入门）

- [ ] 3.1 收缩后重跑 `test:real-worker` 通过
- [ ] 3.2 收缩后重跑 `test:autopilot` 通过
- [ ] 3.3 收缩后重跑 `test:worker-interactions` 通过（`PACTFLOW_RELAY_IMAGE=<清单 acceptanceImage>`）
- [ ] 3.4 任一未通过 → 收缩不合入，修正后重跑；三者通过才可进入任务 4

## 4. Skill 失败语义

- [ ] 4.1 skill 内容损坏或缺失时模型收到**显式不可用说明**，不得静默空指令。先失败后通过。验证：单测
- [ ] 4.2 全部 skill 不可用时，既有工具权限、方案确认与人工门禁行为**完全不变**。验证：单测（对抗性守卫）

## 5. 可卸载性

- [ ] 5.1 remove 后重启：skill 目录无零脉条目、无残留注册。验证：真实 `DSH_HOME` 的 `verify:profile:dev` 链路

## 6. 终验

- [ ] 6.1 真实 Preset 组合验证：干净 `DSH_HOME` + 真实会话中，模型可见 skill 目录、可按需加载、用户可 `/name` 直接调用。**不以隔离测试冒充**
- [ ] 6.2 回归：`pnpm run check` 全绿、`pnpm run pack:check` 必需产物含 skill 目录、`openspec validate --all --strict` 全绿
- [ ] 6.3 文档同步：`docs/CURRENT_STATUS-当前状态.md` 补 Agent-plane 组合行；开发计划 §7 的「Workflow Consumer」标为有意不做（附本 change 的裁决理由指针）；实施状态记录 token 实测对比与前置核实结论
