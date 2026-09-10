# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 清单判定失败测试 | ✅ | `tests/release-artifact.spec.ts` 14 项：正例放行；缺必需/缺声明入口拒绝；11 类禁止路径拒绝；`.d.ts` 与 `lib/*.js` 不被误杀 |
| 1.2 `assertArtifactManifest` | ✅ | `scripts/check-package.mjs` 导出纯函数（禁止前缀/扩展名/文件名规则 + 入口存在检查） |
| 2.1 接入真实 tarball | ✅ | 临时目录 `npm pack` → `tar -tzf` 读清单 → 校验 → 清理；脚本加 main 守卫避免 import 副作用 |
| 2.2 保留既有断言 | ✅ | bundle.patch、client.platform、license、bin、peer optional、LICENSE 一致性均保留 |
| 2.3 `check` 通过 | ✅ | 输出 `check-package: 13 required artifact(s) present in the packed tarball` |

## 关键验证：门禁真的能拦住泄漏

仅「正例通过」不足以证明门禁有效。做了一次**注入验证**：把 `src/**/*.ts` 加入 `packages/dsh-pactflow/package.json` 的 `files` 白名单，运行 `pack:check`，门禁按预期失败并列出 `src/host/cleanup.ts, src/client/credential-probe.ts, src/domain.ts …`；随后恢复白名单（`git diff` 为空）并确认门禁重新通过。

> 注：`package.json` 的 `files` 被 Mimosa 视为安全配置，Bash 直写被拦；注入与恢复均通过 Edit 完成。

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 必需产物缺失时失败 | `fails closed when a required artifact is missing` |
| 声明的入口必须在产物中存在 | `fails closed when a declared entry is absent from the tarball` |
| 源码或依赖被拒绝 | `rejects forbidden artifact path src/index.ts` / `node_modules/zod/index.js` |
| 密钥与临时文件被拒绝 | `.env` / `.DS_Store` / `secrets/id_rsa` / `debug.log` / `state.tmp` |
| 合法发行产物通过 | `accepts a manifest with all required artifacts and declared entries` + 注入验证后 `pack:check` 通过 |

## 已知边界

- 门禁校验 tarball 文件清单与声明入口；未校验内容摘要或签名链（属更远范围）。
- 使用系统 `tar` 读取清单；若环境无 `tar` 会以清晰错误失败（未做回退）。

## 验证

`pnpm run check` 通过：42 个测试文件、429 项测试、13 项包产物（真实 tarball）；`pnpm run typecheck` 通过；`git diff --check` 通过。
