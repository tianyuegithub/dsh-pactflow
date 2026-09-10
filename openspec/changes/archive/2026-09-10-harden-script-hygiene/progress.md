# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1/1.2/1.3 typecheck 独立 | ✅ | 新增 `scripts/typecheck.mjs`（host+client `tsc --noEmit`，不删 `lib`、不打包）；`package.json` 的 `typecheck` 指向它；测试断言不含 `build.mjs`/`rmSync`/`tsdown`；实测 `lib/index.js` mtime 不变 |
| 2.1/2.2/2.3 子进程有界 | ✅ | `verify-profile.mjs` 的 `run()` 加 `timeout: 120_000` + `killSignal: SIGKILL`；`bootWeb` 增加整体宽限期（超时 `SIGKILL` 并失败关闭、有界 stderr） |
| 3.1–3.4 证据路径安全 | ✅ | 新增 `scripts/evidence-path.mjs`（`resolveEvidenceBatch` 拒绝绝对路径与根外逃逸；`walkEvidence` 用 `lstatSync` 跳过符号链接、限制深度 8 / 条目 10000）；`evidence-collect.mjs` 与 `acceptance-gate.mjs` 接入 |

## 过程中发现的问题与处理

- 接入路径限制后，既有 `acceptance-gate.spec.ts` 因传入**绝对临时路径**（正是逃逸向量）而失败。这是修正后的正确契约暴露出的测试用法问题，不是削弱断言：改为通过 `PACTFLOW_ACCEPTANCE_EVIDENCE_DIR` 注入证据根、batch 名传相对名（与生产用法一致）。同时把证据根由「模块加载时读取」改为「调用时读取」，以便按环境切换且更符合语义。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 类型检查不破坏既有构建产物 | `typecheck 入口`（源码不含 rmSync/tsdown）+ 实测 mtime 不变 |
| 类型检查失败时非零退出 | `tsc --noEmit` 直接传播退出码 |
| 逃逸证据根的批次名被拒绝 | `rejects absolute batch paths and escapes outside the evidence root` |
| 符号链接不被跟随 | `does not follow symlinked directories during a walk` |
| 超深目录被拒绝 | `fails closed when the evidence tree exceeds the depth limit` |
| 子进程挂起时按超时失败 | `run()` 的 `timeout`；常驻服务宽限期由 `bootWeb` 实现（源码层断言） |

## 已知边界

- 子进程超时为源码层断言 + 常量存在；未在真实挂起进程上做端到端注入（那需要可控的外部命令），已在 tasks 中如实标注。
- 发布产物白名单（A2）未纳入本 change，属另一批。

## 验证

`pnpm run check` 通过：41 个测试文件、415 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
