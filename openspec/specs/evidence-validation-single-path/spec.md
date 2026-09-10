# evidence-validation-single-path Specification

## Purpose
确保「读取并校验验收证据」只有一个实现路径：调用点必须复用它，不得各自内联复制（`JSON.parse(readFileSync(...))` + 校验），也不得留下实现了该动作却无人调用的等价导出——否则测试覆盖的可能是永不执行的那份副本，「绿」便不再代表所声称的行为被验证。

## Requirements

### Requirement: 验收证据的读取与校验必须有唯一实现路径

「读取一个证据文件并校验其结构」SHALL 只实现一次，并由所有调用点复用。调用点 MUST NOT 内联复制该实现（例如自行 `JSON.parse(readFileSync(...))` 后调用校验函数）。MUST NOT 存在实现了该动作却无人调用的等价导出。

#### Scenario: 采集与门禁复用同一路径

- **WHEN** 证据采集与验收门禁各自读取一份 `evidence.json`
- **THEN** 二者都经由同一个「读取并校验」实现，不各自复制读取逻辑

#### Scenario: 内联复制被消除

- **WHEN** 检查调用点源码
- **THEN** 不存在「先 JSON.parse(readFileSync) 再调用校验」的内联复制；该动作只出现在唯一实现内部

#### Scenario: 校验语义不因合并而改变

- **WHEN** 证据文件缺字段、含未知字段或枚举非法
- **THEN** 仍按原语义抛错（由既有验收门禁用例覆盖）
