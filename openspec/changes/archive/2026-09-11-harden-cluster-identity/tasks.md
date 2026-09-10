## 1. 集群身份指纹

- [x] 1.1 先写失败测试：同路径换集群、仅 CA 不同 → 指纹须变化；同集群 → 稳定
- [x] 1.2 构造时解析当前集群 server + CA，计算集群身份
- [x] 1.3 `connectionFingerprint` 改为 namespace + 集群身份；验证：1.1 转绿

## 2. 收口

- [x] 2.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿（49 文件 / 456 测试）
- [x] 2.2 运行 `openspec validate harden-cluster-identity --strict`，验证：通过
- [x] 2.3 记录 spec 场景到测试的映射与已知未覆盖
