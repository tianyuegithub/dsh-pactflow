## Why

GPT 评审附录 A（脚本稳健性）指出三项可在本仓脚本层直接指认的缺陷：

- **A3**：`package.json` 的 `"typecheck": "node scripts/build.mjs"` 与 `build` **完全相同**——所谓类型检查其实会删除 `lib/` 并执行完整打包，既不独立、也有副作用，「类型是否通过」无法单独判定。
- **A1**：`scripts/verify-profile.mjs` 的同步子命令 `execFileSync` 未设超时；`bootWeb` 在子进程启动后等待就绪，缺少整体退出宽限期，子进程挂起会使验证无限等待。
- **A4**：`scripts/evidence-collect.mjs` / `scripts/acceptance-gate.mjs` 以 `join(evidenceRoot, batch)` 拼接批次目录，批次名含 `..` 可逃逸出证据根；目录遍历跟随符号链接且无深度/数量/大小上限，导入他人验收包时可能越界读取或陷入循环。

这些是发布/验证工具链的卫生问题，成本低、自包含，应先清理。

## What Changes

- **真实类型检查**：新增 `scripts/typecheck.mjs`，对 host 与 client 两个项目执行 `tsc --noEmit`（纯类型检查、不删 `lib/`、不打包），`package.json` 的 `typecheck` 指向它。
- **验证脚本超时**：`verify-profile.mjs` 的同步命令加显式超时；`bootWeb` 在就绪/退出之外增加整体宽限期，超时即失败关闭并输出有界 stderr。
- **证据路径安全**：批次名解析为证据根下的相对路径，拒绝绝对路径与逃逸根目录的 `..`；遍历时拒绝符号链接、限制递归深度与文件数量。

## Capabilities

### New Capabilities
- `tooling-hygiene`: 仓库的开发/验证/发布工具链必须可独立判定其结论，且处理外部输入（批次名、他人验收包）时不得越界读取或无限等待。

### Modified Capabilities
（无。）

## Impact

- **脚本**：新增 `scripts/typecheck.mjs`；修改 `scripts/verify-profile.mjs`、`scripts/evidence-collect.mjs`、`scripts/acceptance-gate.mjs`；`package.json` 的 `typecheck` 脚本。
- **测试**：新增脚本层单测（类型检查有副作用隔离、路径逃逸拒绝、符号链接拒绝、深度/数量上限）。
- **兼容**：`build` 行为不变；合法批次名与既有证据目录读取行为不变；不修改 DSH 核心与插件运行时。
