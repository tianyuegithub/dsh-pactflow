## Context

见 `proposal.md`。已核实的现状：设置抽屉的**资源编辑器是单一槽位**（`activeEditor: ActiveResourceEditor | null`）——为资源 A 打开编辑器输入内容后，再打开资源 B 的编辑器会**丢弃 A 的草稿**（A8 指的"跨卡片草稿"正是这个形态）；设置抽屉整体只有一份基础设施 `draft`（跨资源共享，切编辑器不丢，但资源编辑器各自独立）。设置抽屉的关闭没有未保存提示。

## Goals / Non-Goals

**Goals**：资源编辑器草稿按 `kind:id` 键并存（切换编辑对象不丢）；抽屉关闭时有未保存草稿 → 两步确认而非静默丢弃；移动视口下资源卡可用性入 e2e。

**Non-Goals**：不做草稿磁盘持久化；不改保存/CAS 语义（保存仍是显式动作）；不改验证配置编辑器（其草稿随卡片生命周期，本就单一卡片）；不改 Host。

## Decisions

### 决策 1（v1 收敛）：并存 = 按键草稿 store，接入验证配置编辑器

- **理由**：设置抽屉的草稿模型（全局 `draft` + `change()` + testedFingerprints）与 646 行表单深度耦合，v1 强拆风险大于收益。按键草稿 store（`card-drafts.ts`，Map + useSyncExternalStore）先接入**验证配置编辑器**（按 `validation-profiles:<workspaceId>` 键）——工作区卡片切换时各自草稿并存、切回原样恢复、保存/撤销只清本键；这就是"两张卡片草稿并存互不污染"的可测形态。
- **备选**：v1 即重构设置抽屉编辑器为 per-resource 草稿——推迟（风险大于收益，另行立项）。

### 决策 2：离开提示用两步确认按钮，不用原生 confirm

- **理由**：Playwright/自动化对原生 dialog 需要专门处理且样式脱离产品；两步（「关闭」→「未保存的更改将丢失，确认放弃？」）确定性强、可 e2e。

### 决策 3：移动可用性以既有移动视口 e2e 套件扩展

- **理由**：复用 390×844 场景与断言模式（无横向溢出 + 可点击），不新建套件。

## Risks / Trade-offs

- [草稿映射随抽屉生命周期，抽屉卸载即丢] → 与现状一致（现状更糟：切资源即丢）；磁盘持久化属非目标。
- [键包含 mode 导致 new/edit 草稿分开] → 同一资源 new 与 edit 视为不同草稿（语义不同：新建未指定 id 前无稳定身份）。

## Migration Plan

1. `card-drafts.ts` 按键草稿 store；`validation-profile-editor.tsx` 接入（键=工作区）。
2. 设置抽屉关闭两步确认（dirty = 抽屉 draft 与 persisted 不一致或存在编辑器草稿键）。
3. e2e：双工作区验证编辑器草稿并存 + 切换保留 + 关闭确认 + 移动视口资源卡（项目面板）。
4. check → validate → archive。
