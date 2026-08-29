# DSH 零脉插件安装与运维

## 1. 适用范围

本文是 `dsh-pactflow` 0.2.0 的安装与运维手册。插件是 DSH Profile Bundle，不修改官方 DSH 产品源码，不启动第二个控制面 daemon；Host、Agent Preset、Web Client、Settings、Git/Gitea 和 K3s Provider 都随一个 Package 安装或卸载。

当前公开安装有一个硬前提：DSH 发行版必须包含外部持久 Session Event producer、外部 Typert package recognition 和 per-run Subagent cwd 三项通用能力。本地验收使用 `/Users/ty/Codes/deepseek-harness-pactflow-p0` 的 `codex/external-session-event-producers` 分支，最后验证提交为 `129a6e2498`；这些提交进入官方发行版之前，不得把源码 worktree 验收宣传成普通 npm 用户可安装版本。

## 2. 构建与安装

在插件仓库执行：

```bash
pnpm install
pnpm run check
pnpm run pack
dsh plugin --profile web add ./dist/dsh-pactflow-0.2.0.tgz
dsh --profile web --dump-config
dsh --profile web
```

`dump-config` 必须出现 `# == dsh-pactflow`、`pactflowPresetRoot`、一个 `pactflow` Host row 和现有 `agent-presets` row。启动后，新会话模式列表必须出现 PactFlow；Standard 等其它模式不应出现 PactFlow 工具或控制台入口。

离线交付目录还包含 `dsh-pactflow-0.2.0-source.bundle` 和 `deepseek-harness-pactflow-prerequisites-129a6e2498.bundle`：前者保存插件截至发布提交的完整 Git 历史，后者保存尚未进入官方 DSH 的上游前置分支。安装或恢复前，在 `dist/` 中执行 `shasum -a 256 -c SHA256SUMS`；安装包或任一源码包校验失败都必须停止。

## 3. 非密钥 Settings

Web 的 Settings → Plugins → Plugin configuration 中会出现“PactFlow K3s templates”。该 namespace 的变更在 Profile 重启后生效。字段只保存集群路径、Secret 名称、镜像 digest、模型地址、协议与资源限制；API key、token、SSH 私钥和 Harbor auth 不得写入 JSON。

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
pnpm run check
pnpm run test:web
pnpm run test:real-worker
pnpm run test:real-k3s
DSH_SKIP_BUILD=1 pnpm run verify:profile
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

## 7. 升级、卸载与恢复

升级使用同一 Profile 的 `plugin add` 安装新 tarball，然后重启 Profile 并重跑 `dump-config`、浏览器 smoke 和冷 Session 读取。0.2.0 当前写入 13 类外部事件，同时以 read-only registration 读取 0.1.0 的 12 类事件；升级不重写历史日志。

卸载：

```bash
dsh plugin --profile web remove dsh-pactflow
dsh --profile web --dump-config
dsh --profile web
```

卸载后 Bundle row、Preset、Client UI 和 Settings namespace 必须消失；Session 原始日志保留。含 required PactFlow 外部事件的 Session 在匹配插件重装前应失败关闭，不能静默切换 Standard 模式。匹配版本/事件词汇重装后恢复读取。

Host 重启期间 K3s Job 可以继续。PactFlow Agent 重新成为 live 后，Host 按持久 Run Spec 对账已存在 Job：租约内成功结果会 fetch/验证/结算，活动 Job 会续租等待，过期 Job 会取消并记录 expiry，缺失 Job 会失败关闭。

## 8. 当前外部阻塞

本地代码、Package、浏览器、Git、K3s、四 Harness/API、恢复和假 Gitea 1.22 PR/merge 契约均已验证。公开发布仍受两个外部条件约束：三项 DSH 通用提交进入受支持发行版；配置真实 Gitea API token 后，在明确授权的测试仓库完成一次受保护 PR/merge。未满足前，发布结论只能是 `CONDITIONAL_GO（有条件可发布）`。
