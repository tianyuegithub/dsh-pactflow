# validation-integrity-signals Specification

## Purpose
让「验证是否可信」在交付层可见：能识别任务是否改动了项目的验证基础设施（test/build/CI 配置），并能识别本次交付是否**根本没有自动验证**；前者不得被静默当作正常通过，后者不得被呈现为已验证。

## Requirements

### Requirement: 任务改动验证基础设施必须可见

当任务的提交相对其执行基线修改了验证敏感文件（测试/构建/CI 配置、lockfile 等），Host SHALL 在运行结果中记录这些文件路径，供人工审查。该记录 MUST NOT 阻断任务本身（改动可能是正当的），但也 MUST NOT 使该交付在无提示的情况下被当作「验证未受影响」。

#### Scenario: 改动测试配置被记录

- **WHEN** 任务提交修改了 `package.json`、`vitest.config.ts` 或 CI 工作流文件
- **THEN** 运行结果记录这些被改动的验证敏感文件

#### Scenario: 只改普通源码不被记录

- **WHEN** 任务提交只修改普通源码或文档
- **THEN** 运行结果不记录任何验证敏感文件

#### Scenario: 记录与文件顺序无关

- **WHEN** 同一组改动以不同顺序出现
- **THEN** 记录结果一致且去重

### Requirement: 零自动验证必须可识别

Host SHALL 能报告本次交付实际执行的验证命令数量。当该数量为零时，该交付 MUST 可被识别为「没有自动验证」，MUST NOT 在缺少这一标识的情况下被呈现为已验证。

#### Scenario: 无验证配置的交付被识别为零验证

- **WHEN** 本次交付没有执行任何登记的验证命令
- **THEN** 可查询到执行数量为零

#### Scenario: 执行了验证的交付计数为正

- **WHEN** 本次交付执行了登记的验证命令
- **THEN** 执行数量等于实际执行的命令数
