## Context

见 proposal.md（Why）。关键事实：

- `packages/dsh-pactflow/package.json` 已有 `files` 白名单（`lib/index.js`、`lib/client.js`、`lib/typert.*`、`lib/types/**`、`cordis.patch.yml`、`presets/**`、`README.md`、`LICENSE`、`bin/generate-service.mjs`）。
- `scripts/check-package.mjs` 目前只对构建目录做 `readFileSync(resolve(packageRoot, relative))`，不生成也不读取 tarball。
- `npm pack --dry-run` 输出稳定可解析（`npm notice <path>`），但更稳妥的做法是生成真实 tarball 并用 `tar -tzf` 读取清单。

约束：`check` 与 `check:release` 入口不变；不引入第三方依赖（用 `npm pack` + `tar` 或 `npm pack --json`）。

## Goals / Non-Goals

**Goals:**
- 以最终 tarball 清单为准判定发布通过。
- 拒绝源码/依赖/密钥/临时内容；声明入口必须存在。

**Non-Goals:**
- 不改 `files` 白名单本身（仅校验其效果）。
- 不引入签名/摘要发布链（属更远范围）。
- 不校验 npm registry 侧内容。

## Decisions

### D1：生成精确 tarball 再读清单（而不是 `--dry-run` 解析）

在临时目录执行 `npm pack --pack-destination <tmp>`，用 `tar -tzf` 读取条目，校验后删除。原因：`--dry-run` 的输出格式属人读格式，解析脆弱；真实 tarball 是「即将交付的精确产物」，与目标一致。

- 备选：解析 `npm pack --dry-run --json`。否决——`--json` 在部分 npm 版本对 `--dry-run` 行为不一致，且仍非真实产物。

### D2：拆分纯判定函数与 I/O 包装

把「清单 → 通过/失败」做成纯函数 `assertArtifactManifest(paths, requirements)`，便于单测覆盖各负例；I/O（pack、tar）留在脚本主流程。负例（含 `src/`、`node_modules/`、`.env`、缺入口）与正常用例均可单测。

### D3：禁止路径用明确规则而非模糊匹配

规则按类型列举：目录前缀（`node_modules/`、`src/`）、扩展名（`.ts`、`.tsx`、`.pem`、`.key`、`.log`、`.tmp`）、文件名（`.env`、`.DS_Store`、`id_rsa`）。避免「包含 secret 字样」这类会误伤合法文件的宽泛匹配（如 `redaction.js` 不应被误杀）。

## Risks / Trade-offs

- [生成真实 tarball 增加一次打包] → 发布门禁本应检验真实产物；成本可接受，且临时目录用完即清。
- [`tar` 在 CI 不存在] → Node 环境通常具备；若不具，退化为 `npm pack --json` 解析（实现时以 `tar` 为主并给出清晰错误）。
- [规则过严误伤合法文件] → 规则显式列举；`lib/types/**` 的 `.d.ts` 属声明文件，白名单放行 `.d.ts`。

## Open Questions

（无。）
