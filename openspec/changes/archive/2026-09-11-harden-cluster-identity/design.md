## Context

见 proposal.md（Why）。关键事实：

- `connectionFingerprint()`（`src/k3s-worker.ts`）原摘要 `namespace + kubeconfig ?? '(default)' + context ?? '(default)'`。
- 构造函数用 `KubeConfig`（`loadFromFile`/`loadFromDefault` + `setCurrentContext`）建立客户端；`getCurrentCluster()` 可取得 `server`/`caData`/`caFile`。
- 该指纹用于 `probe-ledger` / `run-ledger` 的持久清理责任匹配（`reconcileProbeCleanupsImpl` 按指纹选 Worker）。

约束：不改变清理时的 UID 前置条件；不读取或持久化任何凭证材料（CA 只做摘要）。

## Goals / Non-Goals

**Goals:**
- 指纹随集群标识变化，不随路径/上下文名变化。

**Non-Goals:**
- 不引入集群侧 UID 查询（Kubernetes 不保证提供通用全局集群 UID）；本 change 以 server + CA 作为可解析身份。
- 不改清理协议或账本格式。

## Decisions

### D1：身份 = server + CA 摘要

`${server}` 与 CA 材料（`caData`；若无则 `caFile` 内容摘要，读不到时退回路径字符串并仍参与摘要）一起哈希，再与 namespace 组合。这样同一路径换集群会使身份改变，且不依赖路径。

- 备选：查询集群侧 UID。否决——Kubernetes 无通用全局集群 UID；查询本身也需要连接，且可能不稳定。

### D2：指纹变化是保守失败

既有账本条目在指纹改变后不再匹配当前 Provider，`reconcileProbeCleanupsImpl` 会保留该责任（不删除）。这是期望行为：宁可保留待人工确认，也不把旧集群责任应用到新集群。

## Risks / Trade-offs

- [CA 以文件路径提供时读取失败] → 退回把该路径字符串纳入摘要（仍能区分不同配置），不抛错。
- [指纹变化使历史账本不再自动对账] → 保留责任、不误删；用户可重新确认。
- [多集群共享同一 server+CA 但 namespace 不同] → namespace 已纳入摘要，可区分。

## Open Questions

（无。）
