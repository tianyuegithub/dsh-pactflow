## 1. 类型检查与构建分离

- [x] 1.1 新增 `scripts/typecheck.mjs`：对 host 与 client 分别执行 `tsc --noEmit`，串行、失败非零退出；`package.json` 的 `typecheck` 指向它
- [x] 1.2 先写失败测试：断言 `typecheck` 脚本不引用 `build.mjs`、且其源码不含删除 `lib` 的操作；验证：当前 `typecheck: build.mjs` 下失败（红）
- [x] 1.3 验证 `typecheck` 在存在 `lib/` 时不删除产物且退出 0；验证：手工运行前后 `lib/index.js` 存在

## 2. 验证脚本子进程有界等待

- [x] 2.1 `verify-profile.mjs` 的同步 `run()` 增加显式 `timeout` 与 `killSignal`
- [x] 2.2 `bootWeb` 增加整体宽限期，到期失败关闭并输出有界 stderr
- [x] 2.3 先写失败测试：源码层面断言 `run()` 传入 `timeout`；验证：当前无 `timeout` 时失败（红）

## 3. 证据路径限制在证据根内

- [x] 3.1 新增共享 `resolveEvidenceBatch`：拒绝绝对路径与逃逸证据根的相对路径
- [x] 3.2 遍历改 `lstatSync` 拒绝跟随符号链接，并设递归深度与条目数量上限
- [x] 3.3 `evidence-collect.mjs` 与 `acceptance-gate.mjs` 接入共享解析与遍历限制
- [x] 3.4 先写失败测试：`../../etc` 批次名被拒、符号链接目录不被进入、超限失败；验证：当前实现在这些负例下失败（红）

## 4. 收口

- [x] 4.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [x] 4.2 运行 `openspec validate harden-script-hygiene --strict`，验证：通过
- [x] 4.3 记录 spec 场景到测试的映射
