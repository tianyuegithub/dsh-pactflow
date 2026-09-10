## Why

GPT 评审附录 A2 指出：`scripts/check-package.mjs` 校验的是**构建目录里路径是否存在**，而不是用户实际安装的**最终 tarball**内容。它无法发现 tarball 里混入的源码、`node_modules`、密钥或临时文件，也无法证明 `files` 白名单真的生效。发布应当检验即将交付的精确产物。

## What Changes

- `check-package.mjs` 改为对 `npm pack` 生成的精确 tarball 清单做校验：
  - 必需产物齐全（沿用现有清单）；
  - 拒绝禁止路径：`node_modules/`、`src/`、任何 `.ts` 源文件、测试与 e2e 文件、临时/隐藏文件、常见密钥文件名与扩展名；
  - `exports`/`main`/`types` 指向的文件必须真实存在于 tarball；
  - 校验 tarball 内容与清单一致（条数上限内）。
- 校验在临时目录生成 tarball 后立即读取并清理，不落仓库。

## Capabilities

### New Capabilities
- `release-artifact-integrity`: 发布门禁必须检验即将交付的精确 tarball 内容，而不是构建目录；被禁止的路径（源码、依赖、密钥、临时文件）不得进入产物，声明的入口必须真实存在。

### Modified Capabilities
（无。）

## Impact

- **脚本**：`scripts/check-package.mjs`。
- **测试**：新增脚本层单测（清单判定纯函数：必需齐全、禁止路径拒绝、入口缺失拒绝、正常清单放行）。
- **兼容**：`check` 与 `check:release` 的调用方式不变；合法产物行为不变；不修改插件运行时。
