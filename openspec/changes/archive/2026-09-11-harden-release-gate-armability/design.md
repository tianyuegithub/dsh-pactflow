## Context

见 `proposal.md · Why`。相关约束：

- 门禁通过条件是「网页报告零跳过」（`assertReleaseWebReport`），因此任何被门控套件的跳过都会使门禁不可满足。
- 本仓真实套件从**自身进程环境**读取凭据与开关（`process.env.*`），凭据不得进入 argv/日志。
- 已有一个离线守卫 `tests/real-web-gate-prerequisites.spec.ts`，但它此前只覆盖 `DSH_SNAPSHOT` 一个确定性分支，未覆盖「武装集是否覆盖所有套件」。

## Goals / Non-Goals

**Goals**

- 让「网页零跳过」条件**真实可达**：武装集覆盖每个门控套件的开关，且检查过的凭据确实注入被测子进程。
- 让不可满足性**离线可暴露**：新增套件若未纳入武装集，测试立即失败。
- 凭据读取**单一实现**：两个门禁与真实套件运行器共用同一读取器。

**Non-Goals**

- 不改变门禁的通过/失败判定语义（仍是零跳过、全通过、无缺失套件）。
- 不引入凭据进入 argv/日志的路径。
- 不解决官方 DSH 发行版缺 `externalEventProducers` 的上游问题（属另一上游事项）。

## Decisions

### 决策 1：武装集抽为单一函数 `realWebGateEnvironment()`，两门禁复用

- **理由**：`check:release` 与 `run-real-web-gate` 是同一「零跳过」条件的两入口，此前各自手写 env，必然漂移（本次缺陷正是漏项）。抽为一个函数使「武装」只有一处定义。
- **备选**：在两个脚本各自补齐开关——被否，重复即未来漂移源。
- **形态**：返回 `Object.freeze({...开关..., ...gateCredentialEnvironment()})`；因解析凭据需要读盘，用函数而非常量。

### 决策 2：凭据「检查」与「注入」使用同一解析结果

- **理由**：缺陷根源是「检查存在」与「注入使用」分离——前者通过而后者缺失，套件在 `beforeAll` 抛错被 vitest 计为 skipped。
- **做法**：`resolveCredential(name)`（env 优先，其次凭据库，与产品解析顺序一致）同时服务前置检查与注入。**只把值放进子进程 env**，不进 argv/日志。

### 决策 3：守卫从套件源码反推必需开关

- **理由**：手写「必需开关清单」会与套件脱节。从每个 `*.e2e.spec.ts` 的模块级开关声明（`const enabled|record|realDescribe … process.env.X`）反推，使新增套件自动纳入守卫范围。
- **取舍**：正则限于模块级 `const` 行，避免误抓套件体内 `process.env`（如 `PACTFLOW_KEEP_ROOT` 等非门控项）。

### 决策 4：凭据库读取抽为 `scripts/credential-refs.mjs`

- **理由**：三个脚本（两门禁 + 两运行器）此前各自 `yaml.load` + 手写键路径，行为不一致（如 `refs.` 前缀）。单一读取器消除差异。
- **安全**：该模块只返回值给调用方注入子进程 env，不打印。

## Risks / Trade-offs

- [真实套件依赖集群/凭据，离线守卫无法覆盖真实可用性] → 守卫只覆盖「确定性分支 + 武装集完备性」；真实可达性由 `test:real-web-gate` 真实全绿证明（本轮已 20/20 套件通过）。
- [从源码反推开关可能漏掉非 `const enabled|record|realDescribe` 形态的门控] → 现有 10 个套件均用这三种形态；若将来出现新形态，反推测试会因必需开关为空/不全而暴露，另行扩展正则。
- [注入凭据到子进程 env 扩大暴露面] → 仅注入必需的两个 ref 且仅到直接子进程；不写文件、不进 argv、不打印，符合 AGENTS.md 凭据约束。

## Migration Plan

1. 抽 `credential-refs.mjs`，两运行器改用之。
2. `run-real-web-gate.mjs` 抽 `realWebGateEnvironment()` + 凭据注入；`check-release.mjs` 复用。
3. 扩充守卫测试；迁移 `real-suite-inventory` 的 approval 桶。
4. 真实运行 `test:real-web-gate` 验证零跳过全绿；失败可回退到修复前（但会把门禁退回不可满足，故应向前修）。

## Open Questions

（无。）
