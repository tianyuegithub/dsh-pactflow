# verification-script-runnability Specification

## Purpose
确保仓库内的验证/门禁脚本真的能跑：可被解析、不因暂时性死区等初始化顺序问题在首次调用即失败、且被使用的常量先于使用处声明。一个看似存在却因自身缺陷报错的门禁比没有门禁更糟——它让人误以为受验证，失败却与验证对象无关。

## Requirements

### Requirement: 验证脚本必须可解析且可运行

仓库内的验证/门禁脚本 SHALL 可被解析（无语法错误），且 MUST NOT 因暂时性死区（temporal dead zone）等初始化顺序问题在首次调用即失败。任何被脚本在顶层流程中使用的常量/函数 SHALL 在其被使用前完成声明。门禁的失败 MUST 源于其要验证的对象，而非脚本自身的初始化缺陷。

#### Scenario: 全部验证脚本可解析

- **WHEN** 对 `scripts/*.mjs` 逐个执行语法检查
- **THEN** 全部通过；任一语法错误即判失败

#### Scenario: 超时常量先于使用处声明

- **WHEN** 检查 `verify-profile.mjs`
- **THEN** `COMMAND_TIMEOUT_MS` 的声明位置早于首个顶层 `try {`（即早于任何可能调用 `run(...)` 的位置）

#### Scenario: 门禁可真实运行

- **WHEN** 以开发通道运行 `verify:profile:dev`
- **THEN** 它完成 install → boot → upgrade → remove → clean boot 全程并通过，不因脚本自身缺陷在首次调用即抛错
