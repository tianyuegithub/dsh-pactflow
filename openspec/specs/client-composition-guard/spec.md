# client-composition-guard Specification

## Purpose
守护开发计划 §1 的一条硬完成条件：Web 控制台必须由 DSH 公开原语构成（无 iframe、无第二层 Web 壳），且对已发布 DSH 包的深路径导入必须落在该包 `exports` 声明的子路径上——使该约束由测试守护而非仅靠人工核查，并明确「声明了 `./src/*` 的包不算私有导入」这一判据细节。

## Requirements

### Requirement: Web 控制台必须由 DSH 公开原语构成

Web 控制台 SHALL 由 DSH Client Module 原语构成，MUST NOT 使用 `iframe`、`webview` 或自建第二层 Web 壳（如自行 `createRoot`/`ReactDOM.render`）。对已发布 DSH 包的深路径导入 MUST 落在该包 `exports` 声明的子路径上；导入**未声明**的路径即视为私有源码导入。该约束 MUST 由测试守护，而非仅靠人工核查。

#### Scenario: 无第二层 Web 壳

- **WHEN** 检查 client 源码
- **THEN** 不存在 `iframe`/`webview`/`ReactDOM.render`/`createRoot(`

#### Scenario: 深路径导入必须是该包声明的导出

- **WHEN** client 源码从 `@deepseek-ai/<pkg>` 的某个子路径导入
- **THEN** 该子路径被该包 `exports` 声明（含通配），否则判为私有源码导入

#### Scenario: 声明了 `./src/*` 的包不算私有导入

- **WHEN** 某包在 `exports` 中声明了 `"./src/*"`
- **THEN** 从该包 `./src/...` 导入是合法的公开用法，不得判为违规

#### Scenario: 违规被测试捕获

- **WHEN** 某导入改到未声明的子路径
- **THEN** 守护测试失败并指出文件与说明符
