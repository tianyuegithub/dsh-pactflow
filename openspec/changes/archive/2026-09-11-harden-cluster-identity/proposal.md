## Why

GPT 评审附录 A07 指出：**kubeconfig 路径不是集群的不可变身份**。用户可在同一路径/上下文名下替换配置，使其指向另一个集群。`connectionFingerprint` 原实现只摘要 `namespace + kubeconfig 路径 + context`，因此：

- 同一路径换集群后指纹**不变**，探针/运行清理账本的「按连接指纹匹配 Provider」会把旧集群的清理责任错误地指向新集群；
- 反之，集群身份未变而路径变化时会被误判为不同连接。

## What Changes

- `connectionFingerprint` 改为摘要 **namespace + 解析出的集群身份（server + 证书颁发机构）**，不再使用 kubeconfig 路径与 context 名。
- 构造时从已加载的 KubeConfig 读取当前集群的 `server` 与 CA（`caData`，或 `caFile` 内容的摘要），计算稳定身份。

## Capabilities

### New Capabilities
- `cluster-connection-identity`: 连接身份必须绑定解析出的集群标识（server 与 CA），不得以可替换的 kubeconfig 路径或上下文名充当身份；同一路径指向不同集群时身份必须改变。

### Modified Capabilities
（无。）

## Impact

- **Host**：`src/k3s-worker.ts`（`connectionFingerprint` 与构造时的集群身份解析）。
- **测试**：新增 `tests/cluster-identity.spec.ts`（同路径换集群 → 指纹变化；同集群 → 稳定；仅 CA 不同 → 变化）。
- **兼容**：指纹值本身改变会使既有账本条目不再匹配当前 Provider（保守保留责任，不会误删）——这是期望行为；`cleanupProbeIdentity` 仍要求确认 UID。
