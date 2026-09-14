# tasks — agent-skill-composition

## 0. 前置核实

- [x] 0.1 核实结论（对 fork 核实；目标发行版出现前为工作假设）：三个包齐备，且**发行版自带的 `cordis` preset 就是可照抄的参考实现**——skill 行由 preset 自己的 `agent.cordis.yml` 挂载（不是 `cordis.patch.yml`），`customSkillDirs` 以 `baseUrl` 解析 preset 目录，随包分发的 skill 因此天然可用。宿主 profile 里 `skill-filesystem` 与 `tool-skill` 被 `disabled: true`，注释写明「presets own local discovery」。**无需宿主侧 root provider**（与立项设想不同：那里以为要照搬 `pactflowPresetRoot`）。skill **注册表**留在宿主面，preset 只挂提供方与加载工具
- [x] 0.2 skill 文件格式：目录 bundle 内含 `SKILL.md`，YAML frontmatter 为 `name` + `description`（描述须回答「何时该加载」），正文 Markdown
- [x] 0.3 依赖声明：三个包加入根 `devDependencies`（link 到 fork）与插件 `peerDependencies`，并按 `pack:check` 规则声明为 **optional peer**——随宿主自带的 peer 不得强求公开安装时单独安装

## 1. Skill 分发与注册

- [x] 1.1 新增随包分发的 skill 目录（Package-owned，走既有 `pactflowPresetRoot` 路径）；纳入 `pack:check` 必需产物清单。验证：`release-artifact.spec.ts` 断言缺失即失败
- [x] 1.2 `presets/pactflow/agent.cordis.yml` 注册 skill 注册表 + 文件系统提供方 + 消费方；注册归属 `ctx.effect()` / 显式 disposer。验证：单测 + 干净 `DSH_HOME` 真实组合中可见目录条目
- [x] 1.3 首批六个 skill 落地：执行方案拆分判据、本地恢复候选比对、挂机授权边界、收口三层门禁、七类资源登记、异常速查
- [x] 1.4 **单一来源**：`docs/business-logic-业务逻辑.md` §6 / §2.1 / §9 正文迁入对应 skill，原位改为指向；不保留重复正文。验证：文档守卫断言该三节无重复正文
- [x] 1.5 **完整指令不常驻系统提示**：未加载任何 skill 时系统提示不含任何 skill 正文。验证：单测断言

## 2. Persona 收缩与红线守卫（关键）

- [x] 2.1 划分表（记入实施状态）：**留 persona 的五条红线**——只读编排器身份、不得自批准或伪造人工批准、不得直接改共享工作区、任何执行代理调度前必经方案确认、Worker 职责与边界；**迁入 skill 的六段**——执行方案拆分判据、Worker 数量语义、本地恢复候选比对、挂机授权边界、收口三层门禁、七类资源登记；**新增两段**——异常速查、受保护分支等待态下不要手工合并
- [x] 2.2 persona 收缩为五条红线：只读编排器身份 / 不得自批准或伪造人工批准 / 不得直接改共享工作区 / 任何执行代理调度前必经原生方案确认 / Worker 职责与边界
- [x] 2.3 **红线守卫**：结构化红线清单 + 逐条关键约束要素检查；删除任一条使测试失败。MUST NOT 整串比对，MUST NOT 非空即过。**先失败后通过**——先删一条证明守卫有效。验证：单测
- [x] 2.4 **红线不得改由 skill 承载**：把任一红线从 persona 移入 skill 时守卫失败。验证：单测（对抗性）
- [x] 2.5 收缩前后系统提示字节数**实测**对比，记入实施状态

## 3. 真实模型套件（收缩的合入门）

- [ ] 3.1 收缩后重跑 `test:real-worker` 通过
- [ ] 3.2 收缩后重跑 `test:autopilot` 通过
- [ ] 3.3 收缩后重跑 `test:worker-interactions` 通过（`PACTFLOW_RELAY_IMAGE=<清单 acceptanceImage>`）
- [ ] 3.4 任一未通过 → 收缩不合入，修正后重跑；三者通过才可进入任务 4

## 4. Skill 失败语义

- [x] 4.1 skill 内容损坏或缺失时模型收到**显式不可用说明**，不得静默空指令。先失败后通过。验证：单测
- [x] 4.2 全部 skill 不可用时，既有工具权限、方案确认与人工门禁行为**完全不变**。验证：单测（对抗性守卫）

## 5. 可卸载性

- [x] 5.1 remove 后重启无残留：**已跑通**（2026-09-15）。此前记的前提有误——`verify:profile:dev` 用的是 **DSH 源码**（`DSH_SOURCE` 指向兄弟 fork checkout），不需要已安装宿主，而该 checkout 一直都在。实跑 `DSH_SOURCE=../deepseek-harness-pactflow-p0 pnpm run verify:profile:dev`，全链通过：install → boot → 重复 add（升级路径，断言 Bundle 层不重复）→ boot → remove → dump-config 无残留 → 干净复启且 `pactflow/health` 返回 404。

  并把「skill 行随 preset 卸载」由论证改为**核验**：脚本新增 `requireSkillCatalog`，安装后在本次 DSH_HOME 下定位实际安装的 preset 目录，断言 `agent.cordis.yml` 含 `dsh-skill-filesystem` / `dsh-tool-skill` 两行且 `skills/` 下有目录；remove 后断言该 preset 目录整体消失。**canary 实证**：把 `skills/` 改名为 `skillz/` 后该断言转红（`installed preset has no skills directory at …/presets/pactflow/skills`），改回后复跑全绿。

  「没有独立生命周期」这类说法正是一旦有人给它一个生命周期就会立刻失效的那种，所以改为每次跑都检查，而不是写在注释里。

  记录边界：这是**开发通道**证据（脚本自己打印 `not release evidence`），不等于官方发行版上的安装验收——后者仍受上游 external event producer 能力缺口阻断。

## 6. 终验

- [ ] 6.1 真实会话中模型可见目录并按需加载、用户可 `/name` 调用：**未跑**（需已安装宿主与真实会话）。但**真实挂载审计已通过**——`preset.spec.ts` 在真实 `agent-presets` 组合里挂起 preset，两行 skill 激活，`skill` 加载工具出现在 Agent 工具面；这不等同于 6.1，故如实分开
- [x] 6.2 回归：`pnpm run check` 全绿、`pnpm run pack:check` 必需产物含 skill 目录、`openspec validate --all --strict` 全绿
- [x] 6.3 文档同步：`docs/CURRENT_STATUS-当前状态.md` 补 Agent-plane 组合行；开发计划 §7 的「Workflow Consumer」标为有意不做（附本 change 的裁决理由指针）；实施状态记录 token 实测对比与前置核实结论
