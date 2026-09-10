# openspec-spec-hygiene Specification

## Purpose
保证 `openspec/specs/` 的规格卫生：每个 capability 必须带真实 Purpose（不得残留归档工具写入的占位）且至少含一个 Requirement，并让该约束随默认门禁执行——使占位 Purpose 在归档后立刻失败，而不是推迟到发布门禁由人工发现。

## Requirements

### Requirement: 每个 capability spec 必须带有真实 Purpose

`openspec/specs/<capability>/spec.md` 的 `## Purpose` SHALL 存在且为非空真实内容。归档工具写入的占位（以 `TBD`/`TODO` 开头，或含 “created by archiving”）MUST 被视为不合格。该约束 MUST 随默认门禁（`pnpm run check`）执行，使占位在归档后立即可见，而非推迟到发布门禁。

#### Scenario: 真实 Purpose 通过

- **WHEN** 某 capability 的 `## Purpose` 是一段真实说明
- **THEN** 门禁通过

#### Scenario: 占位或空 Purpose 失败

- **WHEN** 某 capability 的 `## Purpose` 缺失、为空、或以 `TBD`/`TODO`/“created by archiving” 开头
- **THEN** 门禁失败并指明该 capability 名称

### Requirement: 每个 capability 至少含一个 Requirement

每个 capability spec SHALL 至少包含一个 `### Requirement:` 段落；仅有 Purpose 而无 Requirement 的 spec MUST 被视为不合格。

#### Scenario: 无 Requirement 的 spec 失败

- **WHEN** 某 capability 的 spec 不含任何 `### Requirement:`
- **THEN** 门禁失败并列出该 capability
