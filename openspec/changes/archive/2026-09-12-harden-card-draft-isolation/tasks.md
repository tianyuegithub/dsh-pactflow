## 1. 草稿并存

- [ ] 1.1 `settings.tsx`：`activeEditor` 单槽位 → `editorDrafts: Record<editorKey, ActiveResourceEditor>` 映射 + `activeEditorKey`；打开/关闭编辑器、保存、删除路径适配（保存/删除清对应键；重开同一资源草稿原样回来）。验证：build + 既有 settings 相关测试全绿
- [ ] 1.2 单测：编辑器草稿映射的并存/保留/清除（纯状态断言，经组件导出的 helper 或 store）。验证：单测

## 2. 离开提示

- [ ] 2.1 设置抽屉关闭：存在未保存编辑器草稿时两步确认（「关闭」→「确认放弃未保存更改？」）；无草稿时一步关闭。验证：单测或组件断言

## 3. 移动可用性与收口

- [ ] 3.1 扩展移动视口 e2e：打开资源编辑器（设置卡）无横向溢出、操作可达。验证：e2e
- [ ] 3.2 `pnpm run check` 全绿 + `test:web` 通过 + `openspec validate --all --strict` + archive
