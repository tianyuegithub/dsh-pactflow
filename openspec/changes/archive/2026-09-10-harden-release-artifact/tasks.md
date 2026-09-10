## 1. 产物清单判定（纯函数）

- [x] 1.1 先写失败测试：`assertArtifactManifest` 对含 `src/x.ts`、`node_modules/y`、`.env`、`.DS_Store`、`id_rsa` 的清单失败关闭；对缺必需产物、缺声明入口的清单失败；对合法清单放行
- [x] 1.2 实现纯函数 `assertArtifactManifest(paths, requirements)`（含禁止路径规则与入口存在检查）；验证：1.1 转绿

## 2. 接入真实 tarball

- [x] 2.1 `check-package.mjs` 在临时目录 `npm pack`，用 `tar -tzf` 读清单，调用 1.2 校验后清理
- [x] 2.2 保留既有 manifest 断言（bundle.patch、client.platform、license、bin、peer optional、LICENSE 一致性）
- [x] 2.3 运行 `pnpm run check`，验证：13 项产物检查通过且真实 tarball 校验通过

## 3. 收口

- [x] 3.1 运行完整 `pnpm run check`、`pnpm run typecheck`、`git diff --check`，验证：全绿
- [x] 3.2 运行 `openspec validate harden-release-artifact --strict`，验证：通过
- [x] 3.3 记录 spec 场景到测试的映射
