## Context

见 proposal.md（Why）。关键事实：

- `package.json`：`"typecheck": "node scripts/build.mjs"` 与 `"build"` 相同；`build.mjs` 先 `rmSync(lib)` 再依次跑 `tsc -b`、typert 生成、四次 tsdown 打包。
- `scripts/verify-profile.mjs`：`run()` 用 `execFileSync` 无 `timeout`；`bootWeb` 以 30s 就绪计时器等待常驻服务，但子进程启动期间与远程校验阶段无整体期限。
- `scripts/evidence-collect.mjs` 与 `scripts/acceptance-gate.mjs`：`batchDir = join(evidenceRoot, batch)`；`walk()` 用 `statSync`（跟随符号链接）且无深度/数量上限。

约束：`build` 行为不变；合法批次名与现有证据读取行为不变；不引入新依赖。

## Goals / Non-Goals

**Goals:**
- 类型检查独立、无副作用、退出码只反映类型。
- 子进程等待有界，超时失败关闭。
- 证据读取限制在证据根内，拒绝符号链接与超限目录。

**Non-Goals:**
- 不改 `build`/`pack`/`check` 的既有语义。
- 不做完整的发布产物白名单校验（属另一批）。
- 不引入新的第三方依赖。

## Decisions

### D1：新增独立 `scripts/typecheck.mjs`（A3）

对 `tsconfig.host.json` 与 `tsconfig.client.json` 分别执行 `tsc --noEmit`，串行、失败即非零退出；不删除 `lib/`、不打包。`package.json` 的 `"typecheck"` 指向该脚本。

- 备选：给 `build.mjs` 加 `--typecheck` 分支。否决——同一入口仍会让人误以为 typecheck 会构建，且分支易漂移；独立脚本语义明确。

### D2：`verify-profile.mjs` 子进程加超时与整体宽限期（A1）

`run()` 增加显式 `timeout`（如 120s）与 `killSignal`；`bootWeb` 除就绪/提前退出外增加整体宽限期（如 120s），到期失败关闭并输出有界 stderr。超时值集中为常量，便于按环境调整。

### D3：证据路径解析与遍历加固（A4）

新增共享 `resolveEvidenceBatch(evidenceRoot, batch)`：拒绝绝对路径；用 `resolve` + `relative` 校验结果位于 `evidenceRoot` 内（拒绝 `..` 逃逸）；批次缺失仍报「目录不存在」。遍历用 `lstatSync` 判定，符号链接跳过（不进入），并设 `MAX_DEPTH`（如 8）与 `MAX_ENTRIES`（如 10_000）。`evidence-collect.mjs` 与 `acceptance-gate.mjs` 共用。

## Risks / Trade-offs

- [超时值过紧导致慢环境误判] → 设为宽松常量并集中定义；仅防挂起，不追求激进时限。
- [拒绝符号链接影响合法用例] → 证据目录为脚本自产的普通目录；符号链接属异常输入，失败关闭更安全。
- [深度/数量上限误拦正常批次] → 上限取远高于实际用量（8 层 / 1 万条）。

## Open Questions

（无。）
