# DSH 零脉插件安装与运维

## 1. 适用范围

本文是 `dsh-pactflow` 0.2.1 的安装与运维手册。插件是 DSH Profile Bundle，不修改官方 DSH 产品源码，不启动第二个控制面 daemon；Host、Agent Preset、Web Client、Settings、Git/Gitea 和 K3s Provider 都随一个 Package 安装或卸载。

当前公开安装有一个硬前提：DSH 发行版必须包含外部持久 Session Event producer、外部 Typert package recognition 和 per-run Subagent cwd 三项通用能力。本地验收使用 `/Users/ty/Codes/deepseek-harness-pactflow-upstream-pr` 的 `codex/external-session-event-producers-clean` 分支，最后验证提交为 `aa888ad0fb`；这些提交进入官方发行版之前，不得把源码 worktree 验收宣传成普通 npm 用户可安装版本。

## 2. 构建与安装

公共 Package 发布后，使用 DSH 官方命令管理完整生命周期：

```bash
dsh plugin --profile web add dsh-pactflow@0.2.1
dsh plugin --profile web update dsh-pactflow
dsh plugin --profile web remove dsh-pactflow
```

0.2.1 仍等待上游通用能力进入官方 DSH，目前只面向使用已验证 fork 的开发者预发布。本地构建与 tarball 安装方式如下。

公开 GitHub Release 也提供同一 tarball：

```bash
dsh plugin --profile web add https://github.com/tianyuegithub/dsh-pactflow/releases/download/v0.2.1/dsh-pactflow-0.2.1.tgz
```

在插件仓库执行：

```bash
pnpm install
pnpm run check
pnpm run pack
dsh plugin --profile web add ./dist/dsh-pactflow-0.2.1.tgz
dsh --profile web --dump-config
dsh --profile web
```

`dump-config` 必须出现 `# == dsh-pactflow`、`pactflowPresetRoot`、一个 `pactflow` Host row 和现有 `agent-presets` row。启动后，新会话模式列表必须出现 PactFlow；Standard 等其它模式不应出现 PactFlow 工具或控制台入口。

**离线交付目录（发布时打包，非本仓构建产物）**：正式离线交付目录除 tarball 外还包含 `dsh-pactflow-<version>-source.bundle`（插件截至发布提交的完整 Git 历史）与 `deepseek-harness-pactflow-prerequisites-<hash>.bundle`（尚未进入官方 DSH 的上游前置分支），以及校验清单 `SHA256SUMS`；安装或恢复前在 `dist/` 中执行 `shasum -a 256 -c SHA256SUMS`，安装包或任一源码包校验失败都必须停止。

> 现状说明（2026-09-11 核实）：`pnpm run pack` 只产出 `dist/dsh-pactflow-<version>.tgz`；**上述 source bundle 与 `SHA256SUMS` 由发布流程另行生成，本仓当前没有生成它们的脚本**。因此本地 `dist/` 内通常看不到它们——请勿对不存在的 `SHA256SUMS` 执行校验，也不要据本节误认为它们已随构建产出。

## 3. 非密钥 Settings

Web 的 Settings → Plugins → Plugin configuration 中会出现“PactFlow K3s templates”。该 namespace 的变更在 Profile 重启后生效。字段只保存集群路径、Secret 名称、镜像 digest、模型地址、协议与资源限制；API key、token、SSH 私钥和 Harbor auth 不得写入 JSON。

生效时机（`infrastructure-probe-freshness` 合同）：**运行时资源**（Worker 池、K3s client、派发准入、定时器）重启后才生效；**探针类只读诊断**（可用性测试、镜像拉取凭证/Harbor 制品/Git Secret 发现、删除影响评估）始终读取**当前已保存**的配置文档——保存后无需重启即可测试，但派发行为在重启前保持不变。

最小配置示例：

```json
{
  "namespace": "pactflow",
  "kubeconfig": "/absolute/path/to/kubeconfig",
  "imagePullSecret": "pactflow-registry",
  "pollIntervalMs": 1000,
  "templates": [
    {
      "id": "dsh",
      "harness": "dsh",
      "apiMode": "openai-chat-completions",
      "image": "registry.example/project/pactflow-worker@sha256:<64-hex-digest>",
      "model": "model-id",
      "baseUrl": "https://model.example/v1",
      "modelSecretName": "pactflow-model-dsh",
      "cpuRequest": "250m",
      "memoryRequest": "512Mi",
      "cpuLimit": "2",
      "memoryLimit": "2Gi"
    }
  ]
}
```

Harness/API mode 是固定兼容矩阵：Claude Code → `anthropic-messages`，Codex → `openai-responses`，OpenCode/DSH → `openai-chat-completions`。镜像必须使用 digest，不能使用可变 tag。

## 4. 凭证与 Secret

- HTTPS Git token 和 Gitea API token：Settings/Project 只保存 DSH Credential Ref；Host 每次操作重新解析，token 仅进入私有临时 AskPass 的进程环境。
- K3s model Secret：模板只保存 Secret 名。Claude Code 读取 `ANTHROPIC_AUTH_TOKEN`；Codex/OpenCode/DSH 读取 `OPENAI_API_KEY`。Base URL 是非密钥模板字段。
- K3s Git Secret：项目 Git 绑定只保存 Secret 名；Secret 必须含 `id_ed25519` 和 `known_hosts`。Pod 使用 UID/GID 1001、`0440` mount 和 strict host-key checking。
- Harbor pull：Kubernetes `dockerconfigjson` Secret 只由 kubelet 消费，插件不读取其原值。

任何原始凭证都不得进入 Session Event、Remote result、Tool result、ConfigMap、argv、URL、截图或持久日志。

## 5. 验证

```bash
pnpm run check              # 构建 + 单元测试 + 打包产物校验（默认门禁）
pnpm run test:web           # e2e（按环境门控跳过，不计为通过）
pnpm run verify:profile     # 安装后的 Profile 校验（需已安装 CLI，见 §8）
```

以下套件需要真实环境与逐项授权；**未运行时不得计为通过**：

```bash
pnpm run test:real-worker         # 真实模型 + 本地 Worker（在隔离任务工作树提交）
pnpm run test:real-k3s            # 真实集群：K3s Worker + 四 Harness 探针 + 任务矩阵
pnpm run test:real-k3s-batch      # 上一行的批量形态：suites → ttl → zero-proof（需 PACTFLOW_K3S_TTL_PROBE=1 PACTFLOW_K3S_ZERO_PROOF=1）
pnpm run test:real-gitea          # 真实受保护仓库 PR 收口
pnpm run test:real-todo           # dogfood：真实两节点依赖链产出可用待办网页
pnpm run test:real-probe-ledger   # 真实集群探针账本对账（UID 前置删除 + 404 幂等）
pnpm run test:real-crash-restart  # 真实跨进程崩溃重启恢复
```

`test:real-worker` 会发生真实模型调用。`test:real-k3s` 会创建短期 Job/ConfigMap、调用四种 Harness/API，并在测试仓库创建随机任务分支；测试结束必须确认这些资源和分支均被删除。不要在生产仓库或收费模型线路上运行，除非已经明确授权。

## 6. 持续运行

生成 macOS launchd 配置：

```bash
pnpm run service:generate -- --platform launchd --dsh /absolute/path/to/dsh --profile web --log-dir /absolute/path/to/logs
```

生成 Linux systemd user 配置：

```bash
pnpm run service:generate -- --platform systemd --dsh /absolute/path/to/dsh --profile web
```

生成器只写 stdout。运维人员审阅后再保存到 `~/Library/LaunchAgents/ai.deepseek.dsh.pactflow.web.plist` 或 `~/.config/systemd/user/dsh-pactflow.service` 并由对应系统工具加载。零脉不维护第二个 daemon。

### 6.1 跨主机/共享盘上的工作区配置锁

工作区项目配置（每个工作区一份的 JSON，记录 Git 远端绑定、验证配置、Worker 策略与仓库对账状态机）由**跨进程文件锁**保护。语义与边界：

- **互斥依据**：锁以目录 rename 原子抢占。单机由本机文件系统保证；共享盘上由 NFS 服务端 RENAME 原子性保证（协议行为，本仓不重复实现）。
- **异宿主遗留锁：失败关闭，绝不夺取**。本机无法探测异主机进程是否存活，因此 owner 记录属于其它主机时**永不**恢复/改名/删除——竞争者在 5 秒后失败，错误信息指名持有者（`held by host "X", pid Y`）。这是「绝不偷活主」的代价侧，不是缺陷。
- **人工恢复（仅当确认持有主机已停用该工作区）**：查看 `<配置文件>.lock/owner-*.json` 中的 host 与 pid；确认后删除整个 `<配置文件>.lock` 目录即可。
- **真实 NFS 双客户端互斥验证：不排期（2026-09-12 用户裁决）**。产品部署形态为**单实例多客户端**（一台服务器一个 DSH、浏览器访问；两台机器即两个独立 DSH、两个独立 home），跨主机双客户端共享 home 属非目标部署形态（与「远程企业平台=永久非目标」裁决同族）。下方 runbook 仅在未来**主动选择**该形态时使用，使用前按步骤取得证据，**在那之前不得宣称跨主机互斥已验证**：

```bash
# 1) 本机 nfsd 导出一个目录，并挂载两个独立挂载点（= 两个独立 NFS 客户端实例，
#    各有独立的属性缓存，等价于两台客户机的竞争形态）
echo "/Users/ty/pf-nfs -network 127.0.0.1 -mask 255.255.255.255 -maproot=root" | sudo tee /etc/exports.d/pf-lock-test
sudo nfsd enable && sudo nfsd start
mkdir -p /Users/ty/pf-nfs /mnt/pf-nfs-a /mnt/pf-nfs-b
sudo mount_nfs 127.0.0.1:/Users/ty/pf-nfs /mnt/pf-nfs-a
sudo mount_nfs 127.0.0.1:/Users/ty/pf-nfs /mnt/pf-nfs-b
# 2) 互斥：两个终端各在一个挂载点跑多进程 driver，最终计数必须精确等于 进程数×迭代数
PACTFLOW_LOCK_PATH=/mnt/pf-nfs-a/w.locktarget node scripts/multi-process-lock-driver.mjs
PACTFLOW_LOCK_PATH=/mnt/pf-nfs-b/w.locktarget node scripts/multi-process-lock-driver.mjs
# 3) 遗留锁：在 A 挂载点建锁后 kill -9 持锁进程，再在 B 挂载点跑
#    scripts/workspace-lock-foreign-driver.mjs → 必须超时且指名 A 的 host/pid
# 4) 清理（全部还原）
sudo umount /mnt/pf-nfs-a /mnt/pf-nfs-b && sudo nfsd disable && sudo rm /etc/exports.d/pf-lock-test
```

## 7. 升级、卸载与恢复

升级使用同一 Profile 的 `plugin add` 安装新 tarball，然后重启 Profile 并重跑 `dump-config`、浏览器 smoke 和冷 Session 读取。0.2.1 当前写入 **17** 类外部事件（`PACTFLOW_EVENT_TYPES_V0_3`），同时以 read-only registration 读取 0.1.0 的 12 类词汇与 0.2.0 的 13 类词汇；升级不重写历史日志。

卸载——**先做 drain 检查**（`pactflow/drainStatus`）：

该只读查询跨全部 PactFlow 会话（**含未 live 的冷会话**）汇总两类未完成责任：非终态 Run 与未成功的清理责任（含被标记保留的失败现场）。它不修改任何状态、不触发任何清理。**任一非空即不宜卸载**：先到对应 Session 里结束/取消任务并重试清理；确需立即卸载的，必须知情并自行承担遗留资源（K3s Job/Pod、任务分支、失败现场）不再被自动对账的后果。`safeToUninstall: true` 才可安全卸载。

```bash
# 安全前置：在卸载前查询（Web Profile 运行中经 Remote；或卸载前用浏览器 UI 触发）
#   pactflow/drainStatus  ->  { safeToUninstall, activeRuns[], pendingCleanups[] }
dsh plugin --profile web remove dsh-pactflow
dsh --profile web --dump-config
dsh --profile web
```

卸载后 Bundle row、Preset、Client UI 和 Settings namespace 必须消失；Session 原始日志保留。含 required PactFlow 外部事件的 Session 在匹配插件重装前应失败关闭，不能静默切换 Standard 模式。匹配版本/事件词汇重装后恢复读取。旧日志的读取版本可追溯：`pactflow/projectHandover` 的摘要携带 `packageVersion` 与 `eventProducerVersion`。

Host 重启期间 K3s Job 可以继续。PactFlow Agent 重新成为 live 后，Host 按持久 Run Spec 对账已存在 Job：租约内成功结果会 fetch/验证/结算，活动 Job 会续租等待，过期 Job 会取消并记录 expiry，缺失 Job 会失败关闭。

## 8. 当前外部阻塞

本地代码、Package、浏览器、Git、K3s、四 Harness/API、恢复，以及真实 Gitea 1.22 受保护 PR/merge 均已验证。真实验收发现并修复了 PR 创建后 merge endpoint 暂时返回 405 的异步竞态；Client 只对 Gitea 明确报告的 transient mergeability 状态有界重试，永久错误立即失败。公开稳定发布仍受一个外部条件约束：三项 DSH 通用能力进入受支持发行版。未满足前，发布结论只能是 `CONDITIONAL_GO（有条件可发布）`。

`dsh-pactflow@0.2.0` 已发布但存在外部 Typert 未注册导致 Remote 404 的缺陷，保留 deprecation 提示并升级到 0.2.1。0.2.1 使用裸 npm package identity 注册 Host，使 Typert Loader、Gateway 与 Client 共享同一身份；上游能力进入官方发行版后再发布稳定版本。

## 9. 需人工/授权完成的两步

以下两步**无法由自动化代执行**，是当前唯一未闭环的验收项。

### 9.1 真实人工审批（`test:real-approval`）

**已实现并可运行（2026-09-11）**：`e2e/pactflow-real-approval.e2e.spec.ts` 已从 `expect.fail` 骨架扩成半自动形态，专用运行器为 `scripts/run-real-approval-e2e.mjs`（`pnpm run test:real-approval`）。运行器只做一件事：从 `~/.dsh/.credentials.yaml` 读取 `DEEPSEEK_API_KEY`，以 `DSH_SNAPSHOT=record` 起真实模型回合；**「作出批准决定」这一步仍在真实浏览器里完成**，不由脚本代按。

该验收要求真人在原生 DSH UI 上作出批准决定（契约：不允许任何自动批准路径）。脚本自动完成的部分：驱动 Web 组合到 `[data-approval-key]` 弹窗、校验弹窗摘要与调用参数一一对应、点击 `Allow once`、断言落账。人工只需在弹窗出现时点击一次（或让脚本代点——脚本已就绪，但语义上该点击就是「人工决定」本身）：

1. 运行 `pnpm run test:real-approval`；脚本会以 `pactflow` preset 起真实 scaffold，让真实模型依次调用 `pactflow_view` →（必要时）`pactflow_initialize` → `pactflow_create_need` → `pactflow_transition_need` → `pactflow_record_review`。
2. UI 弹出 DSH 审批请求，内容含：需求 id、需求修订、评审类型、决定、证据说明与**证据摘要**。
3. 弹窗出现后脚本先断言「此时尚未落账」（`approval/asked` 有、`approval/decided` 与 `pactflow/review-recorded` 均无），证明不存在自动批准路径；随后触发 `Allow once`。
4. 回合结束后断言一一对应：`approval/asked` → `approval/decided`(`allowed-once`) → `pactflow/review-recorded`；后者的 `source` 为 `dsh-approval`，并携带 `approvalRequestId` 与 `evidenceDigest`；门禁 `discussion → confirmed` 真实推进。
5. 反例（拒绝/取消/不可用、无 Approval 服务、凭证样证据、审批期间需求被改）由确定性单测 `tests/review-authorization.spec.ts` 覆盖，不在本真实套件重复。

判定要点：审批弹窗的摘要必须与调用参数一一对应（防「批准 A 却记录 B」）；任何**自动化代替点击**都会使该验收失去意义——脚本点击只是为了让人工决定可复现，真实场景请由本人点击。

**已实测（2026-09-11）**：改用相邻仓 `apps/web/tests/approval-composer.e2e.ts` 的原生弹窗交互（`panel.getByRole('button', { name: 'Allow once' })`）。连续 3 次通过（各约 11–16s），实测真实模型 `deepseek-official/deepseek-v4-flash` 驱动完整工具链（`pactflow_view, initialize, create_need, transition_need, record_review, view, transition_need`），弹窗正文含与调用一致的 `approval-gate`、修订 2 与 64 位证据摘要。详见 `docs/b-class-k3s-acceptance-20260911.md` §8。

### 9.2 推送与合并（需显式授权）

本地提交已完成；推送属外发动作，**已获授权并完成**（2026-09-11）：

```bash
git push -u origin codex/pactflow-hardening    # 已建 upstream，local==remote
```

合并 `main` 与主目录同步仍属 Git 变更操作，需单独授权；在授权前不要执行。

