# 实施进度

## 结果

| 任务 | 状态 | 证据 |
| --- | --- | --- |
| 1.1 失败测试 | ✅ | `tests/cluster-identity.spec.ts` 先失败：同路径换集群、仅 CA 不同时指纹**未变** |
| 1.2 集群身份解析 | ✅ | 构造时从 KubeConfig 取当前集群 `server` + CA（`caData`，或 `caFile` 内容摘要） |
| 1.3 指纹改造 | ✅ | `connectionFingerprint` = namespace + 集群身份；3 项测试通过 |

## spec 场景 → 测试映射

| 场景 | 测试 |
| --- | --- |
| 同路径换集群时身份改变 | `changes when the same kubeconfig path is replaced with another cluster` |
| 仅证书颁发机构不同时身份改变 | `changes when only the certificate authority differs` |
| 同一集群身份稳定 | `is stable for the same cluster identity` |

## 已知边界（诚实）

- Kubernetes 不保证提供通用全局集群 UID；本 change 以 **server + CA** 作为可解析身份，而非集群侧 UID。若上游提供稳定集群标识，应改用它。
- 指纹变化会使历史账本条目不再匹配当前 Provider：按设计**保留责任、不自动删除**（`reconcileProbeCleanupsImpl` 找不到匹配 Provider 时保留），需人工确认。未实现「身份变化时暂停自动清理并提示重新核验」的显式 UI/流程，仅做到保守不误删。
- 凭证轮换（token 变化）不改变集群身份，故指纹不变——符合预期；但「凭证轮换」与「目标集群变化」的区分未在事件层显式记录。

## 验证

`pnpm run check` 通过：49 个测试文件、456 项测试、13 项包产物；`pnpm run typecheck` 通过；`git diff --check` 通过。
