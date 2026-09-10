## Purpose

约束发布门禁检验**即将交付的精确产物**：必须以最终 tarball 的文件清单为准，而不是构建目录里是否存在某个路径；被禁止的内容（源码、依赖、密钥、临时文件）不得出现在产物中，声明的入口文件必须真实存在。

## ADDED Requirements

### Requirement: 发布门禁必须校验最终 tarball 清单

发布门禁 SHALL 从 `npm pack` 生成的精确 tarball 读取文件清单，并以该清单判定通过与否。它 MUST NOT 只依据构建目录中的路径存在性判定。

#### Scenario: 必需产物缺失时失败

- **WHEN** tarball 清单缺少任一必需产物
- **THEN** 门禁以非零退出并指出缺失项

#### Scenario: 声明的入口必须在产物中存在

- **WHEN** `main`、`types`、`exports` 声明了某个文件
- **THEN** 该文件必须出现在 tarball 清单中，否则门禁失败

### Requirement: 禁止内容不得进入发布产物

发布 tarball MUST NOT 包含：`node_modules/`、`src/` 源码目录、任何 `.ts`/`.tsx` 源文件、测试或 e2e 文件、密钥类文件名或扩展（如 `.env`、`.pem`、`.key`、`id_rsa`）、以及隐藏/临时文件（如 `.DS_Store`、`.tmp`、`.log`）。

#### Scenario: 源码或依赖被拒绝

- **WHEN** tarball 清单包含 `src/` 下的文件或 `node_modules/` 下任一文件
- **THEN** 门禁失败关闭

#### Scenario: 密钥与临时文件被拒绝

- **WHEN** tarball 清单包含 `.env`、`.pem`、`.key`、`id_rsa`、`.DS_Store`、`.log` 或 `.tmp` 类路径
- **THEN** 门禁失败关闭

#### Scenario: 合法的发行产物通过

- **WHEN** tarball 只包含 `lib/`、`presets/`、`cordis.patch.yml`、`README.md`、`LICENSE`、`package.json` 与 `bin/` 等白名单内容
- **THEN** 门禁通过
