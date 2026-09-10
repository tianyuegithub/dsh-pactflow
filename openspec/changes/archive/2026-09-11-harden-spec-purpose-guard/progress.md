# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 问题复现 | ✅ | 本会话 4 次归档「新建 capability」的 change，每次 OpenSpec 均写入 `TBD - created by archiving change …` 的占位 Purpose，并使 `openspec validate --all --strict` 失败 |
| 现状核查 | ✅ | 逐文件扫描 `openspec/specs/*/spec.md`：**0 处**占位（27 个 spec 全部为真实 Purpose） |
| 守卫测试 | ✅ | `tests/openspec-spec-hygiene.spec.ts` 3 项：发现全部 spec / Purpose 真实（缺失·空·占位均失败）/ 至少一个 Requirement |
| 对抗性验证 | ✅ | 将 `worker-tool-scope` 的 Purpose 改为占位 → 守卫失败并指明 `worker-tool-scope: placeholder Purpose -> TBD - created by archiving…`；已还原为真实 Purpose |
| 验证 | ✅ | `pnpm run check` 64 文件 / **522** 测试（原 519）；`openspec validate --all --strict` 27/27 |

## 为什么把守卫放在 `tests/` 而不是脚本

该约束本质是「仓库内的规格卫生」，而 `pnpm run check` 已是每次改动的默认门禁；放进 `tests/` 意味着**任何改动若引入占位 Purpose，本地门禁立即失败**，无需记得额外跑一个校验脚本。这是本会话反复手工修复的直接教训。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 真实 Purpose 通过 | `gives every capability a real Purpose (never the archive placeholder)`（当前 27 个 spec 全过） |
| 占位或空 Purpose 失败 | 同测试（对抗性验证中以 `worker-tool-scope` 占位触发失败） |
| 无 Requirement 的 spec 失败 | `states at least one Requirement per capability` |
| 能发现全部 spec | `discovers every capability spec` |

## 已知边界（诚实）

- 守卫检查的是 `openspec/specs/`（已归档的长期合同）。**change 目录内**的 delta spec（`openspec/changes/<id>/specs/**`）不在此范围——它们的 Purpose 只在创建 capability 时被读取，故不需要；且归档后 change 会移入 `archive/`。
- 守卫用文本正则判定占位（`TBD`/`TODO`/“created by archiving”）；若未来 OpenSpec 更换占位措辞，需同步该正则（已在测试内注释说明来源）。
- 未对 `### Requirement:` 之后是否含 `#### Scenario:` 做校验（本批未要求）。

## 验证

`pnpm run check` 通过：64 个测试文件、522 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过；`openspec validate --all --strict` 27/27。
