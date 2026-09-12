# Mimosa 深度安全扫描与处置（2026-09-11）

本文件登记完整密封扫描的收据与三族 finding 的处置结论。此前 `git commit`/`git push` 时多次出现 `scanner_enobufs`（未得到完整扫描结论）——第一次扫描即为补齐。

## 0. 第二次密封扫描（覆盖后续新增代码，2026-09-11 晚）

在第一次扫描之后，仓库又合入了 `surface-review-and-readonly-entries`（schema 修复 + 审批理由 + 客户端两入口）。为让新代码也取得密封覆盖，重跑一次：

| 项 | 值 |
| --- | --- |
| Scan ID | `scan-2026-09-11T14-59-19.217Z-0178b1d09938` |
| Seal | `sha256:cdc341847e5b196a26f0a192f2e2ab0c7e975d16f82edb34e571ed26163c172c` |
| 覆盖 / 结论 | 同为 `partial` / `inconclusive`（调用图动态派发缺口不变） |
| Finding | 仍为 50 条（high 26 / medium 24），依赖 56 包 advisory 匹配 0 |

**与第一次扫描逐条比对（finding 实例哈希）**：48 条实例哈希变化、2 条完全一致——变化者的**标题家族与严重度完全相同**（SSRF 19 / mongo-sort 23 / 硬编码凭据 3 / command-injection 4 / 跨文件污点 1），位置在 `lib/index.js`（构建产物）中整体平移 1 行左右（本批在 bundle 前部新增了 schema 字段与审批理由代码，属预期）。**无任何新增 finding 家族，三族处置结论不变**。

## 第三次密封扫描（2026-09-12，覆盖 A03-b/A03-c/A11/A8 四项交付）

| 项 | 值 |
| --- | --- |
| Scan ID | `scan-2026-09-12T05-15-05.735Z-cf7529ce5838` |
| Seal | `sha256:4de7fe27392b2fbfd07e1394f33b81e8ed42176633db73fc79e88b5ae4130a46` |
| 覆盖 / 结论 | `partial` / `inconclusive`（调用图缺口不变） |
| Finding | 50（high 26 / medium 24）；依赖 56 包 advisory 匹配 0 |

与第二次扫描**逐家族比对完全一致**（SSRF 19 / mongo-sort 23 / 硬编码凭据 3 / command-injection 4 / 跨文件污点 1）——四项新能力（策略/基线/暂停/草稿隔离）未引入任何新的 finding 家族。三族处置结论继续有效。

## 1. 扫描收据

| 项 | 值 |
| --- | --- |
| Scan ID | `scan-2026-09-11T06-24-14.686Z-93cb38201725` |
| Seal | `sha256:732c2a60d571d294ac93e180df695cd9aa7a74a4106044ed9a0d492e15fed313` |
| 深度 / 边界 | deep；`static_only_no_runtime_execution` |
| 产物目录 | `~/.mimosa/security-scans/project-a869b3986bafe2af7fec29ee/scan-2026-09-11T06-24-14.686Z-93cb38201725/` |
| 覆盖 | 247 文件全解析、0 读/解析失败；`completeness: partial`（调用图对动态派发不完整）→ 按合同**不允许**全项目安全声明；扫描器结论 `inconclusive` |
| 依赖 | 56 包、离线 advisory 匹配 **0** |
| Finding | 50（high 26 / medium 24） |

## 2. 三族 finding 与处置

### 2.1 SSRF 入口（19 条 high）—— 已处置（change `harden-egress-url-origin`）

- **扫描器声明**：`giteaFetch`/`request`/`verify`/`findPullRequest`/`mergePullRequest`/`createRepository`/`getRepositoryById`/`probeModelConnection` 是 SSRF 入口；静态无法证明「谁控制 URL」。
- **人工核实**：均为真实出网面，但 URL 来源分层清晰——Agent 面工具只收注册 id（`gitea_provider_id`、template/profile/connection id），解析失败即关闭；操作员设置表单的探测辅助（`discoverModels`、`probeInfrastructure` 草稿）按设计接受操作员填写的端点；Gitea 携凭据出网由 `git-credential-binding`（F01）合同约束。
- **处置**：把「URL 来源分层」落为合同 `egress-url-origin` 与守卫测试 `tests/egress-url-origin.spec.ts`（4 项）：Agent 工具 schema 无端点参数（含信封形状断言防空转；对抗验证：注入假想 `base_url` 工具时守卫精确点名）、Agent 面不含探测/发现工具、未注册模型连接零出网失败关闭、草稿探测凭据未配置零出网失败关闭。

### 2.2 mongo-sort-injection（23 条 medium）—— 判定规则错配，不改代码

- **扫描器声明**：污点（环境变量）经多函数到达 `mongo-sort-injection` sink。
- **人工核实**：**全仓无任何 MongoDB**（src/tests/scripts 零命中 `mongodb|mongo|mongoose`）。sink 实为 JS 数组 `.sort()`/键排序（如 `canonical()` 的确定性序列化）。规则为 MongoDB `sort({field: 用户输入})` 场景设计，对本仓 JS 数组排序属错配。
- **处置**：不改代码；结论留档。若未来引入真实数据库，需重扫。

### 2.3 硬编码凭据（3 条 high，CWE-798）—— 判定误报，不改代码

- **扫描器声明**：`ANTHROPIC_AUTH_TOKEN` 的凭据值直接写在源码中。
- **人工核实**：三处均只有**环境变量名**，无字面量密钥——`secretEnv('ANTHROPIC_AUTH_TOKEN', spec.modelSecretName)`（值来自 K8s Secret）、容器探针脚本内 `os.environ['ANTHROPIC_AUTH_TOKEN']`（运行时读取）、apiMode 键选择表达式。与本仓既往凭据泄漏扫描（tarball 与 HEAD 树无 `sk-`/`ghp_`/`AKIA`/私钥）一致。
- **处置**：不改代码；结论留档。

（另有 command-injection 4 条 high：`recoverDeadOwner`/`recoverLockArtifacts`/`initializeWorkspaceGit` 走 `execFile` 数组参数、无 `shell:true`——经典注入向量结构性不存在，入口级标记；CWE-943 跨文件污点 1 条位于 e2e 测试文件，非生效路径。）

## 3. 结论纪律

- 本记录**不构成**「项目安全」声明：扫描覆盖为 `partial`（调用图缺口）、扫描器结论为 `inconclusive`。
- 扫描含 gitignore 的构建产物（`lib/`）：部分 finding 锚定 bundle 行号，重建即漂移，读时注意。
- 唯一的行为性处置是 2.1 的合同与守卫（纯新增测试，零运行时改动）。
