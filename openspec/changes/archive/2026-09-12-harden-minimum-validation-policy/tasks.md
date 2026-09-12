## 1. 数据与写入

- [x] 1.1 types.ts：`PactFlowValidationPolicyGroup` + 配置增 `validationPolicy?`；schema.ts 增对应 zod（组 id 唯一、profileIds 去重）。验证：typecheck 通过
- [x] 1.2 `saveValidationPolicy` Remote（CAS，组校验、profileIds 必须存在于 catalog）；`saveValidationProfiles` 拒绝删除被策略引用的 profile。验证：单测
- [x] 1.3 `closeGitNeed` 在 legacy 检查后调用 `enforceValidationPolicy`：无策略→原样；缺失→失败关闭逐项指名。验证：单测三态

## 2. 客户端

- [x] 2.1 项目面板新增「收口最小验证策略」区：每 profile「收口必跑」勾选 + 保存（走 `saveValidationPolicy` CAS）。验证：构建通过 + 单测
- [x] 2.2 Agent 面不可触及：断言全部 `pactflow_*` 工具名无 policy 相关工具。验证：单测

## 3. 收口

- [x] 3.1 `pnpm run check` 全绿 + `openspec validate --all --strict` 通过 + archive
