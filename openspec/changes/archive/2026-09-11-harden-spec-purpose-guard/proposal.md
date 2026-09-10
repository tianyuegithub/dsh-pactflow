## Why

本会话中，**每一次**归档一个「新建 capability」的 change，OpenSpec 都会为该 capability 写入占位 `## Purpose`：

```
TBD - created by archiving change <id>. Update Purpose after archive.
```

而 `openspec validate --all --strict` 会因此失败（本会话共遇到 4 次，每次都靠手工改写主 spec 的 Purpose 才恢复）。这带来两个风险：

1. **门禁在归档后才红**——归档动作本身不失败，失败推迟到下一次 `validate`，容易被误认为「与本次无关」；
2. **无人守护**——没有测试或脚本会阻止占位 Purpose 再次进入 `openspec/specs/`。

## What Changes

- 新增 `tests/openspec-spec-hygiene.spec.ts`（3 项）：
  - 能发现每个 capability spec；
  - 每个 capability 的 `## Purpose` 必须是**真实内容**——缺失、空、或以 `TBD`/`TODO`/“created by archiving” 开头的占位一律失败；
  - 每个 capability 至少含一个 `### Requirement:`。
- 该测试位于 `packages/dsh-pactflow/tests/`，因此**随 `pnpm run check` 执行**，使占位 Purpose 在归档后立刻可见，而不是等到发布门禁。

## Capabilities

### New Capabilities
- `openspec-spec-hygiene`: 每个 capability spec 必须带有真实 Purpose 与非空 Requirement；归档占位不得留在 `openspec/specs/`。

### Modified Capabilities
（无。）

## Impact

- **测试**：新增 `tests/openspec-spec-hygiene.spec.ts`（`pnpm run check` 由 63 文件 / 519 → 64 文件 / 522）。
- **流程**：归档新建 capability 后，若忘记改写 Purpose，`check` 会立即失败并指明是哪个 capability。
- **兼容**：纯新增测试；现有 27 个 spec 全部通过（无占位）。
