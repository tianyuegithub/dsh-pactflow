## 1. 基线固定与最小护栏（G0-min / G1-min / G4-min / G6-inventory）

- [x] 1.1 记录本次源码基线：`git rev-parse HEAD`、工作树 dirty 状态、`git diff --stat` 与相关文件（`src/git-workspace.ts`、`src/index.ts`、`src/agent/index.ts`、`src/k3s-worker.ts`、`src/infrastructure.ts`）的 SHA-256，写入 change 的基线说明；验证：摘要可复算且与 `HEAD` 一致
- [x] 1.2 为 H1/H2 负例建立最小门禁脚本入口（拒绝 failed/unknown 与缺报告），验证：投喂「全 failed」与「缺报告」反例时门禁失败，投喂通过用例时放行
- [x] 1.3 确保测试/验收报告不在 `finally` 删除唯一证据，通过/失败报告复制到持久目录，验证：制造一次失败运行后报告仍可回看
- [x] 1.4 将四个骨架 e2e（`pactflow-k3s-ttl`、`pactflow-real-probe-ledger`、`pactflow-real-crash-restart`、`pactflow-real-approval`）登记为显式 required-but-not-run，验证：`pnpm run check` 不因骨架被计入覆盖
- [x] 1.5 运行 `pnpm run check` 与 `git diff --check`，验证：基线全绿且无空白错误

## 2. H1 凭据与目标绑定（specs/git-credential-binding）

- [x] 2.1 先写失败测试：Agent 提交可信 remote + 非登记回环 API 地址 + 已登记凭据引用，断言绑定被拒且携凭据请求数为 0；验证：当前实现下该测试失败（红）
- [x] 2.2 `pactflow_bind_git` 参数收敛为 `providerId` + 非敏感仓库身份，移除自由 `gitea_base_url`/`gitea_token_credential_ref` 组合入口；验证：工具参数 schema 不含自由 endpoint 字段
- [x] 2.3 Host 实现 Provider 解析：由 `providerId` 得到 endpoint、认证方式、credentialRef 与允许仓库；验证：合法登记 Provider 正常绑定测试通过（绿）
- [x] 2.4 实现 remote ↔ Provider ↔ repo 规范化校验（SSH/HTTPS 变体、端口、API 子路径），覆盖 Gitea API 与 Git fetch/push 两条认证链；验证：错仓库与错配 credentialRef 测试通过（host + 登记子路径精确前缀匹配；端口不参与匹配并说明理由；`tests/infrastructure.spec.ts` 覆盖）
- [x] 2.5 实现重定向与协议失败关闭：跨源重定向不转发授权头、HTTP 默认拒绝（本地例外除外）；验证：本地 HTTP 服务注入重定向与明文的零携凭据断言通过
- [x] 2.6 历史人工 endpoint+credentialRef 绑定改为只读/阻断并提供重新确认入口；验证：旧绑定不被自动认领测试通过
- [x] 2.7 补正常对照：合法登记绑定仍成功；验证：正常路径测试通过，且错误路径不泄露凭据值
- [x] 2.8 运行 `pnpm run check` 与 `git diff --check`，验证：全绿（35 文件 / 367 测试 / 13 包产物）

## 3. H2 创建资源身份链（specs/k3s-resource-identity）

- [x] 3.1 先写失败测试：ConfigMap 创建 409 且现场存在同名非本轮对象，断言对该对象删除请求数为 0；验证：当前实现下失败（红）
- [x] 3.2 先写失败测试：删除请求超时/返回 403 与返回 202（finalizer pending），断言不被记为清理成功；验证：当前实现下失败（红）
- [x] 3.3 先写失败测试：创建超时且结果不明，断言保留 unknown 责任且不按名删除、单次 404 不清除意图；验证：当前实现下失败（红）
- [x] 3.4 实现创建前授权意图持久化（复用/对齐 `probe-ledger.ts` 语义，不含虚构 UID）；验证：意图落盘失败时零 K8s 创建
- [x] 3.5 实现 UID 回执与 owned 集合，替换 `compensateCreatedChildren` 的名称删除为 UID 前置删除；验证：3.1 转绿且 404 幂等
- [x] 3.6 实现 `create-outcome-unknown` 与删除受理/完成分离状态；验证：3.2、3.3 转绿
- [x] 3.7 实现 `pendingRuntimeSecrets` 一次性释放（成功/失败/取消/超时/丢弃）；验证：失败与取消路径后表项回基线，且不触发按名删除；另补 `worker.discard()` 与 dispatch 预运行丢弃守卫，覆盖「准备对象被丢弃」场景（准入失败/配置漂移/凭证解析失败/取消）
- [x] 3.8 补正常对照：合法创建后按 UID 删除成功、正常绑定路径不受影响；验证：正常路径测试通过
- [x] 3.9 运行 `pnpm run check` 与 `git diff --check`，验证：全绿，且既有 K3s 回归未被削弱

## 4. 跨模块一致性与文档

- [x] 4.1 同步 Client 侧 Git 绑定向导与结果不明对账卡片以匹配新参数合同；验证：设置/项目面板隔离测试通过（客户端一直使用 `giteaProviderId`，无自由端点字段，无需改动）
- [x] 4.2 更新 `docs/implementation-status-实施状态.md` 记录本 change 证据与未运行项；验证：状态含基线、命令、结果、blocker
- [x] 4.3 在 change 内记录「已知未覆盖」清单（真实 K3s 集群行为、真实 Gitea、跨进程崩溃窗口），供 B 类验收承接；验证：清单与 tasks 状态一致

## 5. 收口

- [x] 5.1 运行完整 `pnpm run check`、`git diff --check`，验证：全绿且无未处理错误
- [x] 5.2 运行 `openspec validate harden-p0-trust-boundaries --strict`，验证：通过
- [x] 5.3 change 实施与验证完成后按 OpenSpec 归档（`openspec archive`），验证：delta 归并入 `openspec/specs/` 且 change 进入 archive。B 类结果：K3s ✅、Gitea ✅（本 change spec 直接对应）；worker ❌ 与两个骨架未实现均不属本 change 范围，作为显式缺口保留于 known-gaps
