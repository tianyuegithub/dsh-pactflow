# 零脉 PactFlow 同事上手手册（v0.2.1）

目标：拿到发布材料后，在本机从零安装宿主与插件，配置你自己的七类基础设施资源，并跑通第一条「需求 → Worker 执行 → 交付」链路。

> 版本基线：`dsh-pactflow@0.2.1`，worker 镜像 adapter `1.1.0`（DSH 执行器 `0.1.1-rc.2`，协议 `dsh-worker-interactions/v1`）。
> 总体边界：官方 DSH 发行版尚未包含插件依赖的三项上游通用能力，本版为**开发者预发布**，宿主需先用发布材料中的前置分支 bundle 构建。

## 0. 你会拿到什么

GitHub 仓库：<https://github.com/tianyuegithub/dsh-pactflow>（源码 + 文档，分支 `main` 与 `codex/pactflow-hardening`）。

Release **v0.2.1** 附件（`gh release download v0.2.1 -R tianyuegithub/dsh-pactflow` 或浏览器下载）：

| 附件 | 用途 |
| --- | --- |
| `dsh-pactflow-0.2.1.tgz` | 插件安装包（也可直接用 Release URL 安装，见 §2） |
| `pactflow-worker-images-1.1.0.docker.tar.gz` | 两个钉版 worker 镜像（业务 + 验收），`docker load` 后推到你自己的 Harbor |
| `deepseek-harness-pactflow-prerequisites-<hash>.bundle` | 上游前置分支（官方 DSH 缺的三项能力），离线恢复宿主源码用 |
| `dsh-pactflow-0.2.1-source.bundle` | 本仓库完整 Git 历史（离线备份用；能访问 GitHub 可忽略） |
| `SHA256SUMS` | 校验清单；解压/下载后先 `shasum -a 256 -c SHA256SUMS`，任一失败即停止 |

内网同事的替代路径：worker 镜像已推送到测试 Harbor `192.168.31.200:8080/datavdl/pactflow-worker`（tag `pactflow-interactions-v1.1-artifact` 与 `…-acceptance`），同网络可直接 `docker pull`。

## 1. 前置条件

- Node.js ≥ 22.19（或 ≥ 24）、pnpm 11（`corepack enable`）、git、Docker Desktop（导入/推送镜像用）、kubectl。
- 一个你自己的 K3s 集群（任意版本，能被本机 kubeconfig 访问即可）。
- 一个你自己的 Harbor（或任意 Docker Registry；下文统称 Harbor）。
- 一个你自己的 Gitea（≥1.22；用于项目 Git 绑定与受保护 PR 收口）。
- 一个模型端点 + API Key（DeepSeek 官方，或任意 OpenAI 兼容/Anthropic 兼容端点）。
- 浏览器（宿主 Web UI 在 `http://127.0.0.1:3080`）。

## 2. 第一步：准备宿主 DSH 并安装插件

```bash
# 2.1 恢复前置分支（官方发行版尚缺 externalEventProducers 等三项能力）
git clone deepseek-harness-pactflow-prerequisites-<hash>.bundle dsh-host
cd dsh-host && git checkout codex/external-session-event-producers-clean
pnpm install && pnpm run build
pnpm dsh web            # 起在 http://127.0.0.1:3080（先保持运行，下一步装插件后重启）
```

```bash
# 2.2 安装插件（二选一）
dsh plugin --profile web add https://github.com/tianyuegithub/dsh-pactflow/releases/download/v0.2.1/dsh-pactflow-0.2.1.tgz
dsh plugin --profile web add ./dsh-pactflow-0.2.1.tgz
```

```bash
# 2.3 重启前核对安装
dsh --profile web --dump-config | grep -E "dsh-pactflow|pactflowPresetRoot|agent-presets"
# 必须看到：# == dsh-pactflow 注释块、pactflowPresetRoot、一个 pactflow Host row、现有 agent-presets row
```

```bash
# 2.4 重启宿主并验证
dsh --profile web
# 浏览器打开 http://127.0.0.1:3080，新会话模式列表出现「零脉模式」；
# Standard 等其它模式不应出现 PactFlow 工具或控制台入口。
```

提示：Harbor/K3s 使用自签证书时，启动宿主必须带 `NODE_EXTRA_CA_CERTS=/absolute/path/ca.crt`；端口被占时先 `lsof -i :3080` 清理再启动。

## 3. 第二步：导入 worker 镜像并推送到你的 Harbor

```bash
shasum -a 256 -c SHA256SUMS                 # 先校验
docker load -i pactflow-worker-images-1.1.0.docker.tar.gz
# 载入两个镜像（原仓库名 192.168.31.200:8080/datavdl/pactflow-worker）：
#   :pactflow-interactions-v1.1-artifact            ← 业务任务用
#   :pactflow-interactions-v1.1-artifact-acceptance ← 仅隔离验收用，不用于业务

docker tag 192.168.31.200:8080/datavdl/pactflow-worker:pactflow-interactions-v1.1-artifact \
  <你的Harbor>/<项目>/pactflow-worker:v1.1
docker push <你的Harbor>/<项目>/pactflow-worker:v1.1
docker inspect --format '{{index .RepoDigests 0}}' <你的Harbor>/<项目>/pactflow-worker:v1.1   # 取 digest，第 4 步要用
```

规则：**执行器模板里的镜像必须用 digest（`repo@sha256:…`），不允许可变 tag**——这是插件的防漂移合同，你 Harbor 里 push 后的 digest 就是模板要填的值。

## 4. 第三步：配置你的七类资源

入口：Web UI → **设置 → 零脉基础设施**。每张卡片都有「测试」类探针按钮：**探针类配置保存后立即生效可测；运行时行为（Worker 池、派发准入）需重启宿主后生效**。

| # | 卡片 | 必填要点 | 红线 |
| --- | --- | --- | --- |
| 1 | **K3s 集群** | kubeconfig 绝对路径、Worker Namespace | kubeconfig 只存路径，不贴内容 |
| 2 | **Harbor 镜像仓库** | endpoint、project、Harness 仓库（默认 `pactflow-worker`）、TLS 策略、拉取密钥引用 | Harbor auth 原值不进 Settings；填 Kubernetes `dockerconfigjson` Secret 名 |
| 3 | **模型连接** | baseUrl、model id；密钥走 DSH 凭证引用 | API key 原值不进 Settings JSON/日志 |
| 4 | **Gitea Git Provider** | Gitea 地址；API token 走凭证引用（原值不写入 Settings） | token 只存凭证引用 |
| 5 | **Harness 模板** | 开发工具 + worker 镜像 digest + CPU/内存；不绑模型。兼容矩阵固定：Claude Code→`anthropic-messages`，Codex→`openai-responses`，OpenCode/DSH→`openai-chat-completions` | 镜像必须 digest；远程审批/提问开关只对 DSH 专用镜像有意义 |
| 6 | **Worker 池** | 选集群 + 允许的 Harness；并发上限 1–12，是**池级总量**（不分 Harness），所有使用该池的项目共享，超出自动排队 | — |
| 7 | **对象存储（大内容外置）** | 可选。S3 兼容（如 RustFS）endpoint + bucket；在具体项目里绑定后，执行日志等大内容外置为 artifactRef 地址 | 删除被项目引用的存储会失败关闭；不绑定不影响现有行为 |

模型 Secret 约定：模板只存 K8s Secret 名；Claude Code 读取 `ANTHROPIC_AUTH_TOKEN`，Codex/OpenCode/DSH 读取 `OPENAI_API_KEY`。项目 Git 绑定只存 Secret 名，Secret 须含 `id_ed25519` 与 `known_hosts`（Pod 以 UID 1001、0440、strict host-key checking 挂载）。

## 5. 第四步：跑通第一条链路（验收清单）

1. 建一个测试 Git 仓库（如静态页 + 一个冒烟脚本），clone 到本地，remote 指向你的 Gitea。
2. 在 DSH 中新建会话，选择「零脉模式」，`pactflow_initialize` 绑定该工作区。
3. 项目配置：绑定 Git（自动按 remote 匹配你的 Gitea 仓库）→ 保存 Agent 策略（选集群、Worker 池、Harness 模板）→（可选）绑定对象存储。
4. 发一个最小需求（例如"在仓库新增 about.html 静态页并跑通冒烟脚本"）。
5. 观察点：
   - 你的 K3s 出现短期 Job/Pod（`app.kubernetes.io/name: dsh-pactflow-worker`）；
   - 「打开零脉」工作台三个视图推进：进展 / 执行记录 / 验收交付；
   - 执行器审批或提问会回到「执行代理待确认」，答复有「已送达」回执；
   - 任务分支出现在你的 Gitea 仓库，收口时以真实验证与合并为准。
6. 验收通过标准：需求推进到交付、验证命令真实执行、任务分支合并或按合同保留现场；测试结束确认 K3s Job 与任务分支已按对账清理。

## 6. 排障速查

| 症状 | 处置 |
| --- | --- |
| 侧边栏「零脉」入口消失 | 宿主未完成重启事务或插件未装进当前 Profile：重跑 `--dump-config` 四标记核对后重启 |
| Remote 调用 404（Typert 未注册） | 0.2.0 已知缺陷；确认安装的是 0.2.1（裸 npm identity 注册） |
| 启动报 EADDRINUSE | `lsof -i :3080` 清掉旧进程再启动 |
| `kubectl` 连不上集群 | 检查 kubeconfig 路径与 VPN/网络；设置里的探针会明确报 `kubectl cannot reach namespace pactflow` 类条目 |
| Worker Pod 拉不动镜像 | 核对 imagePullSecret（`dockerconfigjson`）与 Harbor TLS；自签 CA 记得 `NODE_EXTRA_CA_CERTS` |
| 旧插件打不开新会话 | 事件词汇按版本只读兼容；新版写入的会话不能用旧包读取，先升级插件 |
| 想卸载 | 先查 `pactflow/drainStatus`：非终态 Run 或未完成清理任一非空就不要卸载，`safeToUninstall: true` 才继续 |

## 7. 安全红线（每位使用者都要遵守）

- 原始凭证（API key、token、SSH 私钥、Harbor auth）不得进入 Session Log、Remote payload、Tool result、Git、argv、截图或持久日志；一律走 DSH 凭证引用 / K8s Secret。
- Mock 只用于边界清晰的隔离测试；安装、卸载、Session 恢复、Git、Gitea、Harbor、K3s 验收走真实路径。
- 真实套件（`test:real-*`）会产生真实模型调用与外部写入，未运行不得计为通过，不要对着生产仓库或收费线路随手跑。

## 8. 当前边界与诚实声明

- 官方 DSH 支持前，宿主必须用前置分支 bundle（§2）；官方能力合入后可回到 npm 安装路径。
- worker 镜像内执行器固定为 DSH `0.1.1-rc.2`；较新版本的事件式适配路径未做镜像验收。
- 本发布批次的自动化证据：`pnpm check` 101 文件 / 737 测试全绿、gitleaks 全历史扫描零命中、两个镜像 digest 与 `release-manifest.json` 钉版一致。真实端到端（真实模型 + 真实集群）与安全审计（Mimosa）账目未在本次发布批次重跑，不作为本手册的宣称范围。

更多细节：[安装与运维](installation-operations-安装运维.md)（生命周期/升级卸载/持续运行）、[当前实施状态](implementation-status-实施状态.md)（已验证提交与 blocker）。
