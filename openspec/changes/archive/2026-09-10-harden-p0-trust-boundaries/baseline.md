# 基线（tasks 1.1）

本 change 实施前固定的源码身份，用于区分「历史复现」「当前静态证据」与「本次新增测试」。

| 项 | 值 |
| --- | --- |
| 分支 | `codex/pactflow-hardening` |
| HEAD | `4bd1fb02b7f4cdb517c296da27ca108529bbf2bd` |
| 工作树 | dirty（4 个已跟踪文件改动：AGENTS.md、目标架构、开发计划、package.json；另有未跟踪的 B 类验收产物与 OpenSpec 文件） |
| 基线验证 | `pnpm run check` 通过：34 个测试文件、366 项测试、13 项包产物检查 |
| 基线时间 | 2026-09-10 |

相关源码文件摘要（SHA-256，实施前）：

| 文件 | SHA-256 |
| --- | --- |
| `packages/dsh-pactflow/src/git-workspace.ts` | `83ab0680869c23ff3c0c64aab654b1dcea660fde5607e42b1a9ab5d081abc297` |
| `packages/dsh-pactflow/src/index.ts` | `1c623638fcae08e53c0be50f539c4ca6d5254440bba756c7c004c1d0ca1f5a9b` |
| `packages/dsh-pactflow/src/agent/index.ts` | `27de8bddcc0b7655c757cfc181cb62bd5f72128b6374af0dc33b610d9fb025e9` |
| `packages/dsh-pactflow/src/k3s-worker.ts` | `c03075031151d8bcdff4a9990cc6beb697a8687035e762bb3e4242bc12814fa5` |
| `packages/dsh-pactflow/src/infrastructure.ts` | `61d4f120a32a75f6273bdaace1cb9bf5efee343a9456ac77a70efadc2708a405` |

**证据说明**：`git-workspace.ts` 的摘要与 2026-09-10 GPT 全面评审包内记录的 `83ab0680…` 逐位一致，确认该评审的复现对象就是本工作树，其 F01/F02 结论可直接用于本 change。
